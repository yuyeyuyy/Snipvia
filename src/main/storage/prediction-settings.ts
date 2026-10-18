import { safeStorage } from 'electron';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import { assertApiKeyFormat } from '../../shared/api-key';
import { defaultPredictionSettings, predictionSettingsSchema, savePredictionSettingsSchema, type PublicPredictionSettings, type SavePredictionSettings } from '../../shared/prediction-settings';
import { PredictionError } from '../analysis/PredictionError';

const storedSchema = predictionSettingsSchema.extend({ version: z.literal(1), encryptedKey: z.string().min(1).max(32768).optional() }).strict();
type Stored = z.infer<typeof storedSchema>;

/** Separate from chat profiles. Never returns a stored key or rewrites damaged files. */
export class PredictionSettingsStore {
  private stored: Stored = { version: 1, ...defaultPredictionSettings };
  private error: string | null = null;
  constructor(private readonly file: string) {}
  load() {
    try {
      this.stored = existsSync(this.file) ? storedSchema.parse(JSON.parse(readFileSync(this.file, 'utf8'))) : { version: 1, ...defaultPredictionSettings };
      this.error = null;
    } catch { this.error = 'Jev 配置读取失败，原文件已保留；请恢复备份后重新启动。'; }
  }
  public(): PublicPredictionSettings {
    return { enabled: this.stored.enabled, model: this.stored.model, hasApiKey: !!this.stored.encryptedKey, error: this.error };
  }
  private encryptionAvailable() {
    return safeStorage.isEncryptionAvailable() && !(process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text');
  }
  snapshot(): { model: Stored['model']; key: string } | null {
    if (this.error) throw new PredictionError({ stage: 'branch', reason: 'configuration' });
    if (!this.stored.enabled || !this.stored.encryptedKey) return null;
    try {
      if (!this.encryptionAvailable()) throw new Error('unavailable');
      const key = safeStorage.decryptString(Buffer.from(this.stored.encryptedKey, 'base64'));
      assertApiKeyFormat(key);
      if (!key) throw new Error('empty');
      return { model: this.stored.model, key };
    } catch { throw new PredictionError({ stage: 'branch', reason: 'configuration' }); }
  }
  save(input: SavePredictionSettings): PublicPredictionSettings {
    if (this.error) throw new Error(this.error);
    const parsed = savePredictionSettingsSchema.safeParse(input);
    if (!parsed.success) throw new Error('Jev 配置无效，请检查模型和 API Key');
    const { apiKey, ...settings } = parsed.data;
    const next: Stored = { version: 1, ...settings, ...(this.stored.encryptedKey ? { encryptedKey: this.stored.encryptedKey } : {}) };
    if (apiKey !== undefined) {
      assertApiKeyFormat(apiKey);
      if (apiKey) {
        if (!this.encryptionAvailable()) throw new Error('系统凭据保护不可用，未保存 Jev Key');
        try { next.encryptedKey = safeStorage.encryptString(apiKey).toString('base64'); }
        catch { throw new Error('Jev Key 加密失败，原配置未修改'); }
      } else delete next.encryptedKey;
    }
    try {
      mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
      writeFileSync(this.file + '.tmp', JSON.stringify(next, null, 2), { mode: 0o600 });
      chmodSync(this.file + '.tmp', 0o600);
      renameSync(this.file + '.tmp', this.file);
    } catch { throw new Error('Jev 配置保存失败，未应用本次修改'); }
    this.stored = next;
    return this.public();
  }
}
