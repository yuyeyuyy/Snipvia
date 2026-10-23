import { predictionBranchListSchema, type PredictionBranch } from '../../shared/screenshot-understanding';
import { app, safeStorage } from 'electron';
import { createDecipheriv, createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defaults, settingsSchema, type ModelProfile, type PublicSettings, type Settings } from '../../shared/contracts';
import { assertApiKeyFormat } from '../../shared/api-key';
import { credentialScope, inferProvider } from '../../shared/providers';
import { z } from 'zod';
import { chatFontSizeSchema, defaultChatFontSize, themeModeSchema, type ThemeMode } from '../../shared/appearance';

const fileHash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

type Stored = { settings: Settings; encryptedKeys: Record<string, string>; profiles: Record<string, Settings>; appearance: { mode: ThemeMode; chatFontSize: number } };
let stored: Stored = { settings: defaults, encryptedKeys: {}, profiles: {}, appearance: { mode: 'system', chatFontSize: defaultChatFontSize } };
let legacySettingsReadOnly = false;
let preserveLegacyPayload = false;
const file = () => join(app.getPath('userData'), 'settings.json');
const credentialsFile = () => join(app.getPath('userData'), 'credentials.json');
const credentialsKeyFile = () => join(app.getPath('userData'), 'credentials.key');
const credentialPayloadSchema = z.object({ keys: z.record(z.string(), z.string()) });
const encryptedCredentialsSchema = z.object({
  version: z.literal(1),
  algorithm: z.literal('aes-256-gcm'),
  iv: z.string().min(1).max(100),
  authTag: z.string().min(1).max(100),
  ciphertext: z.string().min(1).max(1_000_000)
}).strict();
const credentialsAdditionalData = Buffer.from('snipvia.credentials.v1', 'utf8');

function readCredentialsKey() {
  if (!existsSync(credentialsKeyFile())) throw new Error('本地凭据密钥文件不存在');
  const key = readFileSync(credentialsKeyFile());
  if (key.byteLength !== 32) throw new Error('本地凭据密钥文件无效');
  return key;
}

function decryptCredentials(value: z.infer<typeof encryptedCredentialsSchema>) {
  try {
    const iv = Buffer.from(value.iv, 'base64');
    const authTag = Buffer.from(value.authTag, 'base64');
    if (iv.byteLength !== 12 || authTag.byteLength !== 16) throw new Error('invalid encrypted payload');
    const decipher = createDecipheriv('aes-256-gcm', readCredentialsKey(), iv, { authTagLength: 16 });
    decipher.setAAD(credentialsAdditionalData);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(value.ciphertext, 'base64')),
      decipher.final()
    ]);
    return credentialPayloadSchema.parse(JSON.parse(plaintext.toString('utf8'))).keys;
  } catch {
    throw new Error('本地凭据文件无法解密，可能已损坏或密钥文件不匹配');
  }
}

function readCredentials() {
  if (!existsSync(credentialsFile())) return {};
  const value: unknown = JSON.parse(readFileSync(credentialsFile(), 'utf8'));
  const encrypted = encryptedCredentialsSchema.safeParse(value);
  if (encrypted.success) return decryptCredentials(encrypted.data);
  const plaintext = credentialPayloadSchema.safeParse(value);
  if (!plaintext.success) throw new Error('本地凭据文件格式无效');
  return plaintext.data.keys;
}

function persistSettings(value: Stored) {
  if (legacySettingsReadOnly) throw new Error('旧设置文件无法读取，原文件已保留；请先备份检查');
  mkdirSync(app.getPath('userData'), { recursive: true, mode: 0o700 });
  let payload: unknown = value;
  if (preserveLegacyPayload && existsSync(file())) {
    const original: unknown = JSON.parse(readFileSync(file(), 'utf8'));
    if (!original || typeof original !== 'object' || Array.isArray(original)) throw new Error('旧设置文件无效，原文件已保留');
    const legacy = original as Record<string, unknown>;
    payload = { ...legacy, appearance: { ...(typeof legacy.appearance === 'object' && legacy.appearance !== null ? legacy.appearance : {}), ...value.appearance } };
  }
  const temporary = file() + '.tmp';
  writeFileSync(temporary, JSON.stringify(payload, null, 2), { mode: 0o600 });
  renameSync(temporary, file());
  chmodSync(file(), 0o600);
}

