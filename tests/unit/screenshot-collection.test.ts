import { describe, expect, it } from 'vitest';
import { ScreenshotCollection } from '../../src/main/storage/ScreenshotCollection';
import { ScreenshotStore } from '../../src/main/storage/ScreenshotStore';
import { CaptureModeRouter } from '../../src/main/capture/CaptureModeRouter';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('ScreenshotCollection ownership and ordering', () => {
  it('keeps ten stable IDs, rejects stale sorting and requires fresh clear confirmation', () => {
    const store = new ScreenshotStore('/unused'), collection = new ScreenshotCollection(store);
    const ids = Array.from({ length: 10 }, (_, i) => store.create(Buffer.from([i + 1]), { width: i + 1, height: 10, mimeType: 'image/png' }).id);
    ids.forEach(id => collection.append(id));
    const first = collection.snapshot(); first.items.reverse();
    expect(collection.getItems().map(i => i.id)).toEqual(ids);
    collection.reorder([...ids].reverse(), collection.snapshot().revision);
    expect(() => collection.reorder(ids, 0)).toThrow('已变化');
    expect(() => collection.reorder([ids[0]], collection.snapshot().revision)).toThrow('无效');
    expect(() => collection.clear(false, collection.snapshot().revision)).toThrow('确认');
    expect(() => collection.clear(true, 0)).toThrow('已变化');
    collection.remove(ids[0]); expect(collection.getCount()).toBe(9);
    expect(collection.getItem(ids[1]).width).toBe(2);
    expect(() => collection.getItem(ids[0])).toThrow();
    collection.clear(true, collection.snapshot().revision);
    expect(collection.getCount()).toBe(0); expect(store.runtimeUsage()).toEqual({ items: 0, bytes: 0 });
  });
  it('never evicts a retained image at item or memory limits and frees shared bytes only after all owners release', () => {
    const store = new ScreenshotStore('/unused'), collection = new ScreenshotCollection(store);
    const ids = Array.from({ length: 32 }, () => store.create(Buffer.from([1]), { width: 1, height: 1, mimeType: 'image/png' }).id);
    ids.forEach(id => collection.append(id)); store.retain(ids[0], 'preview');
    expect(() => store.create(Buffer.from([2]), { width: 1, height: 1, mimeType: 'image/png' })).toThrow('空间已满');
    expect(collection.getCount()).toBe(32); expect(store.image(ids[0]).bytes).toEqual(Buffer.from([1]));
    expect(() => store.delete(ids[0])).toThrow('仍被使用');
    collection.clear(true, collection.snapshot().revision);
    expect(store.image(ids[0]).bytes.length).toBe(1);
    store.unretain(ids[0], 'preview'); expect(store.runtimeUsage().items).toBe(0);
    const huge = Buffer.alloc(64 * 1024 * 1024, 1);
    for (let i = 0; i < 4; i++) collection.append(store.create(huge, { width: 1, height: 1, mimeType: 'image/png' }).id);
    expect(() => store.create(Buffer.from([2]), { width: 1, height: 1, mimeType: 'image/png' })).toThrow('空间已满');
    expect(store.runtimeUsage().bytes).toBe(256 * 1024 * 1024); store.dispose();
  });
  it('does not delete saved images when clearing collection references', () => {
    const dir = mkdtempSync(join(tmpdir(), 'snipvia-collection-'));
    try {
      const store = new ScreenshotStore(dir), collection = new ScreenshotCollection(store);
      const id = store.create(Buffer.from([1]), { width: 1, height: 1, mimeType: 'image/png' }).id;
      collection.append(id); store.save(id);
      expect(collection.getItem(id).status).toBe('saved');
      collection.clear(true, collection.snapshot().revision);
      expect(store.list()).toHaveLength(1); expect(store.image(id).bytes).toEqual(Buffer.from([1]));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('isolates cancellation from previously committed collect results', async () => {
    const store = new ScreenshotStore('/unused'), collection = new ScreenshotCollection(store);
    const router = new CaptureModeRouter<string>({ quick: async () => {}, edit: async () => {}, collect: async result => { collection.append(result.value); } });
    const id = store.create(Buffer.from([1]), { width: 1, height: 1, mimeType: 'image/png' }).id;
    router.begin('first', 'collect'); await router.complete({ sessionId: 'first', value: id });
    router.begin('second', 'collect'); router.cancel('first'); router.cancel('second');
    expect(collection.getItems().map(i => i.id)).toEqual([id]);
    await expect(router.complete({ sessionId: 'second', value: id })).rejects.toThrow('失效');
    collection.clear(true, collection.snapshot().revision);
  });
});
