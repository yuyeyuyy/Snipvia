import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { legacySettingsFixture } from '../fixtures/legacy-settings';

const runtime = vi.hoisted(() => ({ directory: '' }));
const decrypt = vi.hoisted(() => vi.fn(() => { throw new Error('must not decrypt'); }));
vi.mock('electron', () => ({
  app: { getPath: () => runtime.directory },
  safeStorage: { decryptString: decrypt, encryptString: decrypt, isEncryptionAvailable: decrypt }
}));

beforeEach(() => {
  vi.resetModules(); decrypt.mockClear();
  runtime.directory = mkdtempSync(join(tmpdir(), 'snipvia-settings-'));
});
afterEach(() => rmSync(runtime.directory, { recursive: true, force: true }));
const file = () => join(runtime.directory, 'settings.json');

describe('minimal V2 settings and opaque legacy preservation', () => {
  it('theme writes preserve profiles, unknown fields, encrypted keys and old chat preferences', async () => {
    const before = {
      settings: { ...legacySettingsFixture, futureBehavior: { enabled: true } },
      profiles: { opaqueProfile: { version: 99, untouched: ['not recognized by V2'] } },
      encryptedKey: 'SYNTHETIC_OLD_CIPHERTEXT', encryptedKeys: { untouched: 'SYNTHETIC_EXISTING_CIPHERTEXT' },
      customMetadata: { keep: true }, appearance: { mode: 'system', chatFontSize: 18, futureField: 'keep' }
    };
    writeFileSync(file(), JSON.stringify(before));
    const storage = await import('../../src/main/storage/settings'); storage.loadSettings(); storage.saveAppearanceMode('dark');
    expect(JSON.parse(readFileSync(file(), 'utf8'))).toEqual({ ...before, appearance: { ...before.appearance, mode: 'dark' } });
    expect(decrypt).not.toHaveBeenCalled();
  });

  it('preserves configured old bindings exactly, without migrating the former editor default', async () => {
    const raw = JSON.stringify({ settings: { ...legacySettingsFixture, editorShortcut: 'CommandOrControl+Alt+A' } });
    writeFileSync(file(), raw);
    const storage = await import('../../src/main/storage/settings'); storage.loadSettings();
    expect(storage.legacyCaptureShortcuts()).toEqual({ shortcut: legacySettingsFixture.shortcut, editorShortcut: 'CommandOrControl+Alt+A' });
    expect(readFileSync(file(), 'utf8')).toBe(raw);
  });

  it('does not decrypt, migrate, rewrite or delete old credential files', async () => {
    const raw = JSON.stringify({ settings: legacySettingsFixture, encryptedKey: 'SYNTHETIC_CIPHERTEXT', appearance: { mode: 'dark' } });
    writeFileSync(file(), raw);
    const credentials = { 'credentials.json': '{broken old credentials', 'credentials.key': 'original opaque key' };
    for (const [name, bytes] of Object.entries(credentials)) writeFileSync(join(runtime.directory, name), bytes);
    const storage = await import('../../src/main/storage/settings'); storage.loadSettings();
    expect(storage.appearanceMode()).toBe('dark'); expect(readFileSync(file(), 'utf8')).toBe(raw);
    storage.saveAppearanceMode('light');
    for (const [name, bytes] of Object.entries(credentials)) expect(readFileSync(join(runtime.directory, name), 'utf8')).toBe(bytes);
    expect(decrypt).not.toHaveBeenCalled();
  });

  it.each(['{broken legacy settings', '[]', 'null', '42'])('refuses to overwrite unreadable legacy data (%s)', async raw => {
    writeFileSync(file(), raw);
    const storage = await import('../../src/main/storage/settings');
    expect(() => storage.loadSettings()).toThrow();
    expect(() => storage.saveAppearanceMode('dark')).toThrow('原文件已保留');
    expect(storage.appearanceMode()).toBe('system'); expect(storage.legacyCaptureShortcuts()).toBeUndefined();
    expect(readFileSync(file(), 'utf8')).toBe(raw);
  });

  it('reads shortcuts and appearance independently of invalid retired model and branch data', async () => {
    const raw = JSON.stringify({ settings: { ...legacySettingsFixture, provider: 'retired-provider', endpoint: false, model: null, predictionBranches: '{broken branches' }, appearance: { mode: 'light' } });
    writeFileSync(file(), raw);
    const storage = await import('../../src/main/storage/settings'); storage.loadSettings();
    expect(storage.appearanceMode()).toBe('light');
    expect(storage.legacyCaptureShortcuts()).toEqual({ shortcut: legacySettingsFixture.shortcut, editorShortcut: legacySettingsFixture.editorShortcut });
    expect(readFileSync(file(), 'utf8')).toBe(raw);
  });

  it('writes only appearance for a new install, persists securely, and leaves V2 shortcut defaults independent', async () => {
    const storage = await import('../../src/main/storage/settings'); storage.loadSettings();
    expect(storage.legacyCaptureShortcuts()).toBeUndefined(); storage.saveAppearanceMode('dark');
    expect(JSON.parse(readFileSync(file(), 'utf8'))).toEqual({ appearance: { mode: 'dark' } });
    if (process.platform !== 'win32') expect(statSync(file()).mode & 0o777).toBe(0o600);
    vi.resetModules(); const restarted = await import('../../src/main/storage/settings'); restarted.loadSettings();
    expect(restarted.appearanceMode()).toBe('dark'); expect(restarted.legacyCaptureShortcuts()).toBeUndefined();
  });

  it('preserves fields changed after load and refuses a later corrupted file without changing the active theme', async () => {
    const before = { settings: legacySettingsFixture, appearance: { mode: 'system', unknown: 'original' } };
    writeFileSync(file(), JSON.stringify(before));
    const storage = await import('../../src/main/storage/settings'); storage.loadSettings();
    const concurrent = { ...before, extra: { keep: 'latest' }, appearance: { ...before.appearance, unknown: 'updated' } };
    writeFileSync(file(), JSON.stringify(concurrent)); storage.saveAppearanceMode('dark');
    expect(JSON.parse(readFileSync(file(), 'utf8'))).toEqual({ ...concurrent, appearance: { ...concurrent.appearance, mode: 'dark' } });
    writeFileSync(file(), '{broken later');
    expect(() => storage.saveAppearanceMode('light')).toThrow(); expect(storage.appearanceMode()).toBe('dark');
    expect(readFileSync(file(), 'utf8')).toBe('{broken later');
  });

  it.each([null, [], 'opaque appearance'])('does not replace a malformed appearance payload (%s)', async appearance => {
    const raw = JSON.stringify({ settings: legacySettingsFixture, appearance });
    writeFileSync(file(), raw);
    const storage = await import('../../src/main/storage/settings'); storage.loadSettings();
    expect(() => storage.saveAppearanceMode('dark')).toThrow('原文件已保留');
    expect(readFileSync(file(), 'utf8')).toBe(raw);
  });

  it('defaults an invalid stored theme without rewriting and rejects invalid writes', async () => {
    const raw = JSON.stringify({ settings: legacySettingsFixture, appearance: { mode: 'invalid' } });
    writeFileSync(file(), raw);
    const storage = await import('../../src/main/storage/settings'); storage.loadSettings();
    expect(storage.appearanceMode()).toBe('system');
    expect(() => storage.saveAppearanceMode('invalid' as never)).toThrow();
    expect(readFileSync(file(), 'utf8')).toBe(raw);
  });
});
