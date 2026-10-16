const fs = require('node:fs');
const path = require('node:path');
const process = require('node:process');
const {
  root, appName, appBuilderRequire, ensure, assertReleaseContext, preflight,
  inventory, entitlementFile, binaryArchitectures, verifyApp
} = require('./common.cjs');

function architecture(context) {
  // builder-util Arch enum in the pinned electron-builder version: x64=1, arm64=3.
  ensure(context.arch === 1 || context.arch === 3, '正式发布只允许 arm64、x64。');
  return context.arch === 3 ? 'arm64' : 'x64';
}

async function beforePack(context) {
  assertReleaseContext();
  ensure(context.electronPlatformName === 'darwin', '此配置仅用于 macOS 正式发布。');
  architecture(context);
  const identity = preflight();
  ensure(identity.hash === process.env.SNIPVIA_SIGNING_HASH, '签名身份在预检后发生变化。');
  const config = context.packager.config;
  const mac = context.packager.platformSpecificBuildOptions;
  ensure(config.appId === 'com.snipvia.desktop' && config.productName === 'Snipvia'
    && mac.icon === 'UI/Snipvia-2-mac.icon', '发布配置不得改变应用标识、产品名称或图标。');
  ensure(config.forceCodeSigning === true && mac.identity === identity.hash
    && mac.type === 'distribution' && mac.hardenedRuntime === true && mac.strictVerify === true
    && mac.notarize === true && mac.preAutoEntitlements === false
    && config.dmg?.sign === true, '正式签名、公证或 DMG 签名配置被覆盖。');
  ensure(mac.timestamp === 'http://timestamp.apple.com/ts01'
    && mac.entitlements === 'build/entitlements.release.mac.plist'
    && mac.entitlementsInherit === 'build/entitlements.release.electron.plist', '时间戳或正式 Entitlements 配置被覆盖。');
  ensure(path.resolve(root, config.directories.output) === process.env.SNIPVIA_RELEASE_OUTPUT, '正式发布输出目录被覆盖。');
}

async function sign(options) {
  assertReleaseContext();
  const identity = preflight();
  ensure(options.identity === identity.hash && options.platform === 'darwin' && options.type === 'distribution', '拒绝不符合预检结果的签名请求。');
  const app = path.resolve(options.app);
  ensure(app.startsWith(`${process.env.SNIPVIA_RELEASE_OUTPUT}${path.sep}`), '拒绝签名正式输出目录以外的应用。');
  const { binaries, bundles } = inventory(app);
  const signPaths = new Set([...binaries, ...bundles].map(file => fs.realpathSync(file)));
  const helper = path.join(app, 'Contents/Resources/native/snipvia-capture-helper');
  ensure(binaries.includes(helper), '打包后的 ScreenCaptureKit Helper 缺失或不是 Mach-O。');
  const { signAsync } = appBuilderRequire('@electron/osx-sign');
  // Use the already installed, pinned signer. Its traversal signs deepest code first,
  // including Electron Framework and app.asar.unpacked Mach-O files; the APP is last.
  await signAsync({
    ...options,
    identity: identity.hash,
    identityValidation: false, // preflight enforces security's valid codesigning identities.
    keychain: identity.keychain || options.keychain,
    binaries: [...new Set([...(options.binaries || []), ...binaries])],
    // Ordinary resources are sealed by the containing bundle. Sign every Mach-O
    // and code bundle, without signing .pak/.car data as standalone executables.
    ignore: file => !signPaths.has(fs.realpathSync(file)),
    strictVerify: true,
    preAutoEntitlements: false,
    optionsForFile: (file) => ({
      entitlements: entitlementFile(app, file),
      hardenedRuntime: true,
      timestamp: 'http://timestamp.apple.com/ts01',
      additionalArguments: file === helper ? ['--identifier', 'com.snipvia.desktop.capture-helper'] : []
    })
  });
  const arches = binaryArchitectures(path.join(app, 'Contents/MacOS/Snipvia'));
  ensure(arches.length === 1, '正式 APP 必须是独立架构，不能进行 Universal 合并。');
  verifyApp(app, arches[0] === 'arm64' ? 'arm64' : 'x64', false);
  // Returning allows v26's built-in keychain notarization and APP stapling to run.
}

async function afterSign(context) {
  assertReleaseContext();
  verifyApp(path.join(context.appOutDir, appName), architecture(context));
}

module.exports = { beforePack, sign, afterSign };
