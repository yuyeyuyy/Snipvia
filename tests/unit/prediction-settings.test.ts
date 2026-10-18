import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PredictionSettingsStore } from '../../src/main/storage/prediction-settings';
import { savePredictionSettingsSchema } from '../../src/shared/prediction-settings';
const runtime = vi.hoisted(() => ({ available: true, fail: false }));
vi.mock('electron', () => ({ safeStorage: {
  isEncryptionAvailable: () => runtime.available,
  encryptString: (key: string) => { if (runtime.fail) throw new Error('private failure');return Buffer.from('protected:' + Buffer.from(key).toString('base64')); },
  decryptString: (value: Buffer) => { if (!value.toString().startsWith('protected:')) throw new Error('private failure');return Buffer.from(value.toString().slice(10), 'base64').toString(); }
} }));
let directory: string, file: string;
const input = { enabled: true, model: 'jev-1.14.0' as const };
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'snipvia-jev-store-'));file = join(directory, 'prediction-settings.json');runtime.available = true;runtime.fail = false; });
afterEach(() => rmSync(directory, { recursive: true, force: true }));
describe('independent Jev settings', () => {
  it('defaults missing legacy config to the existing LLM path without writing a file', () => {
    const store = new PredictionSettingsStore(file);store.load();expect(store.public()).toEqual({ enabled: false, model: 'jev-1.14.0', hasApiKey: false, error: null });expect(store.snapshot()).toBeNull();
  });
  it('encrypts independently, survives restart and never returns a stored key to the renderer', () => {
    const store = new PredictionSettingsStore(file);const publicValue = store.save({ ...input, apiKey: 'synthetic-jev-secret' });
    expect(JSON.stringify(publicValue)).not.toContain('synthetic-jev-secret');expect(readFileSync(file, 'utf8')).not.toContain('synthetic-jev-secret');if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600);
    const restored = new PredictionSettingsStore(file);restored.load();expect(restored.snapshot()).toEqual({ model: input.model, key: 'synthetic-jev-secret' });
    restored.save({ ...input, model: 'jev-1.13.0' });expect(restored.snapshot()).toEqual({ model: 'jev-1.13.0', key: 'synthetic-jev-secret' });
  });
  it('disabling, missing key and explicit deletion select LLM without deleting chat data', () => {
    const store = new PredictionSettingsStore(file);store.save(input);expect(store.snapshot()).toBeNull();
    store.save({ ...input, apiKey: 'synthetic-key' });store.save({ ...input, enabled: false });expect(store.public().hasApiKey).toBe(true);expect(store.snapshot()).toBeNull();
    store.save({ ...input, apiKey: '' });expect(store.public().hasApiKey).toBe(false);expect(store.snapshot()).toBeNull();
  });
  it('keeps the prior file and in-memory settings if encryption fails', () => {
    const store = new PredictionSettingsStore(file);store.save({ ...input, apiKey: 'first-key' });const before = readFileSync(file, 'utf8');runtime.fail = true;
    expect(() => store.save({ ...input, apiKey: 'second-key' })).toThrow('加密失败');expect(readFileSync(file, 'utf8')).toBe(before);expect(store.snapshot()?.key).toBe('first-key');
  });
  it('does not overwrite damaged/unknown-version configuration or silently fall back', () => {
    for (const source of ['bad-json', JSON.stringify({ version: 99, ...input })]) {
      writeFileSync(file, source);const store = new PredictionSettingsStore(file);store.load();expect(store.public().error).toContain('原文件已保留');
      expect(() => store.snapshot()).toThrow('分支预测模型');expect(() => store.save(input)).toThrow('原文件已保留');expect(readFileSync(file, 'utf8')).toBe(source);
    }
  });
  it('does not treat a broken key or unavailable encryption as an absent key', () => {
    const store = new PredictionSettingsStore(file);store.save({ ...input, apiKey: 'synthetic-key' });runtime.available = false;
    expect(() => store.snapshot()).toThrow('分支预测模型');expect(() => store.save({ ...input, apiKey: 'replacement' })).toThrow('系统凭据保护');
    runtime.available = true;writeFileSync(file, JSON.stringify({ version: 1, ...input, encryptedKey: 'broken' }));store.load();expect(() => store.snapshot()).toThrow('分支预测模型');
  });
  it.each(['with space', '换行', 'new\nline'])('rejects invalid keys without leaking input: %s', apiKey => {
    expect(() => new PredictionSettingsStore(file).save({ ...input, apiKey })).toThrow('API Key');
  });
  it('validates narrow IPC input and cannot receive endpoints or credential-query switches', () => {
    for (const extra of [{ endpoint: 'http://evil.test' }, { readKey: true }, { version: 2 }, { model: 'unexpected-model' }]) expect(savePredictionSettingsSchema.safeParse({ ...input, ...extra }).success).toBe(false);
  });
});
