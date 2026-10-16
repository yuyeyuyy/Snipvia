import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import releaseSource from '../../src/shared/release-source.json';

const require = createRequire(import.meta.url);
type Asset = { name: string; size: number; sha256: string; content?: string };
const { planPublication, verifyRemoteAssets, releaseOrNull } = require('../../scripts/macos-release/publish.cjs') as {
  planPublication(directory: string, notes: string): { repository: string; tag: string; assets: Asset[] };
  verifyRemoteAssets(release: { assets: { name: string; size: number; digest: string }[] }, plan: { assets: Asset[] }, complete?: boolean): void;
  releaseOrNull(tag: string, query: (args: string[]) => string): { draft: boolean } | null;
};
const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'snipvia-publication-')); directories.push(directory);
  const artifacts = ['arm64', 'x64'].flatMap(arch => ['zip', 'dmg'].map(ext => {
    const name = `Snipvia-0.3.0-${arch}.${ext}`, content = Buffer.from('synthetic verified ' + name);
    writeFileSync(join(directory, name), content);
    return { name, sha256: createHash('sha256').update(content).digest('hex') };
  }));
  const report = { version: '0.3.0', teamId: 'F76JCDMA4Y', autoUpdateEnabled: true, updateRepository: releaseSource.repository,
    architectures: ['arm64', 'x64'].map(arch => ({ arch, notarization: { status: 'Accepted' } })), artifacts };
  const notes = join(directory, 'PUBLIC_NOTES.md'); writeFileSync(notes, '## 改进\n\n- 正式更新。');
  const saveReport = () => writeFileSync(join(directory, 'verification.json'), JSON.stringify(report));
  saveReport(); return { directory, notes, report, saveReport };
}
it('公开发布白名单只含最终二进制与哈希清单，复用固定公开更新源', () => {
  const f = fixture(), plan = planPublication(f.directory, f.notes);
  expect(plan.repository).toBe('yuyeyuyy/Snipvia-releases'); expect(plan.tag).toBe('v0.3.0');
  expect(plan.assets).toHaveLength(6); expect(plan.assets.map(item => item.name)).not.toContain('verification.json');
  expect(JSON.parse(plan.assets.find(item => item.name === 'latest-mac.yml')!.content!).files).toHaveLength(4);
});
it('拒绝旧更新源、未启用更新和公证未通过的验收报告', () => {
  const f = fixture(); f.report.updateRepository = 'yuyeyuyy/Snipvia'; f.saveReport();
  expect(() => planPublication(f.directory, f.notes)).toThrow('公开更新源');
  f.report.updateRepository = releaseSource.repository; f.report.autoUpdateEnabled = false; f.saveReport();
  expect(() => planPublication(f.directory, f.notes)).toThrow('公开更新源');
  f.report.autoUpdateEnabled = true; f.report.architectures[0].notarization.status = 'Invalid'; f.saveReport();
  expect(() => planPublication(f.directory, f.notes)).toThrow('公证');
});
it('冻结文件或更新清单已改变时不能发布，更新说明不得含凭据', () => {
  const f = fixture(); writeFileSync(join(f.directory, 'latest-mac.yml'), JSON.stringify({ version: '0.4.0' }));
  expect(() => planPublication(f.directory, f.notes)).toThrow('不一致');
  rmSync(join(f.directory, 'latest-mac.yml')); writeFileSync(f.notes, 'ghp_' + 'a'.repeat(36));
  expect(() => planPublication(f.directory, f.notes)).toThrow('凭据');
  writeFileSync(f.notes, '改进'); writeFileSync(join(f.directory, f.report.artifacts[0].name), 'changed');
  expect(() => planPublication(f.directory, f.notes)).toThrow('校验失败');
});
it('远程草稿拒绝未批准资产、错误哈希或遗漏文件', () => {
  const f = fixture(), plan = planPublication(f.directory, f.notes);
  const remote = { assets: plan.assets.map(({ name, size, sha256 }) => ({ name, size, digest: `sha256:${sha256}` })) };
  expect(() => verifyRemoteAssets(remote, plan, true)).not.toThrow();
  remote.assets[0].digest = 'sha256:' + '0'.repeat(64); expect(() => verifyRemoteAssets(remote, plan)).toThrow('不一致');
  remote.assets.shift(); expect(() => verifyRemoteAssets(remote, plan, true)).toThrow('完整');
  remote.assets.push({ name: 'private-source.zip', size: 1, digest: '' });
  expect(() => verifyRemoteAssets(remote, plan)).toThrow('未批准');
});
it('通过 CLI 找到未发布草稿后按 ID 读取，网络错误不能当作 Release 不存在', () => {
  const calls: string[][] = [];
  expect(releaseOrNull('v0.3.0', args => {
    calls.push(args); return JSON.stringify(args[0] === 'release' ? { databaseId: 123 } : { draft: true, assets: [] });
  })).toMatchObject({ draft: true });
  expect(calls[1]).toEqual(['api', 'repos/yuyeyuyy/Snipvia-releases/releases/123']);
  expect(releaseOrNull('v0.3.0', () => { throw Object.assign(new Error('not found'), { stderr: 'release not found' }); })).toBeNull();
  expect(() => releaseOrNull('v0.3.0', () => { throw Object.assign(new Error('network'), { stderr: 'EOF' }); })).toThrow('网络');
});
