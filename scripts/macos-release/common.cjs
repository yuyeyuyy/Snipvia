const { execFileSync, spawnSync } = require('node:child_process');
const { Buffer } = require('node:buffer');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const { tmpdir } = require('node:os');
const path = require('node:path');
const process = require('node:process');

const root = path.resolve(path.dirname(module.filename), '../..');
const releaseRoot = path.join(root, 'dist/macos-release');
const appName = 'Snipvia.app';
const bundleId = 'com.snipvia.desktop';
// Public release identifiers, never credentials or private key material.
const releaseTeamId = 'F76JCDMA4Y';
const releaseIdentity = 'BFF84DE0E09178F88BABE1BAD7C60F6B0FFECD8F';
const notaryProfile = 'snipvia-notary';
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const builderRequire = createRequire(require.resolve('electron-builder'));
const appBuilderRequire = createRequire(builderRequire.resolve('app-builder-lib'));

function readBaseConfig() {
  // Reuse builder's pinned YAML parser; do not add or upgrade dependencies.
  return appBuilderRequire('js-yaml').load(fs.readFileSync(path.join(root, 'electron-builder.yml'), 'utf8'));
}

function ensure(condition, message) {
  if (!condition) throw new Error(message);
}

function run(command, args, options = {}) {
  try {
    return execFileSync(command, args, {
      cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'], ...options
    });
  } catch (error) {
    // Never echo the environment, command arguments, or tool error payloads.
    throw new Error(`${path.basename(command)} 执行失败（${error.status ?? '启动失败'}）；流程已停止。`);
  }
}

function combinedOutput(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8', maxBuffer: 1024 * 1024
  });
  ensure(result.status === 0, `${path.basename(command)} 验证失败；流程已停止。`);
  return `${result.stdout || ''}\n${result.stderr || ''}`;
}

function metadata(file, arch) {
  return combinedOutput('/usr/bin/codesign', ['-d', '-vvv', ...(arch ? ['--arch', arch] : []), file]);
}

function assess(args) {
  const result = combinedOutput('/usr/sbin/spctl', args);
  ensure(/\baccepted\b/.test(result) && /^source=Notarized Developer ID\s*$/m.test(result),
    'Gatekeeper 未确认 Notarized Developer ID，禁止分发。');
}

function teamId() {
  const team = process.env.SNIPVIA_RELEASE_TEAM_ID || releaseTeamId;
  ensure(team === releaseTeamId, 'Team ID 必须为已批准的 F76JCDMA4Y。');
  return team;
}

function checkVersions() {
  ensure(process.platform === 'darwin', '正式 macOS 发布必须在 macOS 执行。');
  ensure(/^v24\.15\./.test(process.version), '需要 Node.js 24.15.x。');
  ensure(run('pnpm', ['--version']).trim() === '11.1.3', '需要 pnpm 11.1.3。');
  for (const [loader, name, expected] of [
    [builderRequire, 'electron-builder', '26.15.3'],
    [appBuilderRequire, '@electron/osx-sign', '1.3.3'],
    [appBuilderRequire, '@electron/notarize', '2.5.0']
  ]) {
    ensure(loader(`${name}/package.json`).version === expected, `${name} 版本与审核版本不一致。`);
  }
}

