import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
type Config = {
  forceCodeSigning: boolean;
  extraMetadata: { snipviaAutoUpdate: boolean };
  mac: { identity: string | null; sign: unknown; notarize: boolean };
  beforePack(context: unknown): void;
};
const validation = require('../../electron-builder.macos-validation.cjs') as Config;
const release = require('../../electron-builder.macos-release.cjs') as Config;
afterEach(() => vi.unstubAllEnvs());

describe('internal and release packaging boundaries', () => {
  it('disables installation updates, production signing and notarization in the actual validation configuration', () => {
    expect(validation.extraMetadata.snipviaAutoUpdate).toBe(false);
    expect(validation.forceCodeSigning).toBe(false);
    expect(validation.mac).toMatchObject({ identity: null, sign: null, notarize: false });
  });
  it('refuses a CLI override that re-enables updates in an unsigned validation build', () => {
    vi.stubEnv('CSC_IDENTITY_AUTO_DISCOVERY', 'false');
    const context = (config: Config) => ({ electronPlatformName: 'darwin', packager: { config, platformSpecificBuildOptions: config.mac } });
    expect(() => validation.beforePack(context(validation))).not.toThrow();
    const changed = { ...validation, extraMetadata: { snipviaAutoUpdate: true } };
    expect(() => validation.beforePack(context(changed))).toThrow('未签名验证包不得启用安装更新');
  });
  it('keeps the real release signed, notarized and configured for explicit installation updates', () => {
    expect(release.forceCodeSigning).toBe(true);
    expect(release.extraMetadata.snipviaAutoUpdate).toBe(true);
    expect(release.mac.notarize).toBe(true);
    expect(typeof release.mac.sign).toBe('function');
  });
});
