import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaults, settingsSchema } from '../../src/shared/contracts';
import { credentialScope, providerFor } from '../../src/shared/providers';

const runtime = vi.hoisted(() => ({ directory: '', available: true, encryptFails: false }));
vi.mock('electron', () => ({
  app: { getPath: () => runtime.directory },
  safeStorage: {
    isEncryptionAvailable: () => runtime.available,
    encryptString: (key: string) => {
      if (runtime.encryptFails) throw new Error('keychain failure');
      return Buffer.from('protected:' + Buffer.from(key).toString('base64'));
    },
    decryptString: (ciphertext: Buffer) => {
      const text = ciphertext.toString();
      if (!text.startsWith('protected:')) throw new Error('invalid ciphertext');
      return Buffer.from(text.slice('protected:'.length), 'base64').toString();
    }
  }
}));

function writeLegacyEncryptedCredentials(keys: Record<string, string>) {
  const key = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  cipher.setAAD(Buffer.from('snipvia.credentials.v1'));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify({ keys }), 'utf8'), cipher.final()]);
  writeFileSync(join(runtime.directory, 'credentials.key'), key);
  writeFileSync(join(runtime.directory, 'credentials.json'), JSON.stringify({
    version: 1, algorithm: 'aes-256-gcm', iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64')
  }));
}

beforeEach(() => {
  vi.resetModules();
  runtime.directory = mkdtempSync(join(tmpdir(), 'snipvia-settings-'));
  runtime.available = true;
  runtime.encryptFails = false;
});
afterEach(() => rmSync(runtime.directory, { recursive: true, force: true }));

