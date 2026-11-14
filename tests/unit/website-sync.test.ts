import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

type Expected = { name: string; size: number; sha256: string };
type NativeRun = (program: string, args: string[], options?: { captureSignature?: boolean }) => string;
const sync = await import(pathToFileURL(resolve('scripts/release/prepare-website-sync.mjs')).href) as {
  releaseVersion(tag: string): string;
  releasePlan(release: unknown, tag: string, commit: string): { version: string; assets: Expected[] };
  verifyWindowsRun(run: unknown, commit: string): void;
  verifyWindowsJobs(jobs: unknown[], id: number): void;
  verifyWindowsMetadata(metadata: unknown, expected: Expected): void;
  verifyInstaller(file: string, expected: Expected): Promise<void>;
  verifyMacInstaller(file: string, arch: string, version: string, run: NativeRun): Promise<{ arch: string; status: string; verification: string; submissionId: null }>;
};
const commit = 'a'.repeat(40), repository = 'yuyeyuyy/Snipvia';
const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
const scratch = () => { const directory = mkdtempSync(join(tmpdir(), 'website-sync-test-')); directories.push(directory); return directory; };
function release() {
  const tag = 'v1.0.3';
  return { id: 123, tag_name: tag, draft: false, prerelease: false, published_at: '2026-11-14T04:00:00Z', html_url: `https://github.com/${repository}/releases/tag/${tag}`,
    assets: ['Snipvia-1.0.3-arm64.dmg', 'Snipvia-1.0.3-x64.dmg', 'Snipvia-Setup-1.0.3-x64.exe'].map(name => ({ name, state: 'uploaded', size: 123, digest: 'sha256:' + 'b'.repeat(64), browser_download_url: `https://github.com/${repository}/releases/download/${tag}/${name}` })) };
}
it('仅接受当前仓库完整正式发行，拒绝预发布、路径注入、重复包、缺失摘要与不安全来源', () => {
  const item = release(); expect(sync.releasePlan(item, item.tag_name, commit)).toMatchObject({ version: '1.0.3', assets: expect.any(Array) });
  for (const tag of ['v01.0.3', 'v1.0.3-rc.1', 'v1.0.3; echo unsafe', '../v1.0.3', 'v9007199254740992.0.0']) expect(() => sync.releaseVersion(tag)).toThrow();
  item.prerelease = true; expect(() => sync.releasePlan(item, item.tag_name, commit)).toThrow(); item.prerelease = false;
  item.draft = true; expect(() => sync.releasePlan(item, item.tag_name, commit)).toThrow(); item.draft = false;
  item.assets.push(item.assets[0]); expect(() => sync.releasePlan(item, item.tag_name, commit)).toThrow('唯一'); item.assets.pop();
  item.assets[0].digest = ''; expect(() => sync.releasePlan(item, item.tag_name, commit)).toThrow('元数据');
  item.assets[0].digest = 'sha256:' + 'b'.repeat(64); item.assets[0].browser_download_url = 'https://invalid.test/file';
  expect(() => sync.releasePlan(item, item.tag_name, commit)).toThrow('元数据');
});
const steps = ['Lint and typecheck', 'Check current capture, collection, IPC, storage and platform adapters', 'Build and inspect unsigned NSIS installer', 'Validate current synthetic desktop flows', 'Install in a temporary per-user directory', 'Validate the installed client using synthetic frames', 'Uninstall temporary application', 'Upload internal artifacts only when explicitly enabled'];
it('Windows 证据必须来自同仓库、同提交及实际通过的安装/运行/卸载步骤，跳过不算通过', () => {
  const run = { id: 12, status: 'completed', conclusion: 'success', event: 'workflow_dispatch', head_sha: commit, path: '.github/workflows/windows-internal.yml', repository: { full_name: repository }, head_repository: { full_name: repository } };
  const job = { name: 'windows', run_id: 12, status: 'completed', conclusion: 'success', steps: steps.map(name => ({ name, status: 'completed', conclusion: 'success' })) };
  expect(() => sync.verifyWindowsRun(run, commit)).not.toThrow(); expect(() => sync.verifyWindowsJobs([job], 12)).not.toThrow();
  run.head_sha = 'c'.repeat(40); expect(() => sync.verifyWindowsRun(run, commit)).toThrow('源码'); run.head_sha = commit;
  run.head_repository.full_name = 'other/fork'; expect(() => sync.verifyWindowsRun(run, commit)).toThrow('仓库');
  job.steps[6].conclusion = 'skipped'; expect(() => sync.verifyWindowsJobs([job], 12)).toThrow('未全部通过');
  job.steps[6].conclusion = 'success'; expect(() => sync.verifyWindowsJobs([job, job], 12)).toThrow('唯一');
});
it('Windows CI 元数据和实际文件必须同时匹配 Release 的名字、大小及 SHA-256', async () => {
  const directory = scratch(), name = 'Snipvia-Setup-1.0.3-x64.exe', data = Buffer.from('synthetic signed-release-input');
  const expected = { name, size: data.length, sha256: createHash('sha256').update(data).digest('hex') };
  const metadata = { version: '1.0.3', architecture: 'x64', filename: name, bytes: expected.size, sha256: expected.sha256, embeddedApplicationIconsMatch: true, embeddedInstallerIconsMatch: true, signed: false, nativeNodeModules: 0 };
  expect(() => sync.verifyWindowsMetadata(metadata, expected)).not.toThrow();
  metadata.bytes++; expect(() => sync.verifyWindowsMetadata(metadata, expected)).toThrow('不一致');
  const file = join(directory, name); writeFileSync(file, data); await expect(sync.verifyInstaller(file, expected)).resolves.toBeUndefined();
  writeFileSync(file, Buffer.alloc(data.length, 1)); await expect(sync.verifyInstaller(file, expected)).rejects.toThrow('不一致');
});
function nativeFixture({ mismatch = false, badSignature = false, failDetach = false } = {}) {
  const calls: { program: string; args: string[] }[] = [];
  let mount = '';
  const run: NativeRun = (program, args) => {
    calls.push({ program, args });
    if (program.endsWith('/codesign') && args.includes('-d')) return `TeamIdentifier=${badSignature ? 'OTHERTEAM1' : 'F76JCDMA4Y'}\nAuthority=Developer ID Application: Fixture\nTimestamp=Fixture\nflags=0x10000(runtime)\n`;
    if (program.endsWith('/spctl')) return 'accepted\nsource=Notarized Developer ID\n';
    if (program.endsWith('/hdiutil') && args[0] === 'attach') { mount = args[args.indexOf('-mountpoint') + 1]; directories.push(mount); mkdirSync(join(mount, 'Snipvia.app')); }
    if (program.endsWith('/plutil')) return JSON.stringify({ CFBundleIdentifier: 'com.snipvia.desktop', CFBundleExecutable: 'Snipvia', CFBundleShortVersionString: mismatch ? '1.0.2' : '1.0.3', LSMinimumSystemVersion: '14.0' });
    if (program.endsWith('/lipo')) return 'arm64\n';
    if (program.endsWith('/hdiutil') && args[0] === 'detach' && failDetach) throw new Error('synthetic detach failure');
    return '';
  };
  return { calls, run, mount: () => mount };
}
it('Mac 核验只读检查 DMG 与内置 APP，验证票据、Gatekeeper、版本、团队及架构，不假造公证任务 ID', async () => {
  const fixture = nativeFixture();
  await expect(sync.verifyMacInstaller('/synthetic.dmg', 'arm64', '1.0.3', fixture.run)).resolves.toEqual({ arch: 'arm64', status: 'Accepted', verification: 'stapled-ticket-and-Gatekeeper', submissionId: null });
  expect(fixture.calls.filter(item => item.program.endsWith('/xcrun') && item.args[0] === 'stapler')).toHaveLength(2);
  expect(fixture.calls.find(item => item.args[0] === 'attach')?.args).toContain('-readonly'); expect(existsSync(fixture.mount())).toBe(false);
  const invalid = nativeFixture({ badSignature: true }); await expect(sync.verifyMacInstaller('/synthetic.dmg', 'arm64', '1.0.3', invalid.run)).rejects.toThrow('签名身份');
  expect(invalid.calls.some(item => item.args[0] === 'attach')).toBe(false);
});
it('Mac 包内版本错误也要卸载卷；卸载失败时保留挂载点，禁止递归删除', async () => {
  const mismatch = nativeFixture({ mismatch: true }); await expect(sync.verifyMacInstaller('/synthetic.dmg', 'arm64', '1.0.3', mismatch.run)).rejects.toThrow('标识或版本');
  expect(mismatch.calls.some(item => item.args[0] === 'detach')).toBe(true); expect(existsSync(mismatch.mount())).toBe(false);
  const failure = nativeFixture({ failDetach: true }); await expect(sync.verifyMacInstaller('/synthetic.dmg', 'arm64', '1.0.3', failure.run)).rejects.toThrow('detach'); expect(existsSync(failure.mount())).toBe(true);
});
it('工作流限制正式发布/默认分支重试，只有上传步骤接触官网密钥，不向制品打包密钥或日志', () => {
  const require = createRequire(import.meta.url), builderRequire = createRequire(require.resolve('electron-builder')), libRequire = createRequire(builderRequire.resolve('app-builder-lib'));
  const workflow = libRequire('js-yaml').load(readFileSync('.github/workflows/website-release.yml', 'utf8'));
  expect(workflow.on.release.types).toEqual(['published']); expect(workflow.on.pull_request).toBeUndefined(); expect(workflow.on.push).toBeUndefined();
  expect(workflow.permissions).toEqual({ contents: 'read', actions: 'read' }); expect(workflow.concurrency['cancel-in-progress']).toBe(false);
  const steps = workflow.jobs.sync.steps;
  expect(steps.filter((step: { env?: Record<string, string> }) => Object.values(step.env ?? {}).some(value => value.includes('secrets.')))).toHaveLength(1);
  expect(steps[0].with['persist-credentials']).toBe(false); expect(steps[0].with.ref).toContain('default_branch');
  for (const step of steps.filter((step: { uses?: string }) => step.uses)) expect(step.uses).toMatch(/@[a-f0-9]{40}$/);
  expect(steps.find((step: { uses?: string }) => step.uses?.startsWith('actions/upload-artifact')).with.path).toMatch(/\/PUBLICATION\.json$/);
});
