import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { capturePreferencesSchema, capturePreferencesInputSchema, extendCapturePreferences, type CapturePreferences, type CapturePreferencesInput } from '../../shared/capture-preferences';

/** Copy legacy defaults in memory; writes target only the independent V2 preferences file. */
export class CapturePreferencesStore {
  private value: CapturePreferences;
  private available = true;
  constructor(private readonly file: string, legacy: CapturePreferencesInput) { this.value = extendCapturePreferences({ shortcut: legacy.shortcut, editorShortcut: legacy.editorShortcut }); }
  load() {
    if (!existsSync(this.file)) return;
    this.available = false;
    const raw: unknown = JSON.parse(readFileSync(this.file, 'utf8'));
    // Validate the whole file before adding fields, preserving unknown/damaged data.
    this.value = extendCapturePreferences(capturePreferencesInputSchema.parse(raw));
    this.available = true;
  }
  current() { return { ...this.value }; }
  save(input: unknown) {
    if (!this.available) throw new Error('V2 快捷键配置损坏，原文件已保留，请先备份检查');
    const value = capturePreferencesSchema.parse({ ...this.value, ...capturePreferencesInputSchema.parse(input) });
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
    const tmp = this.file + '.' + randomUUID() + '.tmp';
    try { writeFileSync(tmp, JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 }); renameSync(tmp, this.file); }
    finally { if (existsSync(tmp)) unlinkSync(tmp); }
    this.value = value;
    return this.current();
  }
}
