import { app } from 'electron';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { themeModeSchema, type ThemeMode } from '../../shared/appearance';
import { acceleratorIdentity, capturePreferencesInputSchema, type CapturePreferencesInput } from '../../shared/capture-preferences';

let mode: ThemeMode = 'system';
let shortcuts: CapturePreferencesInput | undefined;
let readable = true;
const file = () => join(app.getPath('userData'), 'settings.json');

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readSettings(): Record<string, unknown> {
  if (!existsSync(file())) return {};
  const value: unknown = JSON.parse(readFileSync(file(), 'utf8'));
  if (!record(value)) throw new Error('旧设置文件无效，原文件已保留');
  return value;
}

/** Read only theme and screenshot bindings; model profiles and credential files stay opaque. */
export function loadSettings() {
  mode = 'system'; shortcuts = undefined; readable = false;
  const value = readSettings();
  if (record(value.appearance)) {
    const parsed = themeModeSchema.safeParse(value.appearance.mode);
    if (parsed.success) mode = parsed.data;
  }
  if (record(value.settings)) {
    const parsed = capturePreferencesInputSchema.safeParse({
      shortcut: value.settings.shortcut ?? 'CommandOrControl+Shift+Space',
      editorShortcut: value.settings.editorShortcut ?? 'CommandOrControl+Shift+A'
    });
    if (parsed.success && acceleratorIdentity(parsed.data.shortcut, process.platform) !== acceleratorIdentity(parsed.data.editorShortcut, process.platform)) {
      shortcuts = parsed.data;
    }
  }
  readable = true;
}

export function legacyCaptureShortcuts() { return shortcuts ? { ...shortcuts } : undefined; }
export function appearanceMode(): ThemeMode { return mode; }

export function saveAppearanceMode(value: ThemeMode) {
  const next = themeModeSchema.parse(value);
  if (!readable) throw new Error('旧设置文件无法读取，原文件已保留；请先备份检查');
  // Re-read before every write so fields added outside this process are preserved too.
  const original = readSettings();
  if (original.appearance !== undefined && !record(original.appearance)) throw new Error('旧外观字段无法合并，原文件已保留');
  const payload = { ...original, appearance: { ...(record(original.appearance) ? original.appearance : {}), mode: next } };
  mkdirSync(app.getPath('userData'), { recursive: true, mode: 0o700 });
  const temporary = file() + '.' + randomUUID() + '.tmp';
  try {
    writeFileSync(temporary, JSON.stringify(payload, null, 2), { flag: 'wx', mode: 0o600 });
    renameSync(temporary, file());
  } finally { if (existsSync(temporary)) unlinkSync(temporary); }
  mode = next;
}
