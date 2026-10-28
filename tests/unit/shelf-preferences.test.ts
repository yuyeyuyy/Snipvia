import { expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ShelfPreferencesStore } from '../../src/main/storage/ShelfPreferencesStore';
import { shelfResizeSchema } from '../../src/shared/shelf-preferences';
it('persists size independently, validates untrusted inputs and restores it after restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'snipvia-shelf-size-')), path = join(directory, 'shelf-preferences.json');
  try {
    const store = new ShelfPreferencesStore(path); store.load();
    expect(store.current()).toEqual({ width: 420, height: 660 });
    expect(store.configuration().heightMode).toBe('screen');
    store.save({ width: 560, height: 840 });
    const bytes = readFileSync(path, 'utf8');
    const restored = new ShelfPreferencesStore(path); restored.load();
    expect(restored.current()).toEqual({ width: 560, height: 840 });
    for (const value of [{ width: 1, height: 840 }, { width: Infinity, height: 400 }, { width: 500, height: 400, path: '/private' }]) expect(() => restored.save(value)).toThrow();
    expect(readFileSync(path, 'utf8')).toBe(bytes);
    expect(shelfResizeSchema.parse({ width: 500, height: 600 }).commit).toBe(true);
    expect(shelfResizeSchema.safeParse({ width: 500, height: 600, commit: false, x: -1000 }).success).toBe(false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
it('preserves a corrupt or unknown config and refuses to overwrite it', () => {
  const directory = mkdtempSync(join(tmpdir(), 'snipvia-shelf-bad-size-')), path = join(directory, 'shelf-preferences.json');
  try {
    const bytes = '{"unknown":"preserve","width":500}'; writeFileSync(path, bytes);
    const store = new ShelfPreferencesStore(path);
    expect(() => store.load()).toThrow();
    expect(() => store.save({ width: 500, height: 700 })).toThrow('原文件已保留');
    expect(readFileSync(path, 'utf8')).toBe(bytes);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

it('loads legacy dimensions without rewriting and persists new options through explicit configuration', () => {
  const directory = mkdtempSync(join(tmpdir(), 'snipvia-shelf-config-')), path = join(directory, 'shelf-preferences.json');
  try {
    const legacy = '{"width":360,"height":640}'; writeFileSync(path, legacy);
    const store = new ShelfPreferencesStore(path); store.load();
    expect(readFileSync(path, 'utf8')).toBe(legacy);
    expect(store.current()).toEqual({ width: 360, height: 640 });
    expect(store.configuration().autoHide).toBe(true);
    expect(store.configuration().heightMode).toBe('screen');
    expect(() => store.configure({ ...store.configuration(), hideDelayMs: 1 })).toThrow();
    expect(() => store.configure({ ...store.configuration(), path: '/private' })).toThrow();
    expect(readFileSync(path, 'utf8')).toBe(legacy);
    expect(() => store.configure({ ...store.configuration(), heightMode: 'invalid' })).toThrow();
    const config = store.configure({ ...store.configuration(), heightMode: 'screen', autoHide: false, gap: 24 });
    const restored = new ShelfPreferencesStore(path); restored.load(); expect(restored.configuration()).toEqual(config);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

it('preserves height and options from the earlier full configuration without rewriting', () => {
  const directory = mkdtempSync(join(tmpdir(), 'snipvia-shelf-prior-')), path = join(directory, 'shelf-preferences.json');
  try {
    const bytes = JSON.stringify({ width: 500, height: 740, autoHide: false, hideDelayMs: 2400, mergeWidth: 2048, gap: 24 });
    writeFileSync(path, bytes); const store = new ShelfPreferencesStore(path); store.load();
    expect(store.configuration()).toEqual({ ...JSON.parse(bytes), heightMode: 'screen' });
    expect(readFileSync(path, 'utf8')).toBe(bytes);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

it('keeps an explicitly chosen fixed height after restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'snipvia-shelf-fixed-')), path = join(directory, 'shelf-preferences.json');
  try {
    const store = new ShelfPreferencesStore(path); store.load();
    store.configure({ ...store.configuration(), heightMode: 'fixed', height: 500 });
    const restored = new ShelfPreferencesStore(path); restored.load();
    expect(restored.configuration().heightMode).toBe('fixed'); expect(restored.configuration().height).toBe(500);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