function migrateEditorShortcut(value: Record<string, unknown>) {
  const previousDefault = 'CommandOrControl+Alt+A';
  if (value.editorShortcut !== undefined && value.editorShortcut !== previousDefault) return value;
  if (value.editorShortcut === previousDefault && [value.shortcut, value.continueShortcut].includes(defaults.editorShortcut)) return value;
  // A previously customized AI shortcut must not prevent older settings from loading.
  const candidates = [defaults.editorShortcut, 'CommandOrControl+Alt+S', 'CommandOrControl+Alt+X'];
  return { ...value, editorShortcut: candidates.find((key) => key !== value.shortcut && key !== value.continueShortcut)! };
}

function predictionBranchesChanged(value: unknown, settings: Settings) {
  if (typeof value !== 'object' || value === null) return false;
  const branches = (value as Record<string, unknown>).predictionBranches;
  return Array.isArray(branches) && branches.length !== settings.predictionBranches.length;
}

export function loadSettings(options: { migrateCredentials?: boolean } = {}) {
  legacySettingsReadOnly = false;
  preserveLegacyPayload = options.migrateCredentials === false;
  try { loadStoredSettings(options); }
  catch (error) { legacySettingsReadOnly = true; throw error; }
}

function loadStoredSettings(options: { migrateCredentials?: boolean }) {
  const value = existsSync(file()) ? z.object({
    settings: z.object({ endpoint: z.string(), provider: z.string().optional() }).passthrough(),
    encryptedKey: z.string().optional(),
    encryptedKeys: z.record(z.string(), z.string()).default({}),
    profiles: z.record(z.string(), z.unknown()).default({}),
    appearance: z.object({ mode: themeModeSchema, chatFontSize: chatFontSizeSchema.catch(defaultChatFontSize).default(defaultChatFontSize) }).catch({ mode: 'system', chatFontSize: defaultChatFontSize }).default({ mode: 'system', chatFontSize: defaultChatFontSize })
  }).parse(JSON.parse(readFileSync(file(), 'utf8'))) : undefined;
  const prepare = (input: Record<string, unknown>) => options.migrateCredentials === false && input.editorShortcut !== undefined ? input : migrateEditorShortcut(input);
  const settings = value
    ? settingsSchema.parse(prepare({ ...value.settings, provider: value.settings.provider ?? inferProvider(value.settings.endpoint) }))
    : defaults;
  const encryptedKeys = { ...value?.encryptedKeys };
  let predictionsChanged = predictionBranchesChanged(value?.settings, settings);
  if (value?.encryptedKey && !encryptedKeys[credentialScope(settings)]) encryptedKeys[credentialScope(settings)] = value.encryptedKey;
  const profiles: Record<string, Settings> = {};
  for (const [scope, profile] of Object.entries(value?.profiles ?? {})) {
    const parsed = settingsSchema.safeParse(typeof profile === 'object' && profile !== null
      ? prepare(profile as Record<string, unknown>) : profile);
    if (parsed.success) {
      profiles[scope] = parsed.data;
      predictionsChanged ||= predictionBranchesChanged(profile, parsed.data);
    }
  }
  profiles[credentialScope(settings)] = settings;
  const legacyCredentialsPresent = options.migrateCredentials !== false && existsSync(credentialsFile());
  const legacyKeys = options.migrateCredentials === false ? {} : readCredentials();
  if (Object.keys(legacyKeys).length > 0 && !safeStorage.isEncryptionAvailable()) {
    throw new Error('系统凭据保护不可用，无法迁移已有 API Key；原凭据文件已保留');
  }
  for (const [scope, key] of Object.entries(legacyKeys)) {
    assertApiKeyFormat(key);
    encryptedKeys[scope] = safeStorage.encryptString(key).toString('base64');
  }
  const next = { settings, encryptedKeys, profiles, appearance: value?.appearance ?? { mode: 'system' as const, chatFontSize: defaultChatFontSize } };
  if (options.migrateCredentials !== false && (predictionsChanged || legacyCredentialsPresent || value?.encryptedKey)) persistSettings(next);
  stored = next;
  if (legacyCredentialsPresent) {
    unlinkSync(credentialsFile());
    if (existsSync(credentialsKeyFile())) unlinkSync(credentialsKeyFile());
  }
}

