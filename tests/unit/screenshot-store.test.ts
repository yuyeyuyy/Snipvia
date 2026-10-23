import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ScreenshotStore } from '../../src/main/storage/ScreenshotStore';
import { screenshotItemSchema } from '../../src/shared/screenshot';
let directory: string;
const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const metadata = { width: 1200, height: 800, mimeType: 'image/png' as const };
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'snipvia-screenshot-store-')); });
afterEach(() => rmSync(directory, { recursive: true, force: true }));
describe('independent ScreenshotStore', () => {
  it('creates temporary screenshots without any conversation, persistence or Base64 metadata', () => {
    const store = new ScreenshotStore(join(directory, 'screenshots'));
    const item = store.create(bytes, metadata);
    expect(item).toMatchObject({ status: 'temporary', width: 1200, height: 800 });
    expect(item.id).toMatch(/^[a-f0-9-]{36}$/); expect(item).not.toHaveProperty('conversationId'); expect(item).not.toHaveProperty('dataUrl');
    expect(existsSync(join(directory, 'screenshots'))).toBe(false);
    expect(store.image(item.id).bytes).toEqual(bytes);
    bytes[0] = 137; expect(store.list()).toEqual([]);
  });
  it('saves once, reloads and independently deletes an image with no history side effects', () => {
    let store = new ScreenshotStore(join(directory, 'screenshots'));
    const item = store.create(bytes, metadata);
    const saved = store.save(item.id); expect(saved.status).toBe('saved');
    const index = readFileSync(join(directory, 'screenshots/index.json'));
    expect(store.save(item.id)).toEqual(saved); expect(readFileSync(join(directory, 'screenshots/index.json'))).toEqual(index);
    store = new ScreenshotStore(join(directory, 'screenshots'));
    expect(store.list()).toEqual([saved]); expect(store.image(item.id).bytes).toEqual(bytes);
    store.delete(item.id); expect(store.list()).toEqual([]); expect(existsSync(join(directory, 'screenshots', saved.fileName!))).toBe(false);
    expect(existsSync(join(directory, 'history'))).toBe(false);
  });
  it('leaves an unreadable index intact while local temporary capture remains available', () => {
    const folder = join(directory, 'screenshots'); mkdirSync(folder);
    writeFileSync(join(folder, 'index.json'), '{broken');
    const store = new ScreenshotStore(folder); const item = store.create(bytes, metadata);
    expect(store.image(item.id).bytes).toEqual(bytes);
    expect(() => store.save(item.id)).toThrow(); expect(readFileSync(join(folder, 'index.json'), 'utf8')).toBe('{broken');
    store.release(item.id); expect(() => store.image(item.id)).toThrow();
  });
  it('rolls back newly written bytes after index failure and never overwrites an orphan', () => {
    const folder = join(directory, 'screenshots'), store = new ScreenshotStore(folder);
    const item = store.create(bytes, metadata); store.list(); mkdirSync(folder); mkdirSync(join(folder, 'index.json'));
    expect(() => store.save(item.id)).toThrow();
    expect(readdirSync(folder)).toEqual(['index.json']);
    rmSync(join(folder, 'index.json'), { recursive: true });
    writeFileSync(join(folder, item.id + '.png'), 'preserve-orphan');
    expect(() => store.save(item.id)).toThrow('已存在'); expect(readFileSync(join(folder, item.id + '.png'), 'utf8')).toBe('preserve-orphan');
  });
  it('bounds runtime items and rejects traversal, oversized and mismatched metadata', () => {
    const store = new ScreenshotStore(join(directory, 'screenshots'));
    const first = store.create(bytes, metadata);
    for (let i = 0; i < 32; i++) store.create(bytes, metadata);
    expect(() => store.image(first.id)).toThrow('不存在');
    expect(() => store.image('../settings.json')).toThrow();
    expect(() => store.create(Buffer.alloc(0), metadata)).toThrow();
    expect(screenshotItemSchema.safeParse({ ...first, conversationId: crypto.randomUUID() }).success).toBe(false);
    expect(() => store.create(bytes, { ...metadata, width: -1 })).toThrow();
    store.dispose();
  });
  it('refuses a persisted image symlink instead of reading outside the screenshot root', () => {
    const folder = join(directory, 'screenshots'), store = new ScreenshotStore(folder);
    const item = store.save(store.create(bytes, metadata).id);
    const target = join(folder, item.fileName!); rmSync(target);
    const outside = join(directory, 'unrelated'); writeFileSync(outside, 'PRIVATE');
    symlinkSync(outside, target);
    expect(() => store.image(item.id)).toThrow('无效');
  });
});