function preflight() {
  checkVersions();
  const team = teamId();
  const keychain = process.env.SNIPVIA_SIGNING_KEYCHAIN;
  if (keychain) {
    const searchList = run('/usr/bin/security', ['list-keychains', '-d', 'user']);
    ensure(searchList.includes(`"${keychain}"`), '签名钥匙串不在用户搜索列表中；本脚本不会修改搜索列表。');
  }
  const text = run('/usr/bin/security', ['find-identity', '-v', '-p', 'codesigning', ...(keychain ? [keychain] : [])]);
  const identities = [...text.matchAll(/^\s*\d+\)\s+([A-Fa-f0-9]{40})\s+"(Developer ID Application: [^"]+)"\s*$/gm)]
    .map((match) => ({ hash: match[1].toUpperCase(), name: match[2] }))
    .filter((identity) => identity.name.endsWith(`(${team})`));
  const requested = process.env.SNIPVIA_SIGNING_HASH || process.env.SNIPVIA_SIGNING_IDENTITY || releaseIdentity;
  const matches = identities.filter((identity) => !requested || identity.name === requested || identity.hash === requested.toUpperCase());
  ensure(matches.length === 1, matches.length === 0
    ? '没有符合 Team ID 的有效 Developer ID Application 签名身份；禁止临时签名或无签名降级。'
    : '存在多个有效身份，请通过 SNIPVIA_SIGNING_IDENTITY 指定完整名称或指纹。');
  const profile = process.env.SNIPVIA_NOTARY_PROFILE || process.env.APPLE_KEYCHAIN_PROFILE || notaryProfile;
  ensure(profile && !/[\r\n\0]/.test(profile), '请设置 SNIPVIA_NOTARY_PROFILE 或 APPLE_KEYCHAIN_PROFILE。');
  const notaryKeychain = process.env.SNIPVIA_NOTARY_KEYCHAIN || process.env.APPLE_KEYCHAIN;
  if (notaryKeychain) ensure(fs.existsSync(notaryKeychain), '公证钥匙串文件不存在。');
  const developerDir = process.env.DEVELOPER_DIR || '/Applications/Xcode.app/Contents/Developer';
  ensure(fs.existsSync(path.join(developerDir, 'usr/bin/xcodebuild')), '需要完整 Xcode。');
  const toolEnv = { ...process.env, DEVELOPER_DIR: developerDir };
  run('/usr/bin/xcrun', ['notarytool', '--version'], { env: toolEnv });
  return { ...matches[0], team, profile, notaryKeychain, keychain, developerDir };
}

function releaseEnvironment(identity, output) {
  const env = { ...process.env };
  // v26 checks Apple ID/API credentials before keychain credentials. Force keychain-only auth.
  for (const key of Object.keys(env)) {
    if (/^(APPLE_|CSC_|SNIPVIA_SIGNING_|SNIPVIA_RELEASE_)/.test(key) || key === 'DEBUG' || key === 'DEBUG_COLORS') delete env[key];
  }
  Object.assign(env, {
    DEVELOPER_DIR: identity.developerDir,
    APPLE_KEYCHAIN_PROFILE: identity.profile,
    SNIPVIA_RELEASE_TEAM_ID: identity.team,
    SNIPVIA_SIGNING_HASH: identity.hash,
    SNIPVIA_RELEASE_OUTPUT: output,
    SNIPVIA_RELEASE_APPROVED: '1',
    CSC_IDENTITY_AUTO_DISCOVERY: 'true'
  });
  if (identity.notaryKeychain) env.APPLE_KEYCHAIN = identity.notaryKeychain;
  if (identity.keychain) env.SNIPVIA_SIGNING_KEYCHAIN = identity.keychain;
  return env;
}

function assertReleaseContext() {
  ensure(process.env.SNIPVIA_RELEASE_APPROVED === '1', '请通过 release.cjs --execute 启动正式发布。');
  ensure(/^[A-F0-9]{40}$/.test(process.env.SNIPVIA_SIGNING_HASH || ''), '缺少经过预检的签名指纹。');
  const output = process.env.SNIPVIA_RELEASE_OUTPUT;
  ensure(output && path.isAbsolute(output) && output.startsWith(`${releaseRoot}${path.sep}`), '正式发布输出必须位于独立 dist/macos-release 子目录。');
  ensure(process.env.APPLE_KEYCHAIN_PROFILE, '缺少钥匙串公证 Profile。');
  for (const key of ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER', 'CSC_LINK', 'CSC_KEY_PASSWORD', 'DEBUG']) {
    ensure(!process.env[key], `正式发布不接受 ${key}；只使用钥匙串凭据。`);
  }
  teamId();
}

function archName(arch) {
  ensure(arch === 'arm64' || arch === 'x64', '架构必须为 arm64 或 x64。');
  return arch === 'x64' ? 'x86_64' : 'arm64';
}

function binaryArchitectures(file) {
  return run('/usr/bin/lipo', ['-archs', file]).trim().split(/\s+/);
}

