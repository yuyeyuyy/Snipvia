const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const process = require('node:process');
const console = require('node:console');
const { createHash } = require('node:crypto');
const { Buffer } = require('node:buffer');
const { execFileSync } = require('node:child_process');
const { parseArgs } = require('node:util');
const { macUpdateMetadata } = require('./update-metadata.cjs');
const { repository } = require('../../src/shared/release-source.json');

const ensure = (condition, message) => { if (!condition) throw new Error(message); };
const sha256 = content => createHash('sha256').update(content).digest('hex');

/** Read frozen assets; publish only the four verified binaries and public hashes. */
function planPublication(directory, notesFile) {
  ensure(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository), '公开发布仓库配置无效');
  const report = JSON.parse(fs.readFileSync(path.join(directory, 'verification.json'), 'utf8'));
  ensure(/^[a-f0-9]{40}$/.test(report.sourceCommit || ''), '验收报告缺少完整源码提交，请从已提交源码重新构建。');
  ensure(report.autoUpdateEnabled === true && report.updateRepository === repository, '此验收报告未启用当前公开更新源，请重新正式构建，不能发布旧包作为自动更新版');
  ensure(Array.isArray(report.architectures) && report.architectures.length === 2
    && ['arm64', 'x64'].every(arch => report.architectures.filter(item => item.arch === arch && item.notarization?.status === 'Accepted').length === 1), '两种架构必须完成公证验收');
  const expected = JSON.parse(macUpdateMetadata(directory));
  const manifestFile = path.join(directory, 'latest-mac.yml');
  let manifest = JSON.stringify(expected, null, 2) + '\n';
  if (fs.existsSync(manifestFile)) {
    ensure(fs.lstatSync(manifestFile).isFile() && !fs.lstatSync(manifestFile).isSymbolicLink(), '更新清单必须是普通文件');
    manifest = fs.readFileSync(manifestFile, 'utf8');
    const actual = JSON.parse(manifest);
    ensure(actual.version === expected.version && JSON.stringify(actual.files) === JSON.stringify(expected.files)
      && actual.path === expected.path && actual.sha512 === expected.sha512 && Number.isFinite(Date.parse(actual.releaseDate)), '更新清单与最终冻结文件不一致');
  }
  const notesStat = fs.lstatSync(notesFile);
  ensure(notesStat.isFile() && !notesStat.isSymbolicLink() && /\.md$/i.test(notesFile) && notesStat.size > 0 && notesStat.size <= 64 * 1024, '公开更新说明必须是非空 Markdown 文件，且不超过 64 KiB');
  const notes = fs.readFileSync(notesFile, 'utf8');
  ensure(!/(?:github_pat_[A-Za-z0-9_]{30,}|gh[pousr]_[A-Za-z0-9]{30,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|\bsk-[A-Za-z0-9_-]{24,})/.test(notes), '更新说明含疑似凭据，拒绝公开上传');
  const sums = report.artifacts.map(item => `${item.sha256}  ${item.name}\n`).join('');
  const assets = report.artifacts.map(item => ({ name: item.name, source: path.join(directory, item.name), sha256: item.sha256, size: fs.statSync(path.join(directory, item.name)).size }));
  for (const [name, content] of [['latest-mac.yml', manifest], ['SHA256SUMS.txt', sums]]) assets.push({ name, content, sha256: sha256(content), size: Buffer.byteLength(content) });
  return { repository, sourceCommit: report.sourceCommit, version: report.version, tag: `v${report.version}`, notesFile, assets };
}

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 300_000, stdio: ['ignore', 'pipe', 'pipe'] });
}
function releaseOrNull(tag, query = gh) {
  try {
    // The REST tag endpoint only resolves published releases. CLI also finds
    // drafts; fetch the resulting numeric ID for authoritative asset digests.
    const info = JSON.parse(query(['release', 'view', tag, '--repo', repository, '--json', 'databaseId']));
    ensure(Number.isSafeInteger(info.databaseId) && info.databaseId > 0, '目标 Release ID 无效');
    return JSON.parse(query(['api', `repos/${repository}/releases/${info.databaseId}`]));
  }
  catch (error) {
    if (error.stderr?.toString().includes('release not found')) return null;
    throw new Error('无法核对目标 Release，请检查 GitHub 登录与网络；没有覆盖发行文件');
  }
}
function verifyRemoteAssets(release, plan, complete = false) {
  ensure(release && Array.isArray(release.assets), '无法读取远程发行资产');
  ensure(release.assets.every(asset => plan.assets.some(item => item.name === asset.name)), '目标草稿含未批准文件，拒绝继续');
  for (const asset of release.assets) {
    const expected = plan.assets.find(item => item.name === asset.name);
    ensure(asset.size === expected.size && asset.digest === `sha256:${expected.sha256}`, `目标资产与冻结文件不一致：${asset.name}`);
  }
  if (complete) ensure(release.assets.length === plan.assets.length, '远程发行文件尚未完整上传');
}

