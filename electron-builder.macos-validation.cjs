const path = require('node:path');
const { randomUUID } = require('node:crypto');
const process = require('node:process');
const { root, ensure } = require('./scripts/macos-release/common.cjs');
const release = require('./electron-builder.macos-release.cjs');

// Third-stage packaging validation is intentionally unsigned and cannot notarize.
module.exports = {
  ...release,
  extends: null,
  directories: { ...release.directories, output: `dist/macos-validation/${Date.now()}-${randomUUID().slice(0, 8)}` },
  forceCodeSigning: false,
  beforePack: (context) => {
    const config = context.packager.config;
    const mac = context.packager.platformSpecificBuildOptions;
    ensure(context.electronPlatformName === 'darwin' && mac.identity === null
      && mac.sign === null && mac.notarize === false && config.forceCodeSigning === false
      && config.dmg?.sign === false, '验证构建禁止签名和公证。');
    ensure(path.resolve(root, config.directories.output).startsWith(`${path.join(root, 'dist/macos-validation')}${path.sep}`),
      '验证构建必须使用独立输出目录。');
    ensure(process.env.CSC_IDENTITY_AUTO_DISCOVERY === 'false', '验证构建需设置 CSC_IDENTITY_AUTO_DISCOVERY=false。');
  },
  afterSign: null,
  mac: { ...release.mac, identity: null, sign: null, notarize: false, target: [{ target: 'dir', arch: ['arm64', 'x64'] }] },
  dmg: { ...release.dmg, sign: false }
};