function inventory(app) {
  const binaries = [];
  const bundles = [app];
  const boundary = `${fs.realpathSync(app)}${path.sep}`;
  function walk(directory) {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, item.name);
      if (item.isSymbolicLink()) {
        ensure(fs.realpathSync(file).startsWith(boundary), '应用包含指向包外的符号链接。');
      } else if (item.isDirectory()) {
        if (/\.(app|framework|xpc|appex)$/.test(item.name)) bundles.push(file);
        walk(file);
      } else if (item.isFile()) {
        const header = Buffer.alloc(4);
        const fd = fs.openSync(file, 'r');
        try { fs.readSync(fd, header, 0, 4, 0); } finally { fs.closeSync(fd); }
        if (['feedface', 'cefaedfe', 'feedfacf', 'cffaedfe', 'cafebabe', 'bebafeca', 'cafebabf', 'bfbafeca'].includes(header.toString('hex'))
          && run('/usr/bin/file', ['-b', file]).includes('Mach-O')) binaries.push(file);
      }
    }
  }
  walk(path.join(app, 'Contents'));
  return { binaries, bundles };
}

function entitlementFile(app, file) {
  if (file === app || file === path.join(app, 'Contents/MacOS/Snipvia')) return path.join(root, 'build/entitlements.release.mac.plist');
  if (/\/Contents\/Frameworks\/Snipvia Helper(?: \([^)]+\))?\.app(?:\/|$)/.test(file)) return path.join(root, 'build/entitlements.release.electron.plist');
  return path.join(root, 'build/entitlements.release.native.plist');
}

function requirement() {
  return `anchor apple generic and certificate leaf[subject.OU] = "${teamId()}" and certificate 1[field.1.2.840.113635.100.6.2.6] exists and certificate leaf[field.1.2.840.113635.100.6.1.13] exists`;
}

function verifyCode(file, arches, runtime) {
  run('/usr/bin/codesign', ['--verify', '--strict', '--all-architectures', `-R=${requirement()}`, file]);
  for (const arch of arches) {
    const info = metadata(file, arch);
    ensure(/^TeamIdentifier=([A-Z0-9]{10})\s*$/m.exec(info)?.[1] === teamId(), `Team ID 不匹配：${path.basename(file)}`);
    ensure(/^Authority=Developer ID Application: /m.test(info) && !/Signature=adhoc|flags=.*\badhoc\b/.test(info), `不是正式 Developer ID 签名：${path.basename(file)}`);
    ensure(/^Timestamp=.+/m.test(info), `缺少安全时间戳：${path.basename(file)}`);
    if (runtime) ensure(/flags=.*\bruntime\b/.test(info), `未启用 Hardened Runtime：${path.basename(file)}`);
  }
}

function plist(file) {
  return JSON.parse(run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', file]));
}

function verifyEntitlements(app, file, arch) {
  const xml = run('/usr/bin/codesign', ['-d', '--arch', arch, '--entitlements', ':-', file]);
  const actual = xml.trim() ? JSON.parse(run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '-'], { input: xml })) : {};
  const expected = plist(entitlementFile(app, file));
  ensure(Object.keys(actual).length === Object.keys(expected).length
    && Object.entries(expected).every(([key, value]) => actual[key] === value), `Entitlements 与最小权限配置不一致：${path.basename(file)}`);
}