/** Read-only: reject absent source commits and tags pointing at different code. */
function verifyRemoteSource(plan, query = gh) {
  ensure(/^[a-f0-9]{40}$/.test(plan.sourceCommit || ''), '源码提交无效');
  const commit = JSON.parse(query(['api', `repos/${repository}/commits/${plan.sourceCommit}`]));
  ensure(commit.sha === plan.sourceCommit, '请先把本次源码提交推送到目标仓库，再发布安装包。');
  let reference;
  try { reference = JSON.parse(query(['api', `repos/${repository}/git/ref/tags/${encodeURIComponent(plan.tag)}`])).object; }
  catch (error) {
    if (/\bHTTP 404\b/.test(error.stderr?.toString() || '')) return;
    throw new Error('无法核对远程标签；没有创建或修改 Release。');
  }
  for (let depth = 0; depth < 5; depth++) {
    ensure(reference && /^[a-f0-9]{40}$/.test(reference.sha), '远程标签格式无效');
    if (reference.type === 'commit') {
      ensure(reference.sha === plan.sourceCommit, '远程标签指向其他源码，拒绝覆盖或发布。');
      return;
    }
    ensure(reference.type === 'tag', '远程标签目标无效');
    reference = JSON.parse(query(['api', `repos/${repository}/git/tags/${reference.sha}`])).object;
  }
  throw new Error('远程注释标签嵌套过深；没有修改标签或 Release。');
}
function publish(plan) {
  const repo = JSON.parse(gh(['api', `repos/${repository}`]));
  ensure(repo.full_name === repository && repo.private === false, '发布目标必须是已配置的公开分发仓库');
  verifyRemoteSource(plan);
  let release = releaseOrNull(plan.tag);
  ensure(!release || release.draft, '该版本已经公开发布，拒绝覆盖；请使用新的版本号');
  ensure(!release || release.target_commitish === plan.sourceCommit, '已有草稿的源码目标不一致，请人工核对；没有覆盖草稿。');
  if (!release) {
    gh(['release', 'create', plan.tag, '--repo', repository, '--target', plan.sourceCommit, '--draft', '--title', `截然 Snipvia ${plan.tag}`, '--notes-file', plan.notesFile]);
    release = releaseOrNull(plan.tag);
  }
  ensure(release?.draft && !release.prerelease, '目标必须是正式版本草稿');
  verifyRemoteAssets(release, plan);
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'snipvia-public-release-'));
  try {
    for (const asset of plan.assets) {
      if (release.assets.some(item => item.name === asset.name)) continue;
      const file = path.join(staging, asset.name);
      if (asset.source) fs.copyFileSync(asset.source, file, fs.constants.COPYFILE_EXCL);
      else fs.writeFileSync(file, asset.content, { flag: 'wx' });
      ensure(sha256(fs.readFileSync(file)) === asset.sha256, '发布暂存文件已改变');
      gh(['release', 'upload', plan.tag, file, '--repo', repository]);
    }
    release = releaseOrNull(plan.tag); verifyRemoteAssets(release, plan, true);
    gh(['release', 'edit', plan.tag, '--repo', repository, '--notes-file', plan.notesFile, '--draft=false', '--latest']);
    console.log(`已发布：https://github.com/${repository}/releases/tag/${plan.tag}`);
  } finally { fs.rmSync(staging, { recursive: true, force: true }); }
}

if (require.main === module) {
  try {
    const { values } = parseArgs({ options: { directory: { type: 'string' }, notes: { type: 'string' }, execute: { type: 'boolean', default: false } } });
    ensure(values.directory && values.notes, '用法：pnpm release:publish --directory <verified目录> --notes <公开说明.md> [--execute]');
    const plan = planPublication(path.resolve(values.directory), path.resolve(values.notes));
    console.log(JSON.stringify({ repository: plan.repository, tag: plan.tag, sourceCommit: plan.sourceCommit, assets: plan.assets.map(({ name, size }) => ({ name, size })), execute: values.execute }, null, 2));
    if (values.execute) publish(plan);
    else console.log('发布计划校验通过；加 --execute 才创建草稿、上传并发布。');
  } catch (error) {
    console.error(error instanceof Error && !('stderr' in error) ? error.message : 'GitHub 发布失败；草稿如已创建则保留，未覆盖已发布版本');
    process.exitCode = 1;
  }
}
module.exports = { planPublication, verifyRemoteAssets, verifyRemoteSource, releaseOrNull };
