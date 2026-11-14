import console from 'node:console';
import process from 'node:process';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, constants } from 'node:fs';
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, URL } from 'node:url';
import { parseArgs } from 'node:util';

const root = fileURLToPath(new URL('../../', import.meta.url));
const { repository } = JSON.parse(await readFile(join(root, 'src/shared/release-source.json'), 'utf8'));
const workflowPath = '.github/workflows/windows-internal.yml';
const requiredWindowsSteps = [
  'Lint and typecheck', 'Check current capture, collection, IPC, storage and platform adapters',
  'Build and inspect unsigned NSIS installer', 'Validate current synthetic desktop flows',
  'Install in a temporary per-user directory', 'Validate the installed client using synthetic frames',
  'Uninstall temporary application', 'Upload internal artifacts only when explicitly enabled',
];
export class SyncError extends Error {}
const ensure = (value, message) => { if (!value) throw new SyncError(message); };
export function releaseVersion(tag) {
  ensure(typeof tag === 'string' && /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag)
    && tag.length <= 65 && tag.slice(1).split('.').every(part => Number.isSafeInteger(Number(part))), '只同步正式版本标签，例如 v1.0.3');
  return tag.slice(1);
}
export function releasePlan(release, tag, sourceCommit) {
  const version = releaseVersion(tag);
  ensure(release?.tag_name === tag && release.draft === false && release.prerelease === false
    && Number.isFinite(Date.parse(release.published_at)) && Number.isSafeInteger(release.id)
    && release.html_url === `https://github.com/${repository}/releases/tag/${tag}`
    && /^[a-f0-9]{40}$/.test(sourceCommit ?? '') && Array.isArray(release.assets), '需要目标仓库已正式发布、可解析源码的 Release');
  const platforms = ['macos-arm64', 'macos-x64', 'windows-x64'];
  const assets = platforms.map(platform => {
    const name = platform === 'windows-x64' ? `Snipvia-Setup-${version}-x64.exe` : `Snipvia-${version}-${platform === 'macos-arm64' ? 'arm64' : 'x64'}.dmg`;
    const candidates = release.assets.filter(item => item.name === name);
    ensure(candidates.length === 1, `Release 缺少唯一安装包：${name}`);
    const item = candidates[0];
    ensure(item.state === 'uploaded' && Number.isSafeInteger(item.size) && item.size > 0 && item.size <= 512 * 1024 * 1024
      && /^sha256:[a-f0-9]{64}$/.test(item.digest ?? '')
      && item.browser_download_url === `https://github.com/${repository}/releases/download/${tag}/${name}`, `Release 安装包元数据无效：${name}`);
    return { name, platform, size: item.size, sha256: item.digest.slice(7) };
  });
  return { version, tag, sourceCommit, publishedAt: release.published_at, url: release.html_url, releaseId: release.id, assets };
}
export function verifyWindowsRun(run, sourceCommit) {
  ensure(Number.isSafeInteger(run?.id) && run.id > 0 && run.status === 'completed' && run.conclusion === 'success'
    && run.event === 'workflow_dispatch' && run.head_sha === sourceCommit && run.path === workflowPath
    && run.repository?.full_name === repository && run.head_repository?.full_name === repository, 'Windows 验收任务的仓库、源码或结果不一致');
}
export function verifyWindowsJobs(jobs, runId) {
  const candidates = jobs.filter(job => job.name === 'windows' && job.run_id === runId);
  ensure(candidates.length === 1, '缺少唯一 Windows 验收 Job');
  const job = candidates[0];
  ensure(job.status === 'completed' && job.conclusion === 'success'
    && requiredWindowsSteps.every(name => job.steps?.filter(step => step.name === name && step.status === 'completed' && step.conclusion === 'success').length === 1), 'Windows 安装、运行、卸载或上传验收未全部通过');
}
export function verifyWindowsMetadata(metadata, expected) {
  ensure(metadata?.version && expected.name === `Snipvia-Setup-${metadata.version}-x64.exe`
    && metadata.architecture === 'x64' && metadata.filename === expected.name && metadata.sha256 === expected.sha256 && metadata.bytes === expected.size
    && metadata.embeddedApplicationIconsMatch === true && metadata.embeddedInstallerIconsMatch === true
    && metadata.signed === false && metadata.nativeNodeModules === 0, 'Windows CI 产物与正式 Release 的安装包不一致');
}
function command(program, args, options = {}) {
  try { return execFileSync(program, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 8 * 1024 * 1024, timeout: 120_000, ...options }); }
  catch { throw new SyncError(`${program.split('/').at(-1)} 核验失败；未上传官网，请检查该步骤配置后重试`); }
}
function api(path) { return JSON.parse(command('gh', ['api', `repos/${repository}/${path}`])); }
async function digest(file) {
  const hash = createHash('sha256'); for await (const chunk of createReadStream(file)) hash.update(chunk); return hash.digest('hex');
}
export async function verifyInstaller(file, expected) {
  const info = await lstat(file);
  ensure(info.isFile() && !info.isSymbolicLink() && info.size === expected.size && await digest(file) === expected.sha256, `下载文件与正式 Release 不一致：${expected.name}`);
}
export async function verifyMacInstaller(file, arch, version, run = signatureCommand) {
  ensure(['arm64', 'x64'].includes(arch) && releaseVersion(`v${version}`) === version, 'Mac 平台或版本无效');
  const requirement = 'anchor apple generic and certificate leaf[subject.OU] = "F76JCDMA4Y" and certificate 1[field.1.2.840.113635.100.6.2.6] exists and certificate leaf[field.1.2.840.113635.100.6.1.13] exists';
  const verifyCode = target => {
    run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--all-architectures', `-R=${requirement}`, target]);
  };
  // codesign -d writes metadata to stderr; capture both streams without logging tool payloads.
  const signature = target => {
    const result = run('/usr/bin/codesign', ['-d', '-vvv', '--verbose=4', target], { captureSignature: true });
    ensure(/^TeamIdentifier=F76JCDMA4Y\s*$/m.test(result) && /^Authority=Developer ID Application: /m.test(result)
      && /^Timestamp=.+/m.test(result) && !/Signature=adhoc/.test(result), 'Mac 安装包签名身份或时间戳不正确');
    return result;
  };
  const assess = args => {
    const result = run('/usr/sbin/spctl', args, { captureSignature: true });
    ensure(/\baccepted\b/.test(result) && /^source=Notarized Developer ID\s*$/m.test(result), 'Gatekeeper 未认可 Apple 公证');
  };
  verifyCode(file); signature(file);
  run('/usr/bin/hdiutil', ['verify', file]); run('/usr/bin/xcrun', ['stapler', 'validate', file]);
  assess(['--assess', '--type', 'open', '--context', 'context:primary-signature', '--verbose=4', file]);
  const mount = await mkdtemp(join(tmpdir(), 'snipvia-website-dmg-'));
  let mounted = false;
  try {
    run('/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-noautoopen', '-mountpoint', mount, file]); mounted = true;
    const app = join(mount, 'Snipvia.app'), info = await lstat(app);
    ensure(info.isDirectory() && !info.isSymbolicLink(), 'DMG 中缺少正常 Snipvia.app');
    const plist = JSON.parse(run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', join(app, 'Contents/Info.plist')]));
    ensure(plist.CFBundleIdentifier === 'com.snipvia.desktop' && plist.CFBundleExecutable === 'Snipvia'
      && plist.CFBundleShortVersionString === version && plist.LSMinimumSystemVersion === '14.0', 'DMG 中应用标识或版本不匹配');
    ensure(run('/usr/bin/lipo', ['-archs', join(app, 'Contents/MacOS/Snipvia')]).trim() === (arch === 'arm64' ? 'arm64' : 'x86_64'), 'Mac 安装包架构不匹配');
    verifyCode(app); ensure(/flags=.*\bruntime\b/.test(signature(app)), 'Mac 应用未启用 Hardened Runtime');
    run('/usr/bin/xcrun', ['stapler', 'validate', app]); assess(['--assess', '--type', 'execute', '--verbose=4', app]);
  } finally {
    // Detach failure must leave the mount untouched, never recursively remove a mounted volume.
    if (mounted) run('/usr/bin/hdiutil', ['detach', mount]);
    await rm(mount, { recursive: true, force: true });
  }
  return { arch, status: 'Accepted', verification: 'stapled-ticket-and-Gatekeeper', submissionId: null };
}
async function windowsEvidence(plan, directory, requestedRun) {
  const expected = plan.assets.find(item => item.platform === 'windows-x64');
  ensure(!requestedRun || /^[1-9]\d*$/.test(requestedRun) && Number.isSafeInteger(Number(requestedRun)), 'Windows Run ID 必须为正整数');
  const runs = requestedRun ? [api(`actions/runs/${requestedRun}`)]
    : api(`actions/workflows/windows-internal.yml/runs?head_sha=${plan.sourceCommit}&event=workflow_dispatch&status=success&per_page=20`).workflow_runs.slice(0, 5);
  for (const run of runs) {
    try {
      verifyWindowsRun(run, plan.sourceCommit);
      console.log(`核对 Windows 验收任务：${run.id}`);
      const jobs = api(`actions/runs/${run.id}/jobs?filter=latest&per_page=100`); verifyWindowsJobs(jobs.jobs, run.id);
      const artifacts = api(`actions/runs/${run.id}/artifacts?per_page=100`).artifacts
        .filter(item => item.name === 'windows-unsigned-internal' && item.expired === false && item.size_in_bytes > 0 && item.size_in_bytes <= 512 * 1024 * 1024);
      ensure(artifacts.length === 1, 'Windows 验收产物缺失或已过期');
      const scratch = join(directory, `windows-proof-${run.id}`); await mkdir(scratch);
      console.log(`下载并核对 Windows CI 成品：${expected.name}`);
      command('gh', ['run', 'download', String(run.id), '--repo', repository, '--name', 'windows-unsigned-internal', '--dir', scratch], { timeout: 600_000 });
      const candidates = [];
      async function walk(folder, depth = 0) {
        ensure(depth < 12, 'Windows 验收产物目录层级异常');
        for (const entry of await readdir(folder, { withFileTypes: true })) {
          ensure(!entry.isSymbolicLink(), 'Windows 验收产物不接受符号链接');
          if (entry.isDirectory()) await walk(join(folder, entry.name), depth + 1);
          else if (entry.name === 'BUILD_METADATA.json') candidates.push(join(folder, entry.name));
        }
      }
      await walk(scratch); ensure(candidates.length === 1 && (await lstat(candidates[0])).size < 64 * 1024, 'Windows 构建报告缺失或重复');
      verifyWindowsMetadata(JSON.parse(await readFile(candidates[0], 'utf8')), expected);
      const exe = join(dirname(candidates[0]), expected.name); await verifyInstaller(exe, expected);
      await copyFile(exe, join(directory, expected.name), constants.COPYFILE_EXCL);
      return { id: String(run.id), conclusion: 'success', url: `https://github.com/${repository}/actions/runs/${run.id}` };
    } catch (error) {
      if (requestedRun) throw error;
      console.log(`Windows Run ${run.id} 无法匹配本次正式安装包，继续核对其他候选。`);
    }
  }
  throw new SyncError('未找到相同源码、相同字节且安装/运行/卸载均通过的 Windows CI；可用 windows_run 指定未过期任务，官网未修改');
}
function signatureCommand(program, args, options = {}) {
  if (!options.captureSignature) return command(program, args, options);
  const result = spawnSync(program, args, { cwd: root, encoding: 'utf8', timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
  ensure(result.status === 0, `${program.split('/').at(-1)} 签名/公证核验失败，未上传官网`);
  return `${result.stdout || ''}\n${result.stderr || ''}`;
}
export async function prepareWebsiteSync({ tag, directory, windowsRun, planOnly = false }) {
  ensure(repository === 'yuyeyuyy/Snipvia', '官网同步仅允许固定公开客户端仓库');
  releaseVersion(tag);
  const release = api(`releases/tags/${tag}`), commit = api(`commits/${tag}`);
  const plan = releasePlan(release, tag, commit.sha);
  ensure(api('releases/latest').id === plan.releaseId, '只允许同步当前最新正式 Release，旧版本不会回退官网');
  if (planOnly) return { ...plan, readOnly: true, verified: false };
  ensure(process.platform === 'darwin', '公证核验需要 macOS runner');
  await mkdir(directory, { recursive: false });
  const windows = await windowsEvidence(plan, directory, windowsRun);
  const notarization = [];
  for (const arch of ['arm64', 'x64']) {
    const expected = plan.assets.find(item => item.platform === `macos-${arch}`);
    console.log(`下载并验证签名与公证票据：${expected.name}`);
    command('gh', ['release', 'download', tag, '--repo', repository, '--pattern', expected.name, '--dir', directory], { timeout: 600_000 });
    const file = join(directory, expected.name); await verifyInstaller(file, expected);
    notarization.push(await verifyMacInstaller(file, arch, plan.version, signatureCommand));
  }
  const latest = releasePlan(api(`releases/tags/${tag}`), tag, api(`commits/${tag}`).sha);
  ensure(JSON.stringify(latest) === JSON.stringify(plan) && api('releases/latest').id === plan.releaseId, '核验时 Release 或标签发生变化，官网未修改');
  const receipt = { ...plan, windowsRun: windows.id, windowsConclusion: windows.conclusion, notarization,
    verification: 'website-sync: GitHub digests, same-commit Windows CI, Apple stapled tickets and Gatekeeper', verifiedAt: new Date().toISOString() };
  await writeFile(join(directory, 'PUBLICATION.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o644 });
  return receipt;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { tag: { type: 'string' }, directory: { type: 'string' }, 'windows-run': { type: 'string' }, plan: { type: 'boolean', default: false } } });
    ensure(values.tag && (values.plan || values.directory), '用法：node scripts/release/prepare-website-sync.mjs --tag v1.0.3 --directory <新临时目录> [--windows-run ID] [--plan]');
    const report = await prepareWebsiteSync({ tag: values.tag, directory: values.directory && resolve(values.directory), windowsRun: values['windows-run'], planOnly: values.plan });
    console.log(JSON.stringify({ version: report.version, sourceCommit: report.sourceCommit, windowsRun: report.windowsRun, planOnly: values.plan, websiteModified: false, receipt: values.plan ? null : join(resolve(values.directory), 'PUBLICATION.json') }, null, 2));
  } catch (error) { console.error(error instanceof SyncError ? error.message : '官网同步准备失败；未上传官网，工具错误详情未输出'); process.exitCode = 1; }
}