function verifyApp(app, arch, notarized = true) {
  app = path.resolve(app);
  const target = archName(arch);
  const info = plist(path.join(app, 'Contents/Info.plist'));
  ensure(info.CFBundleIdentifier === bundleId && info.CFBundleExecutable === 'Snipvia'
    && info.CFBundleShortVersionString === version, 'APP 标识、可执行文件或版本不匹配。');
  ensure(info.LSMinimumSystemVersion === '14.0', '最低 macOS 版本发生变化。');
  const main = path.join(app, 'Contents/MacOS/Snipvia');
  const helper = path.join(app, 'Contents/Resources/native/snipvia-capture-helper');
  const framework = path.join(app, 'Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework');
  ensure(binaryArchitectures(main).join(' ') === target && binaryArchitectures(framework).join(' ') === target, 'Electron 主程序或 Framework 架构不匹配。');
  const helperArches = binaryArchitectures(helper);
  ensure(helperArches.length === 2 && helperArches.includes('arm64') && helperArches.includes('x86_64'), 'Swift Helper 必须包含 arm64 和 x86_64。');
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--all-architectures', app]);
  const { binaries, bundles } = inventory(app);
  for (const file of binaries) {
    const arches = binaryArchitectures(file);
    verifyCode(file, arches, true);
    for (const slice of arches) verifyEntitlements(app, file, slice);
  }
  for (const bundle of bundles) verifyCode(bundle, [target], true);
  if (notarized) {
    run('/usr/bin/xcrun', ['stapler', 'validate', app]);
    assess(['--assess', '--type', 'execute', '--verbose=4', app]);
  }
  return { arch, binaries: binaries.length, bundles: bundles.length, notarized };
}

function verifyDmg(dmg, arch) {
  dmg = path.resolve(dmg);
  verifyCode(dmg, [undefined], false); // Disk images do not have Hardened Runtime.
  run('/usr/bin/hdiutil', ['verify', dmg]);
  run('/usr/bin/xcrun', ['stapler', 'validate', dmg]);
  assess(['--assess', '--type', 'open', '--context', 'context:primary-signature', '--verbose=4', dmg]);
  const mount = fs.mkdtempSync(path.join(tmpdir(), 'snipvia-release-dmg-'));
  let mounted = false;
  try {
    run('/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-noautoopen', '-mountpoint', mount, dmg]);
    mounted = true;
    return verifyApp(path.join(mount, appName), arch);
  } finally {
    if (mounted) run('/usr/bin/hdiutil', ['detach', mount]);
    // If detach fails, control exits before removal; never delete a mounted filesystem.
    fs.rmSync(mount, { recursive: true, force: true });
  }
}

function verifyZip(zip, arch) {
  zip = path.resolve(zip);
  run('/usr/bin/unzip', ['-tq', zip]);
  const entries = run('/usr/bin/unzip', ['-Z1', zip]).trim().split('\n');
  ensure(entries.length > 0 && new Set(entries).size === entries.length
    && entries.every((entry) => entry.startsWith(`${appName}/`)
    && !entry.split('/').includes('..') && !entry.includes('\\')), 'ZIP 必须仅包含 Snipvia.app，且不得包含越界路径。');
  // Check stored symlink targets before extraction, not only after writing files.
  const listing = run('/usr/bin/unzip', ['-Z', '-l', zip]).split('\n');
  for (const line of listing.filter((entry) => /^l[rwx-]{9}\s/.test(entry))) {
    const candidates = entries.filter((entry) => line.endsWith(` ${entry}`));
    ensure(candidates.length === 1, '无法唯一识别 ZIP 符号链接。');
    const entry = candidates[0];
    const target = run('/usr/bin/unzip', ['-p', zip, entry]);
    const resolved = path.posix.resolve('/', path.posix.dirname(entry), target);
    ensure(target && !target.includes('\0') && !target.includes('\\') && !path.posix.isAbsolute(target)
      && resolved.startsWith(`/${appName}/`), 'ZIP 包含指向应用包外的符号链接。');
  }
  const directory = fs.mkdtempSync(path.join(tmpdir(), 'snipvia-release-zip-'));
  try {
    run('/usr/bin/ditto', ['-x', '-k', zip, directory]);
    // ZIP cannot be signed or stapled. Verify its extracted, stapled APP instead.
    return verifyApp(path.join(directory, appName), arch);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function digest(file) {
  const hash = createHash('sha256');
  const buffer = Buffer.alloc(1024 * 1024);
  const fd = fs.openSync(file, 'r');
  try {
    let count;
    while ((count = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, count));
  } finally { fs.closeSync(fd); }
  return hash.digest('hex');
}

module.exports = {
  root, releaseRoot, appName, version, appBuilderRequire, readBaseConfig, ensure, run, teamId,
  preflight, releaseEnvironment, assertReleaseContext, inventory, entitlementFile,
  binaryArchitectures, verifyApp, verifyCode, verifyDmg, verifyZip, digest
};
