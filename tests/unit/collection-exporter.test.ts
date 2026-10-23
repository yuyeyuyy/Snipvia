import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ScreenshotCollection } from '../../src/main/storage/ScreenshotCollection';
import { ScreenshotStore } from '../../src/main/storage/ScreenshotStore';
import { exportCollectionPng } from '../../src/main/storage/CollectionExporter';
const io = vi.hoisted(() => ({ calls: 0, failAt: 0, block: false, release: null as (() => void) | null }));
vi.mock('electron', () => ({ nativeImage: { createFromBuffer: () => { throw new Error('PNG should not be re-encoded'); } } }));
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, writeFile: async (...args: Parameters<typeof actual.writeFile>) => {
    io.calls++;
    if (io.failAt === io.calls) throw new Error('synthetic disk full');
    if (io.block) { io.block = false; await new Promise<void>(resolve => { io.release = resolve; }); }
    return actual.writeFile(...args);
  } };
});
describe('CollectionExporter safe lifecycle', () => {
  it('rolls back only its new partial folder, then holds source references if collection clears during asynchronous output', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'snipvia-collection-exporter-'));
    try {
      const store = new ScreenshotStore(join(dir, 'store')), collection = new ScreenshotCollection(store);
      const ids = Array.from({ length: 3 }, (_, i) => store.create(Buffer.from([i + 1]), { width: 1, height: 1, mimeType: 'image/png' }).id);
      ids.forEach(id => collection.append(id));
      await writeFile(join(dir, 'untouched.txt'), 'keep');
      io.calls = 0; io.failAt = 2;
      await expect(exportCollectionPng(store, ids, dir)).rejects.toThrow('原图已保留');
      expect(await readdir(dir)).toEqual(['untouched.txt']);
      expect(await readFile(join(dir, 'untouched.txt'), 'utf8')).toBe('keep');
      expect(collection.getCount()).toBe(3);
      expect(store.image(ids[0]).bytes).toEqual(Buffer.from([1]));
      io.calls = 0; io.failAt = 0; io.block = true;
      const pending = exportCollectionPng(store, ids, dir);
      await vi.waitFor(() => expect(io.release).not.toBeNull());
      collection.clear(true, collection.snapshot().revision);
      expect(store.runtimeUsage().items).toBe(3);
      io.release!(); const result = await pending;
      expect(result.count).toBe(3); expect((await readdir(result.directory)).length).toBe(3);
      expect(store.runtimeUsage()).toEqual({ items: 0, bytes: 0 });
    } finally { io.failAt = 0; io.block = false; io.release = null; await rm(dir, { recursive: true, force: true }); }
  });
});
