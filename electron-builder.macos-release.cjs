const process = require('node:process');
const { beforePack, sign, afterSign } = require('./scripts/macos-release/hooks.cjs');
const { readBaseConfig } = require('./scripts/macos-release/common.cjs');
const base = readBaseConfig();
const { repository } = require('./src/shared/release-source.json');

// electron-builder 26.15.3: signing fields live directly under mac.
module.exports = {
  ...base,
  // v26 deep-merges functions and concatenates target arrays. Compose once instead.
  extends: null,
  directories: { ...base.directories, output: process.env.SNIPVIA_RELEASE_OUTPUT || 'dist/macos-release' },
  forceCodeSigning: true,
  extraMetadata: { ...base.extraMetadata, snipviaAutoUpdate: true },
  publish: { provider: 'generic', url: `https://github.com/${repository}/releases/latest/download` },
  beforePack,
  afterSign,
  mac: {
    ...base.mac,
    // Never inherit the development configuration's identity: '-'.
    identity: process.env.SNIPVIA_SIGNING_HASH || 'RELEASE_IDENTITY_REQUIRED',
    type: 'distribution',
    hardenedRuntime: true,
    strictVerify: true,
    gatekeeperAssess: false, // Gatekeeper runs after notarization, not before it.
    preAutoEntitlements: false,
    entitlements: 'build/entitlements.release.mac.plist',
    entitlementsInherit: 'build/entitlements.release.electron.plist',
    timestamp: 'http://timestamp.apple.com/ts01',
    sign,
    notarize: true, // v26 accepts a boolean; credentials come from the environment.
    artifactName: 'Snipvia-${version}-${arch}.${ext}',
    target: [
      { target: 'dmg', arch: ['arm64', 'x64'] },
      { target: 'zip', arch: ['arm64', 'x64'] }
    ]
  },
  dmg: { ...base.dmg, sign: true }
};
