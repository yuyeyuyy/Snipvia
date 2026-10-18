const console = require('node:console');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const process = require('node:process');
const { writeVerificationFiles } = require('./update-metadata.cjs');
const { repository } = require('../../src/shared/release-source.json');
const {
  releaseRoot, appName, version, ensure, run, preflight, releaseEnvironment,
  verifyCode, verifyApp, verifyDmg, verifyZip, digest
} = require('./common.cjs');

function notarizeDmg(file, env) {
  verifyCode(file, [undefined], false);
  const credentials = ['--keychain-profile', env.APPLE_KEYCHAIN_PROFILE];
  if (env.APPLE_KEYCHAIN) credentials.push('--keychain', env.APPLE_KEYCHAIN);
  const result = JSON.parse(run('/usr/bin/xcrun', [
    'notarytool', 'submit', file, ...credentials, '--wait', '--output-format', 'json'
  ], { env }));
  ensure(result.status === 'Accepted' && /^[a-f0-9-]{36}$/i.test(result.id || ''), 'DMG 公证未获得 Accepted；不得分发，保留本次输出供排查。');
  run('/usr/bin/xcrun', ['stapler', 'staple', file], { env });
  return { id: result.id, status: result.status };
}

try {
  ensure(process.argv.length === 3 && process.argv[2] === '--execute',
    '此命令会执行正式签名并上传 Apple 公证。仅在第四阶段获批准后运行：node scripts/macos-release/release.cjs --execute');
  // Fail before building or creating a release directory if the identity is invalid.
  const identity = preflight();
  const runName = `${version}-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  fs.mkdirSync(releaseRoot, { recursive: true });
  const output = path.join(releaseRoot, runName);
  fs.mkdirSync(output); // A fresh directory each time; never overwrite or clean old runs.
  const env = releaseEnvironment(identity, output);
  Object.assign(process.env, env);
  // Remove credentials/debug variables from this process too, for all local validators.
  for (const key of Object.keys(process.env)) {
    if ((/^(APPLE_|CSC_)/.test(key) || key === 'DEBUG' || key === 'DEBUG_COLORS') && !(key in env)) delete process.env[key];
  }
  const credentials = ['--keychain-profile', env.APPLE_KEYCHAIN_PROFILE];
  if (env.APPLE_KEYCHAIN) credentials.push('--keychain', env.APPLE_KEYCHAIN);
  // Read-only credential validation, only in this explicitly authorized release command.
  run('/usr/bin/xcrun', ['notarytool', 'history', ...credentials, '--output-format', 'json'], { env });
  console.log(`正式发布输出：${output}`);
  run('node', ['scripts/prepare-release-build.mjs', '--native'], { env, stdio: 'inherit' });
  const report = { version, teamId: identity.team, identity: identity.name, updateRepository: repository,
    autoUpdateEnabled: true, architectures: [], artifacts: [] };
  for (const arch of ['arm64', 'x64']) {
    console.log(`构建、签名及公证 ${arch} APP。`);
    run('pnpm', ['exec', 'electron-builder', '--config', 'electron-builder.macos-release.cjs', '--mac', 'dmg', 'zip', `--${arch}`, '--publish', 'never'], { env, stdio: 'inherit' });
    const app = path.join(output, arch === 'arm64' ? 'mac-arm64' : 'mac', appName);
    const appVerification = verifyApp(app, arch);
    const dmg = path.join(output, `Snipvia-${version}-${arch}.dmg`);
    const zip = path.join(output, `Snipvia-${version}-${arch}.zip`);
    console.log(`公证、Staple 并验收 ${arch} DMG 与 ZIP。`);
    const notarization = notarizeDmg(dmg, env);
    const dmgVerification = verifyDmg(dmg, arch);
    const zipVerification = verifyZip(zip, arch);
    report.architectures.push({ arch, app: appVerification, dmg: dmgVerification, zip: zipVerification, notarization });
    for (const file of [dmg, zip]) report.artifacts.push({ name: path.basename(file), sha256: digest(file) });
    // Persist successful evidence before the next architecture can fail.
    fs.writeFileSync(path.join(output, 'verification-' + arch + '.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  }
  // Stapling changes the DMG. Regenerate update hashes only after all files are frozen.
  const verified = path.join(output, 'verified');
  const pending = path.join(output, 'verified.pending');
  fs.mkdirSync(pending);
  for (const artifact of report.artifacts) {
    const destination = path.join(pending, artifact.name);
    fs.copyFileSync(path.join(output, artifact.name), destination, fs.constants.COPYFILE_EXCL);
    ensure(digest(destination) === artifact.sha256, '分发副本的 SHA-256 不匹配。');
  }
  writeVerificationFiles(pending, report);
  ensure(!fs.existsSync(verified), '验收目录已存在，拒绝覆盖。');
  fs.renameSync(pending, verified);
  console.log(`全部验收通过；独立 Release 待发布文件：${verified}`);
  console.log('没有上传 GitHub Release 或执行自动发布。Apple Silicon、Intel 真机功能验收仍须记录。');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
