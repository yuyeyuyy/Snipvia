import { afterEach, beforeEach, expect, it } from 'vitest';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { ScreenshotStore } from '../../src/main/storage/ScreenshotStore';
import { ScreenshotDragFiles } from '../../src/main/storage/ScreenshotDragFiles';
let directory: string;
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'snipvia-drag-unit-')); });
afterEach(() => rmSync(directory, { recursive: true, force: true }));
function fixture() {
  const store = new ScreenshotStore(join(directory, 'sources'));
  const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const item = store.create(bytes, { width: 1200, height: 800, mimeType: 'image/png' });
  return { store, bytes, item };
}
it('creates no files until a drag and reuses a private, unchanged original', () => {
  const { store, bytes, item } = fixture(), files = new ScreenshotDragFiles(directory);
  expect(readdirSync(directory)).toEqual([]);
  const path = files.prepare(item.id, store);
  expect(readFileSync(path)).toEqual(bytes); expect(path.endsWith('.png')).toBe(true);
  expect(files.prepare(item.id, store)).toBe(path);
  if (process.platform !== 'win32') { expect(lstatSync(path).mode & 0o777).toBe(0o600); expect(lstatSync(dirname(path)).mode & 0o777).toBe(0o700); }
  store.release(item.id); expect(readFileSync(path)).toEqual(bytes);
  files.dispose(); expect(existsSync(path)).toBe(false); expect(readdirSync(directory)).toEqual([]);
});
it('rejects untrusted identifiers, unavailable images and a symlink cache', () => {
  const { store, item } = fixture(), files = new ScreenshotDragFiles(directory);
  expect(() => files.prepare('../outside', store)).toThrow();
  expect(() => files.prepare(randomUUID(), store)).toThrow();
  const path = files.prepare(item.id, store), outside = join(directory, 'outside');
  writeFileSync(outside, 'preserve'); rmSync(path); symlinkSync(outside, path);
  expect(() => files.prepare(item.id, store)).toThrow('无效');
  files.dispose(); expect(readFileSync(outside, 'utf8')).toBe('preserve');
});
it('preserves files in use and sources at capacity, and only expires old private files', () => {
  const { store, bytes, item } = fixture(); let now = 0;
  const files = new ScreenshotDragFiles(directory, () => now, { bytes: 16, items: 1, retentionMs: 1000 });
  const first = files.prepare(item.id, store), second = store.create(bytes, { width: 200, height: 100, mimeType: 'image/png' });
  now = 999; expect(() => files.prepare(second.id, store)).toThrow('空间已满');
  expect(readFileSync(first)).toEqual(bytes); expect(store.image(second.id).bytes).toEqual(bytes);
  now = 1000; const next = files.prepare(second.id, store);
  expect(existsSync(first)).toBe(false); expect(readFileSync(next)).toEqual(bytes);
  files.dispose();
});
it('leaves screenshots intact after a failed temporary write', () => {
  const { store, bytes, item } = fixture(), invalid = join(directory, 'not-a-directory'); writeFileSync(invalid, 'keep');
  const files = new ScreenshotDragFiles(invalid);
  expect(() => files.prepare(item.id, store)).toThrow();
  expect(readFileSync(invalid, 'utf8')).toBe('keep'); expect(store.image(item.id).bytes).toEqual(bytes);
});
it('retains the original JPEG bytes and deletes only its own directory', () => {
  const store = new ScreenshotStore(join(directory, 'sources')), bytes = Buffer.from([255, 216, 255, 217]);
  const item = store.create(bytes, { width: 10, height: 20, mimeType: 'image/jpeg' }), files = new ScreenshotDragFiles(directory);
  const unrelated = join(directory, 'another-app'); mkdirSync(unrelated); writeFileSync(join(unrelated, 'keep'), 'keep');
  const path = files.prepare(item.id, store); expect(path.endsWith('.jpg')).toBe(true); expect(readFileSync(path)).toEqual(bytes);
  files.dispose(); expect(readFileSync(join(unrelated, 'keep'), 'utf8')).toBe('keep');
});
