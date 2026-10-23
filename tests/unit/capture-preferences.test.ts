import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CapturePreferencesStore } from '../../src/main/storage/CapturePreferencesStore';
let directory: string;
const legacy = { shortcut: 'Control+1', editorShortcut: 'Control+3' };
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'snipvia-v2-preferences-')); });
afterEach(() => rmSync(directory, { recursive: true, force: true }));
describe('V2 capture preferences', () => {
  it('inherits legacy shortcuts without writing or retaining other fields, then persists independently', () => {
    const file = join(directory, 'capture-preferences.json'), store = new CapturePreferencesStore(file, { ...legacy, apiKey: 'not retained' } as typeof legacy);
    store.load(); expect(store.current()).toEqual(legacy);
    writeFileSync(join(directory, 'settings.json'), 'preserve-old-settings');
    store.save({ shortcut: 'Control+Shift+Enter', editorShortcut: 'Control+3' });
    const reload = new CapturePreferencesStore(file, legacy); reload.load();
    expect(reload.current().shortcut).toBe('Control+Shift+Enter');
    expect(readFileSync(join(directory, 'settings.json'), 'utf8')).toBe('preserve-old-settings');
    expect(readFileSync(file, 'utf8')).not.toContain('apiKey');
  });
  it('preserves a damaged V2 file and retains valid legacy defaults without overwriting it', () => {
    const file = join(directory, 'capture-preferences.json'); writeFileSync(file, '{broken');
    const store = new CapturePreferencesStore(file, legacy);
    expect(() => store.load()).toThrow(); expect(store.current()).toEqual(legacy);
    expect(() => store.save(legacy)).toThrow('原文件已保留');
    expect(readFileSync(file, 'utf8')).toBe('{broken');
  });
  it('keeps memory and disk unchanged on invalid input or persistence failure', () => {
    const file = join(directory, 'capture-preferences.json'), store = new CapturePreferencesStore(file, legacy);
    expect(() => store.save({ shortcut: 'Control+1', editorShortcut: 'Control+1' })).toThrow();
    expect(() => store.save({ ...legacy, reservedMode: 'collect' })).toThrow();
    mkdirSync(file);
    expect(() => store.save({ shortcut: 'Control+8', editorShortcut: 'Control+9' })).toThrow();
    expect(store.current()).toEqual(legacy);
  });
});