export function publicSettings(): PublicSettings {
  const profiles = { ...stored.profiles, [credentialScope(stored.settings)]: stored.settings };
  const configuredModels: ModelProfile[] = Object.values(profiles).map(({ provider, endpoint, model }) => ({ provider, endpoint, model }));
  return { ...stored.settings, hasApiKey: !!stored.encryptedKeys[credentialScope(stored.settings)],
    configuredServices: Object.keys(stored.encryptedKeys).filter((scope) => !!stored.encryptedKeys[scope]),
    configuredModels,
    credentialStorage: process.platform === 'darwin' ? 'macos-keychain'
      : process.platform === 'win32' ? 'windows-dpapi' : 'system-secret-store' };
}

export function readKey(scope: Pick<Settings, 'provider' | 'endpoint'> = stored.settings) {
  const encryptedKey = stored.encryptedKeys[credentialScope(scope)];
  if (!encryptedKey) return '';
  if (!safeStorage.isEncryptionAvailable()) throw new Error('系统凭据保护不可用，无法读取 API Key');
  let key: string;
  try { key = safeStorage.decryptString(Buffer.from(encryptedKey, 'base64')); }
  catch { throw new Error('已保存的 API Key 无法解密，请检查系统凭据保护或重新输入当前厂商的 API Key'); }
  assertApiKeyFormat(key);
  return key;
}

export function saveSettings(settings: Settings, apiKey?: string) {
  settings = settingsSchema.parse(settings);
  const encryptedKeys = { ...stored.encryptedKeys };
  const scope = credentialScope(settings);
  if (apiKey !== undefined) {
    assertApiKeyFormat(apiKey);
    if (apiKey && !safeStorage.isEncryptionAvailable()) throw new Error('系统凭据保护不可用，无法保存 API Key');
    if (apiKey) encryptedKeys[scope] = safeStorage.encryptString(apiKey).toString('base64');
    else delete encryptedKeys[scope];
  }
  const profiles = { ...stored.profiles, [scope]: settings };
  const next = { settings, encryptedKeys, profiles, appearance: stored.appearance };
  persistSettings(next);
  stored = next;
  return publicSettings();
}

export function appearanceMode(): ThemeMode { return stored.appearance.mode; }
export function chatFontSize(): number { return stored.appearance.chatFontSize; }

export function saveChatFontSize(value: number) {
  const next = { ...stored, appearance: { ...stored.appearance, chatFontSize: chatFontSizeSchema.parse(value) } };
  persistSettings(next);
  stored = next;
}

export function saveAppearanceMode(mode: ThemeMode) {
  const next = { ...stored, appearance: { ...stored.appearance, mode: themeModeSchema.parse(mode) } };
  persistSettings(next);
  stored = next;
}

/** Merge only rule data against the current settings; never restore stale credentials or controls. */
export function savePredictionBranches(expected: string, branches: PredictionBranch[]) {
  if (fileHash(Buffer.from(JSON.stringify(stored.settings.predictionBranches))) !== expected) throw new Error('预测分支已变化，请重新生成');
  const valid = predictionBranchListSchema.parse(branches);
  return saveSettings({ ...stored.settings, predictionBranches: valid });
}