describe('provider credentials', () => {
  it('V2 preserves a configured old screenshot accelerator and refuses to overwrite a damaged legacy file later', async () => {
    const path = join(runtime.directory, 'settings.json');
    const raw = JSON.stringify({ settings: { ...defaults, editorShortcut: 'CommandOrControl+Alt+A' }, encryptedKeys: {} });
    writeFileSync(path, raw);
    const storage = await import('../../src/main/storage/settings');
    storage.loadSettings({ migrateCredentials: false });
    expect(storage.publicSettings().editorShortcut).toBe('CommandOrControl+Alt+A');
    expect(readFileSync(path, 'utf8')).toBe(raw);
    writeFileSync(path, '{broken legacy settings');
    expect(() => storage.loadSettings({ migrateCredentials: false })).toThrow();
    expect(() => storage.saveAppearanceMode('dark')).toThrow('原文件已保留');
    expect(() => storage.saveChatFontSize(20)).toThrow('原文件已保留');
    expect(readFileSync(path, 'utf8')).toBe('{broken legacy settings');
  });

  it('V2 loads appearance and shortcuts without decrypting, migrating, rewriting or deleting old credentials', async () => {
    const path = join(runtime.directory, 'settings.json'), raw = JSON.stringify({ settings: defaults, encryptedKey: 'SYNTHETIC_CIPHERTEXT', appearance: { mode: 'dark', chatFontSize: 18 } });
    writeFileSync(path, raw);
    writeFileSync(join(runtime.directory, 'credentials.json'), '{broken old credentials');
    writeFileSync(join(runtime.directory, 'credentials.key'), 'original opaque key');
    runtime.available = false;
    const storage = await import('../../src/main/storage/settings');
    storage.loadSettings({ migrateCredentials: false });
    expect(storage.appearanceMode()).toBe('dark'); expect(storage.chatFontSize()).toBe(18);
    expect(storage.publicSettings().shortcut).toBe(defaults.shortcut);
    expect(readFileSync(path, 'utf8')).toBe(raw);
    expect(readFileSync(join(runtime.directory, 'credentials.json'), 'utf8')).toBe('{broken old credentials');
    expect(readFileSync(join(runtime.directory, 'credentials.key'), 'utf8')).toBe('original opaque key');
  });

  it('confirmed branch edits preserve current model, encrypted keys and appearance; stale versions leave storage unchanged', async () => {
    const storage = await import('../../src/main/storage/settings');
    storage.saveSettings(defaults, 'synthetic-branch-key'); storage.saveAppearanceMode('dark');
    const expected = createHash('sha256').update(JSON.stringify(storage.publicSettings().predictionBranches)).digest('hex');
    // Preferences may change while the user is reviewing an otherwise valid branch proposal.
    storage.saveSettings({ ...defaults, model: 'new-current-model' });
    const path = join(runtime.directory, 'settings.json'); const before = JSON.parse(readFileSync(path, 'utf8'));
    const next = defaults.predictionBranches.map(branch => branch.id === 'explain-code' ? { ...branch, label: '算法代码讲解' } : branch);
    storage.savePredictionBranches(expected, next);
    expect(storage.publicSettings().model).toBe('new-current-model'); expect(storage.readKey()).toBe('synthetic-branch-key');
    expect(storage.publicSettings().predictionBranches).toEqual(next);
    const saved = readFileSync(path, 'utf8'); const after = JSON.parse(saved);
    expect(after.encryptedKeys).toEqual(before.encryptedKeys); expect(after.appearance).toEqual(before.appearance);
    expect(() => storage.savePredictionBranches(expected, defaults.predictionBranches)).toThrow('已变化');
    expect(readFileSync(path, 'utf8')).toBe(saved); expect(storage.publicSettings().predictionBranches).toEqual(next);
  });
  it('defaults legacy settings to System and persists appearance independently of model profiles', async () => {
    writeFileSync(join(runtime.directory, 'settings.json'), JSON.stringify({ settings: defaults }));
    const storage = await import('../../src/main/storage/settings'); storage.loadSettings();
    expect(storage.appearanceMode()).toBe('system');
    storage.saveSettings(defaults, 'theme-test-key');
    storage.saveAppearanceMode('dark');
    storage.saveSettings({ ...defaults, model: 'another-fixture-model' });
    expect(storage.appearanceMode()).toBe('dark');
    expect(storage.readKey()).toBe('theme-test-key');
    expect(statSync(join(runtime.directory, 'settings.json')).mode & 0o777).toBe(0o600);
    vi.resetModules(); const restarted = await import('../../src/main/storage/settings'); restarted.loadSettings();
    expect(restarted.appearanceMode()).toBe('dark');
    expect(restarted.readKey()).toBe('theme-test-key');
    expect(restarted.publicSettings().configuredModels).toHaveLength(1);
  });

  it('chat font defaults old settings, persists independently and preserves encrypted model credentials', async () => {
    writeFileSync(join(runtime.directory, 'settings.json'), JSON.stringify({ settings: defaults, appearance: { mode: 'dark' } }));
    const storage = await import('../../src/main/storage/settings'); storage.loadSettings();
    expect(storage.chatFontSize()).toBe(15); storage.saveSettings(defaults, 'synthetic-font-key');
    const before = JSON.parse(readFileSync(join(runtime.directory, 'settings.json'), 'utf8'));
    storage.saveChatFontSize(20); storage.saveAppearanceMode('light'); storage.saveSettings({ ...defaults, model: 'font-fixture-model' });
    expect(storage.chatFontSize()).toBe(20); expect(storage.readKey()).toBe('synthetic-font-key');
    expect(JSON.parse(readFileSync(join(runtime.directory, 'settings.json'), 'utf8')).encryptedKeys).toEqual(before.encryptedKeys);
    const saved = readFileSync(join(runtime.directory, 'settings.json'), 'utf8');
    for (const invalid of [0, 25, 15.5, NaN, Infinity]) expect(() => storage.saveChatFontSize(invalid)).toThrow();
    expect(readFileSync(join(runtime.directory, 'settings.json'), 'utf8')).toBe(saved);
    vi.resetModules(); const restarted = await import('../../src/main/storage/settings'); restarted.loadSettings();
    expect(restarted.chatFontSize()).toBe(20); expect(restarted.appearanceMode()).toBe('light');
  });

  it('rejects invalid appearance writes and tolerates an invalid stored preference without losing model settings', async () => {
    const storage = await import('../../src/main/storage/settings');
    storage.saveSettings(defaults, 'theme-test-key');
    const path = join(runtime.directory, 'settings.json'); const saved = readFileSync(path, 'utf8');
    expect(() => storage.saveAppearanceMode('invalid' as never)).toThrow();
    expect(readFileSync(path, 'utf8')).toBe(saved);
    writeFileSync(path, JSON.stringify({ ...JSON.parse(saved), appearance: { mode: 'invalid' } }));
    vi.resetModules(); const restarted = await import('../../src/main/storage/settings'); restarted.loadSettings();
    expect(restarted.appearanceMode()).toBe('system');
    expect(restarted.readKey()).toBe('theme-test-key');
  });

  it('在新增厂商及同厂商不同接口之间切换时，独立保存密钥并在重启后恢复', async () => {
    const storage = await import('../../src/main/storage/settings');
    const configurations = [
      { ...defaults, provider: 'deepseek' as const, endpoint: providerFor('deepseek').endpoint, model: 'deepseek-flash' },
      { ...defaults, provider: 'kimi' as const, endpoint: providerFor('kimi').endpoint, model: 'kimi-k2.6' },
      { ...defaults, provider: 'qwen' as const, endpoint: providerFor('qwen').endpoint, model: 'qwen3-vl-plus' },
      { ...defaults, provider: 'qwen' as const, endpoint: 'https://maas.qianwenaiapi.com/compatible-mode/v1', model: 'qwen3-vl-plus' }
    ];
    configurations.forEach((settings, index) => storage.saveSettings(settings, `synthetic-key-${index}`));
    for (const [index, settings] of configurations.entries()) { storage.saveSettings(settings); expect(storage.readKey()).toBe(`synthetic-key-${index}`); }
    vi.resetModules(); const restarted = await import('../../src/main/storage/settings'); restarted.loadSettings();
    expect(restarted.publicSettings().configuredModels).toHaveLength(4);
    for (const [index, settings] of configurations.entries()) { restarted.saveSettings(settings); expect(restarted.readKey()).toBe(`synthetic-key-${index}`); }
    expect(readFileSync(join(runtime.directory, 'settings.json'), 'utf8')).not.toContain('synthetic-key-');
  });
  it.each([
    ['CommandOrControl+Alt+A', defaults.shortcut, defaults.editorShortcut],
    ['CommandOrControl+Alt+F8', defaults.shortcut, 'CommandOrControl+Alt+F8'],
    ['CommandOrControl+Alt+A', defaults.editorShortcut, 'CommandOrControl+Alt+A']
  ])('updates the previous editor default while retaining custom or conflicting bindings (%s, %s)', async (editorShortcut, shortcut, expected) => {
    writeFileSync(join(runtime.directory, 'settings.json'), JSON.stringify({ settings: { ...defaults, shortcut, editorShortcut } }));
    const storage = await import('../../src/main/storage/settings');
    storage.loadSettings();
    expect(storage.publicSettings().editorShortcut).toBe(expected);
    expect(storage.publicSettings().shortcut).toBe(shortcut);
  });

  it('migrates the editor shortcut without colliding with a previously customized shortcut', async () => {
    const legacy = { ...defaults, shortcut: defaults.editorShortcut, editorShortcut: undefined };
    writeFileSync(join(runtime.directory, 'settings.json'), JSON.stringify({ settings: legacy }));
    const storage = await import('../../src/main/storage/settings');
    storage.loadSettings();
    expect(storage.publicSettings().shortcut).toBe(legacy.shortcut);
    expect(storage.publicSettings().editorShortcut).toBe('CommandOrControl+Alt+S');
  });

  it('preserves edited built-in branches and HTTP endpoints across restart', async () => {
    const storage = await import('../../src/main/storage/settings');
    const settings = settingsSchema.parse({
      ...defaults, provider: 'custom', endpoint: 'http://192.168.1.10:8080/v1',
      predictionBranches: defaults.predictionBranches.map((branch) => branch.id === 'explain-code'
        ? { ...branch, label: '审查代码', trigger: 'question', applicableContent: '仅 TypeScript 代码中的异步处理，不包括其他语言。', prompt: '寻找潜在缺陷。', enabled: false, notebookId: '10000000-0000-4000-8000-000000000001' } : branch)
    });
    storage.saveSettings(settings);
    vi.resetModules();
    const reloaded = await import('../../src/main/storage/settings');
    reloaded.loadSettings();
    expect(reloaded.publicSettings().endpoint).toBe(settings.endpoint);
    expect(reloaded.publicSettings().predictionBranches).toEqual(settings.predictionBranches);
  });

  it.each([true, false])('removes retired branches from saved settings and profiles without losing customizations (legacy active settings: %s)', async (legacyActiveSettings) => {
    const retainedBranches = [
      ...defaults.predictionBranches.map((branch) => branch.id === 'explain-code'
        ? { ...branch, label: '审查代码', trigger: 'question' as const, prompt: '寻找潜在缺陷。', enabled: false, notebookId: '10000000-0000-4000-8000-000000000001' }
        : branch),
      {
        id: 'custom:786412d8-f0ea-470c-9211-2092994a85cc', trigger: 'table' as const,
        label: '整理表格', runningLabel: '正在整理表格…', prompt: '提取表格中的重点。',
        enabled: true, builtin: false, mode: 'ai' as const
      }
    ];
    const retiredBranches = ([
      ['understand-text', 'text'], ['analyze-table', 'table'], ['analyze-ui', 'ui'], ['describe-image', 'unknown']
    ] as const).map(([id, trigger]) => ({
      id, trigger, label: `旧分支 ${id}`, runningLabel: '正在处理…', prompt: '旧版指令', enabled: true, builtin: true, mode: 'ai' as const
    }));
    const settings = { ...defaults, predictionBranches: legacyActiveSettings ? [...retainedBranches, ...retiredBranches] : retainedBranches };
    const qwen = {
      ...defaults, provider: 'qwen' as const, endpoint: providerFor('qwen').endpoint, model: 'qwen-vl-plus',
      predictionBranches: [...retainedBranches, ...retiredBranches]
    };
    const encryptedKeys = {
      [credentialScope(settings)]: Buffer.from('protected:' + Buffer.from('existing-test-key').toString('base64')).toString('base64')
    };
    const path = join(runtime.directory, 'settings.json');
    writeFileSync(path, JSON.stringify({ settings, encryptedKeys, profiles: { [credentialScope(qwen)]: qwen } }));
    runtime.available = false;
    const storage = await import('../../src/main/storage/settings');
    storage.loadSettings();
    expect(storage.publicSettings().predictionBranches).toEqual(retainedBranches);
    const migrated = JSON.parse(readFileSync(path, 'utf8'));
    expect(migrated.settings.predictionBranches).toEqual(retainedBranches);
    expect(migrated.profiles[credentialScope(qwen)]).toEqual({ ...qwen, predictionBranches: retainedBranches });
    expect(migrated.encryptedKeys).toEqual(encryptedKeys);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    runtime.available = true;
    expect(storage.readKey()).toBe('existing-test-key');
    const persisted = readFileSync(path, 'utf8');
    vi.resetModules();
    const reloaded = await import('../../src/main/storage/settings');
    reloaded.loadSettings();
    expect(reloaded.publicSettings().predictionBranches).toEqual(retainedBranches);
    expect(readFileSync(path, 'utf8')).toBe(persisted);
  });

  it('isolates keys between providers and restores them after restart', async () => {
    const storage = await import('../../src/main/storage/settings');
    storage.saveSettings(defaults, 'openai-test-key');
    const qwen = settingsSchema.parse({ ...defaults, provider: 'qwen', endpoint: providerFor('qwen').endpoint, model: 'qwen-vl-plus' });
    storage.saveSettings(qwen);
    expect(storage.readKey()).toBe('');
    storage.saveSettings(qwen, 'qwen-test-key');
    storage.saveSettings(defaults);
    expect(storage.readKey()).toBe('openai-test-key');
    storage.saveSettings(defaults, '');
    storage.saveSettings(qwen);
    expect(storage.readKey()).toBe('qwen-test-key');
    const saved = readFileSync(join(runtime.directory, 'settings.json'), 'utf8');
    expect(saved).not.toContain('qwen-test-key');
    expect(JSON.parse(saved).encryptedKeys[credentialScope(qwen)]).toBeTruthy();
    expect(statSync(join(runtime.directory, 'settings.json')).mode & 0o777).toBe(0o600);
    expect(existsSync(join(runtime.directory, 'credentials.json'))).toBe(false);
    expect(existsSync(join(runtime.directory, 'credentials.key'))).toBe(false);
    vi.resetModules();
    const reloaded = await import('../../src/main/storage/settings');
    reloaded.loadSettings();
    expect(reloaded.readKey()).toBe('qwen-test-key');
    expect(reloaded.publicSettings()).toMatchObject({ hasApiKey: true, credentialStorage: 'macos-keychain' });
  });

  it('does not send a custom-service key to a different endpoint', async () => {
    const storage = await import('../../src/main/storage/settings');
    const custom = settingsSchema.parse({ ...defaults, provider: 'custom', endpoint: 'https://one.example/v1' });
    storage.saveSettings(custom, 'service-one-key');
    storage.saveSettings({ ...custom, endpoint: 'https://two.example/v1' });
    expect(storage.readKey()).toBe('');
    storage.saveSettings(custom);
    expect(storage.readKey()).toBe('service-one-key');
  });

  it('restores a key encrypted by the earlier Keychain-backed version', async () => {
    const oldCiphertext = Buffer.from('protected:' + Buffer.from('previous-key').toString('base64')).toString('base64');
    writeFileSync(join(runtime.directory, 'settings.json'), JSON.stringify({ settings: defaults, encryptedKey: oldCiphertext }));
    const storage = await import('../../src/main/storage/settings');
    storage.loadSettings();
    expect(storage.readKey()).toBe('previous-key');
    expect(storage.publicSettings().hasApiKey).toBe(true);
    const saved = JSON.parse(readFileSync(join(runtime.directory, 'settings.json'), 'utf8'));
    expect(saved.encryptedKey).toBeUndefined();
    expect(saved.encryptedKeys[credentialScope(defaults)]).toBe(oldCiphertext);
  });

  it('migrates plaintext local credentials and removes the old file', async () => {
    writeFileSync(join(runtime.directory, 'settings.json'), JSON.stringify({ settings: defaults, profiles: {} }));
    writeFileSync(join(runtime.directory, 'credentials.json'), JSON.stringify({ keys: { [credentialScope(defaults)]: 'legacy-plaintext-key' } }));
    const storage = await import('../../src/main/storage/settings');
    storage.loadSettings();
    expect(storage.readKey()).toBe('legacy-plaintext-key');
    expect(readFileSync(join(runtime.directory, 'settings.json'), 'utf8')).not.toContain('legacy-plaintext-key');
    expect(existsSync(join(runtime.directory, 'credentials.json'))).toBe(false);
  });

  it('migrates AES-GCM local credentials and removes both old files', async () => {
    writeLegacyEncryptedCredentials({ [credentialScope(defaults)]: 'legacy-encrypted-key' });
    const storage = await import('../../src/main/storage/settings');
    storage.loadSettings();
    expect(storage.readKey()).toBe('legacy-encrypted-key');
    expect(existsSync(join(runtime.directory, 'credentials.json'))).toBe(false);
    expect(existsSync(join(runtime.directory, 'credentials.key'))).toBe(false);
    vi.resetModules();
    const reloaded = await import('../../src/main/storage/settings');
    reloaded.loadSettings();
    expect(reloaded.readKey()).toBe('legacy-encrypted-key');
  });

  it('keeps legacy files when Keychain encryption is unavailable or fails', async () => {
    writeLegacyEncryptedCredentials({ [credentialScope(defaults)]: 'legacy-key' });
    const storage = await import('../../src/main/storage/settings');
    runtime.available = false;
    expect(() => storage.loadSettings()).toThrow('系统凭据保护不可用');
    expect(existsSync(join(runtime.directory, 'credentials.json'))).toBe(true);
    expect(existsSync(join(runtime.directory, 'credentials.key'))).toBe(true);
    runtime.available = true;
    runtime.encryptFails = true;
    expect(() => storage.loadSettings()).toThrow('keychain failure');
    expect(existsSync(join(runtime.directory, 'credentials.json'))).toBe(true);
    expect(existsSync(join(runtime.directory, 'credentials.key'))).toBe(true);
  });

  it('rejects tampered legacy ciphertext without deleting files', async () => {
    writeLegacyEncryptedCredentials({ [credentialScope(defaults)]: 'working-key' });
    const path = join(runtime.directory, 'credentials.json');
    const encrypted = JSON.parse(readFileSync(path, 'utf8'));
    encrypted.authTag = (encrypted.authTag[0] === 'A' ? 'B' : 'A') + encrypted.authTag.slice(1);
    writeFileSync(path, JSON.stringify(encrypted));
    const storage = await import('../../src/main/storage/settings');
    expect(() => storage.loadSettings()).toThrow('本地凭据文件无法解密');
    expect(existsSync(path)).toBe(true);
  });

  it('does not generate a replacement when the legacy local key is missing', async () => {
    writeLegacyEncryptedCredentials({ [credentialScope(defaults)]: 'working-key' });
    const keyPath = join(runtime.directory, 'credentials.key');
    unlinkSync(keyPath);
    const storage = await import('../../src/main/storage/settings');
    expect(() => storage.loadSettings()).toThrow('本地凭据文件无法解密');
    expect(existsSync(keyPath)).toBe(false);
  });

  it('rejects invalid pasted API key text without replacing the saved key', async () => {
    const storage = await import('../../src/main/storage/settings');
    storage.saveSettings(defaults, 'working-key');
    const previous = readFileSync(join(runtime.directory, 'settings.json'), 'utf8');
    expect(() => storage.saveSettings(defaults, 'working-key（示例）')).toThrow('API Key 含有中文符号');
    expect(readFileSync(join(runtime.directory, 'settings.json'), 'utf8')).toBe(previous);
    expect(storage.readKey()).toBe('working-key');
  });

  it('keeps the saved key when the Keychain becomes unavailable', async () => {
    const storage = await import('../../src/main/storage/settings');
    storage.saveSettings(defaults, 'working-key');
    const previous = readFileSync(join(runtime.directory, 'settings.json'), 'utf8');
    runtime.available = false;
    expect(() => storage.readKey()).toThrow('系统凭据保护不可用');
    expect(() => storage.saveSettings(defaults, 'replacement-key')).toThrow('系统凭据保护不可用');
    expect(readFileSync(join(runtime.directory, 'settings.json'), 'utf8')).toBe(previous);
    runtime.available = true;
    expect(storage.readKey()).toBe('working-key');
  });
});
