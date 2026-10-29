import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm, mkdir, writeFile, utimes, truncate, lstat } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { ScreenshotStore } from '../../src/main/storage/ScreenshotStore';
import { ScreenshotCollection } from '../../src/main/storage/ScreenshotCollection';
const runtime = vi.hoisted(() => ({ write: vi.fn(), read: vi.fn(), items: [] as { types: string[]; getType(type: string): Promise<Blob> }[] }));
vi.mock('electron', () => ({
  clipboard: { write: runtime.write, read: runtime.read },
  ClipboardItem: class {
    readonly types: string[];
    constructor(private values: Record<string, Blob>) { this.types = Object.keys(values); }
    async getType(type: string) { return this.values[type]; }
  }
}));
import { copyCollectionImages } from '../../src/main/storage/CollectionClipboard';
import { clipboardMatchesQuickTarget, quickTargetClipboardType } from '../../src/main/quick-target/clipboard-marker';
let directory: string, cache: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'snipvia-copy 中文-')); cache = join(directory, 'clipboard-files');
  runtime.write.mockReset(); runtime.read.mockReset(); runtime.items = [];
  runtime.read.mockImplementation(async () => runtime.items);
  runtime.write.mockImplementation(async entries => { runtime.items = entries; });
});
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });
function fixture() {
  const store = new ScreenshotStore(join(directory, 'sources')), collection = new ScreenshotCollection(store);
  const items = [Buffer.from([1, 2, 3]), Buffer.from([4, 5])].map((bytes, i) => store.create(bytes, { width: 10, height: 20, mimeType: i ? 'image/jpeg' : 'image/png' }));
  items.forEach(item => collection.append(item.id));
  return { store, collection, ids: items.map(item => item.id) };
}
async function files(types = ['text/uri-list']) {
  const entries = runtime.items;
  expect(entries).toHaveLength(1); expect(entries[0].types).toEqual(types);
  return (await (await entries[0].getType('text/uri-list')).text()).split('\r\n').map(uri => fileURLToPath(uri));
}
describe('native original-file clipboard transaction', () => {
  it('commits the chooser marker atomically alongside every original file and preserves reuse', async () => {
    const { store, ids } = fixture();
    await copyCollectionImages(store, ids, cache, 'shelf-all-marker');
    expect(runtime.write).toHaveBeenCalledOnce();
    const paths = await files(['text/uri-list', quickTargetClipboardType]);
    expect(paths).toHaveLength(2);
    expect(await readFile(paths[0])).toEqual(Buffer.from([1, 2, 3]));
    expect(await readFile(paths[1])).toEqual(Buffer.from([4, 5]));
    expect(await clipboardMatchesQuickTarget('shelf-all-marker')).toBe(true);
    await copyCollectionImages(store, ids, cache, 'next-marker');
    expect(await files(['text/uri-list', quickTargetClipboardType])).toEqual(paths);
    expect(await clipboardMatchesQuickTarget('shelf-all-marker')).toBe(false);
    expect(await clipboardMatchesQuickTarget('next-marker')).toBe(true);
  });
  it('commits every original in Collection order as one native file list, with unchanged PNG/JPEG bytes', async () => {
    const { store, ids } = fixture();
    await copyCollectionImages(store, ids, cache);
    expect(runtime.write).toHaveBeenCalledTimes(1);
    const paths = await files();
    expect(paths.map(path => basename(path))).toEqual(['001-' + ids[0] + '.png', '002-' + ids[1] + '.jpg']);
    expect(await readFile(paths[0])).toEqual(Buffer.from([1, 2, 3]));
    expect(await readFile(paths[1])).toEqual(Buffer.from([4, 5]));
    if (process.platform !== 'win32') {
      expect((await lstat(paths[0])).mode & 0o777).toBe(0o600);
      expect((await lstat(dirname(paths[0]))).mode & 0o777).toBe(0o700);
    }
    expect(runtime.read.mock.calls.length).toBe(2);
  });
  it('holds sources through asynchronous preparation and clipboard commit, then leaves independent files usable', async () => {
    const { store, collection, ids } = fixture();
    let finish!: () => void;
    runtime.write.mockImplementation(entries => new Promise<void>(resolve => { finish = () => { runtime.items = entries; resolve(); }; }));
    const pending = copyCollectionImages(store, ids, cache);
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    collection.clear(true, collection.snapshot().revision); expect(store.runtimeUsage().items).toBe(2);
    await expect(copyCollectionImages(store, ids, cache)).rejects.toThrow('正在复制');
    finish(); await pending;
    expect(store.runtimeUsage()).toEqual({ items: 0, bytes: 0 });
    const paths = await files(); store.dispose(); expect(await readFile(paths[0])).toEqual(Buffer.from([1, 2, 3]));
  });
  it('preserves sources and rolls back only a new batch on missing images or rejected clipboard writes', async () => {
    const { store, collection, ids } = fixture();
    await expect(copyCollectionImages(store, [ids[0], '00000000-0000-4000-8000-000000000001'], cache)).rejects.toThrow();
    expect(runtime.write).not.toHaveBeenCalled();
    runtime.write.mockRejectedValue(new Error('synthetic clipboard denied'));
    await expect(copyCollectionImages(store, ids, cache)).rejects.toThrow('clipboard denied');
    expect(await readdir(cache)).toEqual([]); expect(collection.getCount()).toBe(2);
    collection.clear(true, collection.snapshot().revision); expect(store.runtimeUsage()).toEqual({ items: 0, bytes: 0 });
  });
  it('does not claim success when the system readback loses one file, and keeps committed references valid', async () => {
    const { store, ids } = fixture();
    runtime.write.mockImplementation(async entries => {
      const uris = (await (await entries[0].getType('text/uri-list')).text()).split('\r\n');
      runtime.items = [{ types: ['text/uri-list'], getType: async () => new Blob([uris[0]]) }];
    });
    await expect(copyCollectionImages(store, ids, cache)).rejects.toThrow('未保留全部图片');
    const kept = fileURLToPath(await (await runtime.items[0].getType('text/uri-list')).text());
    expect(await readFile(kept)).toEqual(Buffer.from([1, 2, 3])); expect((await readdir(dirname(kept))).length).toBe(2);
  });
  it('reuses an intact current batch and only removes expired unreferenced batches', async () => {
    const { store, collection, ids } = fixture(); await copyCollectionImages(store, ids, cache);
    const first = await files(), old = new Date(Date.now() - 31 * 60 * 1000);
    await utimes(dirname(first[0]), old, old);
    await copyCollectionImages(store, ids, cache); expect(await files()).toEqual(first); expect((await readdir(cache)).length).toBe(1);
    const other = store.create(Buffer.from([9]), { width: 1, height: 1, mimeType: 'image/png' });
    collection.append(other.id);
    await copyCollectionImages(store, [other.id], cache);
    expect(await readFile(first[0])).toEqual(Buffer.from([1, 2, 3]));
    const current = await files(); await mkdir(join(cache, 'unrelated')); await writeFile(join(cache, 'unrelated', 'keep'), 'keep');
    await copyCollectionImages(store, [other.id], cache);
    await expect(readFile(first[0])).rejects.toThrow(); expect(await files()).toEqual(current);
    expect(await readFile(join(cache, 'unrelated', 'keep'), 'utf8')).toBe('keep');
  });
  it('bounds cache storage and preserves old files if space or preparation fails', async () => {
    const { store, ids } = fixture();
    const oldBatch = join(cache, 'batch-' + randomUUID()); await mkdir(oldBatch, { recursive: true });
    const old = join(oldBatch, '001-' + randomUUID() + '.png'); await writeFile(old, ''); await truncate(old, 512 * 1024 * 1024);
    await expect(copyCollectionImages(store, ids, cache)).rejects.toThrow('空间已满');
    expect(await readdir(cache)).toEqual([basename(oldBatch)]); expect(runtime.write).not.toHaveBeenCalled();
    expect(store.image(ids[0]).bytes).toEqual(Buffer.from([1, 2, 3]));
  });
  it('rejects invalid lists before changing the clipboard', async () => {
    const { store, ids } = fixture();
    for (const invalid of [[], [ids[0], ids[0]], Array.from({ length: 33 }, (_, i) => String(i))]) await expect(copyCollectionImages(store, invalid, cache)).rejects.toThrow();
    expect(runtime.write).not.toHaveBeenCalled(); expect(runtime.read).not.toHaveBeenCalled();
  });
});
