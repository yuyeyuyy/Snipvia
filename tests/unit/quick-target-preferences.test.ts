import { expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { QuickTargetPreferencesStore } from '../../src/main/storage/QuickTargetPreferencesStore';
import { quickTargetActivateSchema, quickTargetBounds, quickTargetPreferencesSchema, quickTargetWebsiteSchema } from '../../src/shared/quick-target';

function fixture(run: (store: QuickTargetPreferencesStore, file: string) => void) {
  const directory = mkdtempSync(join(tmpdir(), 'snipvia-target-'));
  try { run(new QuickTargetPreferencesStore(join(directory, 'quick-target.json')), join(directory, 'quick-target.json')); }
  finally { rmSync(directory, { recursive: true, force: true }); }
}
it('starts disabled, persists independently and round-trips ordered targets and aliases', () => fixture((store, file) => {
  store.load(); expect(store.current().enabled).toBe(false);
  const a = { id: randomUUID(), kind: 'website' as const, label: 'Chat', url: 'https://example.test/' }, b = { id: randomUUID(), kind: 'application' as const, label: 'App', path: '/Applications/Example.app', bundleId: 'test.example' };
  store.add(a); store.add(b); store.rename(a.id, '模型');
  store.configure({ enabled: true, launchApplications: false, durationMs: 6000, order: [b.id, a.id] });
  const restored = new QuickTargetPreferencesStore(file); restored.load();
  expect(restored.current()).toEqual(store.current());
  expect(restored.current().targets.map(target => target.label)).toEqual(['App', '模型']);
  const copy = store.current(); copy.targets.length = 0; expect(store.current().targets).toHaveLength(2);
  store.remove(a.id); expect(store.current().targets).toEqual([b]);
}));
it('preserves malformed/future configuration and refuses to overwrite it', () => fixture((store, file) => {
  const bytes = '{"schemaVersion":99,"private":"preserve"}'; writeFileSync(file, bytes);
  expect(() => store.load()).toThrow(); expect(store.available()).toBe(false); expect(store.current().enabled).toBe(false);
  expect(() => store.add({ id: randomUUID(), kind: 'website', label: 'Example', url: 'https://example.test/' })).toThrow('原文件已保留');
  expect(readFileSync(file, 'utf8')).toBe(bytes);
}));
it('rejects duplicated targets, forged order, excessive targets and out-of-range options without changing bytes', () => fixture((store, file) => {
  const a = { id: randomUUID(), kind: 'website' as const, label: 'Example', url: 'https://example.test/' }; store.add(a);
  const bytes = readFileSync(file, 'utf8');
  expect(() => store.add({ ...a, id: randomUUID() })).toThrow('已添加');
  for (const order of [[], [a.id, a.id], [randomUUID()]]) expect(() => store.configure({ enabled: true, launchApplications: false, durationMs: 4000, order })).toThrow();
  expect(() => store.configure({ enabled: true, launchApplications: false, durationMs: 0, order: [a.id] })).toThrow();
  expect(readFileSync(file, 'utf8')).toBe(bytes);
  expect(quickTargetPreferencesSchema.safeParse({ ...store.current(), targets: Array.from({ length: 9 }, (_, index) => ({ ...a, id: randomUUID(), url: 'https://example.test/' + index })) }).success).toBe(false);
}));
it('accepts only bounded safe websites and strict presentation requests', () => {
  for (const url of ['javascript:alert(1)', 'file:///private/data', 'https://user:secret@example.test/', 'https://', 'ftp://example.test/']) expect(quickTargetWebsiteSchema.safeParse({ label: 'Test', url }).success).toBe(false);
  expect(quickTargetWebsiteSchema.parse({ label: ' Example ', url: 'https://example.test' })).toEqual({ label: 'Example', url: 'https://example.test/' });
  for (const request of [{ presentationId: Infinity, targetId: randomUUID() }, { presentationId: 2, targetId: randomUUID(), path: '/Applications/App.app' }, { presentationId: 0, targetId: randomUUID() }]) expect(quickTargetActivateSchema.safeParse(request).success).toBe(false);
});
it('keeps placement inside negative-coordinate, narrow and small work areas', () => {
  for (const area of [{ x: -1600, y: -900, width: 1440, height: 900 }, { x: 0, y: 25, width: 320, height: 220 }, { x: -20, y: 0, width: 80, height: 70 }]) {
    const bounds = quickTargetBounds(area, 8);
    expect(bounds.x).toBeGreaterThanOrEqual(area.x); expect(bounds.y).toBeGreaterThanOrEqual(area.y);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(area.x + area.width); expect(bounds.y + bounds.height).toBeLessThanOrEqual(area.y + area.height);
  }
});

it('loads legacy websites without rewriting bytes and persists opt-in browser settings separately', () => fixture((store, file) => {
  const id = randomUUID(), original = JSON.stringify({ schemaVersion: 1, enabled: true, durationMs: 4000, launchApplications: false, targets: [{ id, kind: 'website', label: 'Chat', url: 'https://chatgpt.com/' }] });
  writeFileSync(file, original); store.load(); expect(readFileSync(file, 'utf8')).toBe(original);
  expect(store.current().targets[0]).not.toHaveProperty('mode');
  store.configureBrowser({ id, mode: 'existing-tab', match: 'origin', focusInput: true });
  const restored = new QuickTargetPreferencesStore(file); restored.load();
  expect(restored.current().targets[0]).toMatchObject({ mode: 'existing-tab', match: 'origin', focusInput: true });
  expect(() => store.configureBrowser({ id: randomUUID(), mode: 'open', match: 'exact', focusInput: false })).toThrow('移除');
  expect(() => store.configureBrowser({ id, mode: 'existing-tab', match: 'origin', focusInput: true, url: 'https://evil.test' })).toThrow();
}));
