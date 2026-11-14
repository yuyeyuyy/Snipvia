import process from 'node:process';
import console from 'node:console';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { parseArgs } from 'node:util';
import { URL, URLSearchParams } from 'node:url';

const platforms = ['macos-arm64', 'macos-x64', 'windows-x64'];
class PublisherError extends Error {}
const ensure = (value, message) => { if (!value) throw new PublisherError(message); };
function stable(value) { return typeof value === 'string' && value.length <= 64 && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value) && value.split('.').every(part => Number.isSafeInteger(Number(part))); }
async function digest(file) { const hash = createHash('sha256'); for await (const chunk of createReadStream(file)) hash.update(chunk); return hash.digest('hex'); }

async function main() {
  const { values } = parseArgs({ options: { credentials: { type: 'string' }, receipt: { type: 'string' }, directory: { type: 'string' }, 'dry-run': { type: 'boolean', default: false } } });
  ensure(values.credentials && values.receipt && values.directory, '用法：pnpm website:publish --credentials <私密凭据.json> --receipt <发行收据.json> --directory <已验收安装包目录> [--dry-run]');
  const credentialFile = resolve(values.credentials), info = await lstat(credentialFile);
  ensure(info.isFile() && !info.isSymbolicLink() && info.size <= 4096 && (process.platform === 'win32' || (info.mode & 0o077) === 0), '发布凭据必须是私密普通文件（macOS/Linux 使用 chmod 600）');
  const credentials = JSON.parse(await readFile(credentialFile, 'utf8'));
  const base = new URL(credentials.origin);
  ensure((base.protocol === 'https:' || (base.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(base.hostname)))
    && !base.username && !base.password && base.pathname === '/' && !base.search && !base.hash && base.origin === credentials.origin, '发布凭据必须绑定一个 HTTPS 来源；HTTP 仅限本机测试');
  ensure(typeof credentials.token === 'string' && /^[a-f0-9]{64}$/.test(credentials.token), '发布凭据格式无效');
  const receipt = JSON.parse(await readFile(resolve(values.receipt), 'utf8'));
  ensure(stable(receipt.version) && Array.isArray(receipt.assets) && receipt.assets.length <= 50, '发行收据无效');
  const version = receipt.version, directory = resolve(values.directory);
  ensure(receipt.tag === `v${version}` && receipt.url === `https://github.com/yuyeyuyy/Snipvia/releases/tag/v${version}`
    && /^[a-f0-9]{40}$/.test(receipt.sourceCommit ?? '') && Number.isFinite(Date.parse(receipt.publishedAt)) && receipt.windowsConclusion === 'success'
    && Array.isArray(receipt.notarization) && receipt.notarization.length === 2
    && ['arm64', 'x64'].every(arch => receipt.notarization.filter(item => item.arch === arch && item.status === 'Accepted').length === 1), '需要已正式发布且两端验收通过的发行收据');
  const artifacts = [];
  // Validate all three files before any request can mutate the website.
  for (const platform of platforms) {
    const filename = platform === 'windows-x64' ? `Snipvia-Setup-${version}-x64.exe` : `Snipvia-${version}-${platform === 'macos-arm64' ? 'arm64' : 'x64'}.dmg`;
    const entries = receipt.assets.filter(item => item.name === filename); ensure(entries.length === 1, '发行收据缺少唯一的平台安装包');
    const expected = entries[0], file = join(directory, filename), stat = await lstat(file);
    ensure(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= 512 * 1024 * 1024 && stat.size === expected.size
      && /^[a-f0-9]{64}$/.test(expected.sha256) && await digest(file) === expected.sha256, `安装包预检失败：${filename}`);
    artifacts.push({ platform, filename, file, bytes: stat.size, sha256: expected.sha256 });
  }
  if (values['dry-run']) { console.log(JSON.stringify({ origin: base.origin, version, artifacts: artifacts.map(({ platform, filename, bytes, sha256 }) => ({ platform, filename, bytes, sha256 })), dryRun: true }, null, 2)); return; }
  async function request(path, { method = 'GET', body, upload = false, authenticated = true } = {}) {
    const headers = { Origin: base.origin, ...(authenticated ? { Authorization: `Bearer ${credentials.token}` } : {}),
      ...(body ? { 'Content-Type': upload ? 'application/octet-stream' : 'application/json' } : {}) };
    const response = await globalThis.fetch(new URL(path, base), { method, headers, body, ...(upload ? { duplex: 'half' } : {}), redirect: 'error', signal: globalThis.AbortSignal.timeout(upload ? 600_000 : 120_000) });
    ensure(response.ok, `官网接口请求失败（HTTP ${response.status}），已完成的上传可安全重试`);
    return response.json();
  }
  const status = await request(`/api/admin/downloads/publisher/status?version=${version}`);
  ensure(status.version === version && Array.isArray(status.artifacts), '官网版本状态无效');
  for (const item of artifacts) {
    const existing = status.artifacts.filter(value => value.platform === item.platform);
    ensure(existing.length <= 1 && (!existing[0] || existing[0].filename === item.filename && existing[0].sha256 === item.sha256 && existing[0].bytes === item.bytes), '官网已有不同文件，请使用新的版本号');
  }
  for (const item of artifacts) {
    if (status.artifacts.some(value => value.platform === item.platform)) { console.log(`已校验，跳过上传：${item.filename}`); continue; }
    const query = new URLSearchParams({ version, platform: item.platform, filename: item.filename, sha256: item.sha256 });
    const body = createReadStream(item.file);
    try {
      console.log(`上传：${item.filename}`);
      const result = await request(`/api/admin/downloads/upload?${query}`, { method: 'PUT', body, upload: true });
      ensure(result.version === version && result.platform === item.platform && result.filename === item.filename && result.sha256 === item.sha256 && result.bytes === item.bytes, '上传结果与已验收文件不一致，尚未统一发布');
    } finally { body.destroy(); }
  }
  const input = { version, artifacts: artifacts.map(({ platform, sha256 }) => ({ platform, sha256 })) };
  const published = await request('/api/admin/downloads/publisher/publish', { method: 'POST', body: JSON.stringify(input) });
  ensure(published.version === version, '官网发布版本不一致');
  const state = await request('/api/downloads', { authenticated: false });
  ensure(state.latest?.version === version && state.latest.artifacts?.length === 3, '公开官网版本尚未一致，请查询接口后安全重试');
  for (const item of artifacts) {
    const remote = state.latest.artifacts.find(value => value.platform === item.platform);
    ensure(remote?.enabled && remote.filename === item.filename && remote.sha256 === item.sha256 && remote.bytes === item.bytes, '公开安装包与验收文件不一致');
  }
  console.log(`官网已更新至 v${version}，三个平台安装包均已核对。`);
}
main().catch(error => { console.error(error instanceof PublisherError ? error.message : '发布操作失败，请检查本机文件和网络；已上传内容可安全重试'); process.exitCode = 1; });
