import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { nativeImage } from 'electron';
import type { ScreenshotStore } from './ScreenshotStore';

/** Caller holds stable IDs; owns only the newly created output directory. */
export async function exportCollectionPng(store: ScreenshotStore, ids: string[], destination: string) {
  const owner = 'export:' + randomUUID();
  for (const id of ids) store.retain(id, owner);
  let folder: string | undefined;
  try {
    folder = await mkdtemp(join(destination, 'Snipvia-'));
    for (const [index, id] of ids.entries()) {
      const { item, bytes } = store.image(id);
      const png = item.mimeType === 'image/png' ? bytes : nativeImage.createFromBuffer(bytes).toPNG();
      await writeFile(join(folder, String(index + 1).padStart(3, '0') + '-' + id + '.png'), png, { flag: 'wx', mode: 0o600 });
    }
    return { count: ids.length, directory: folder };
  } catch (error) {
    if (folder) await rm(folder, { recursive: true, force: true }).catch(() => {});
    throw new Error('导出失败，原图已保留：' + (error instanceof Error ? error.message : '无法写入'));
  } finally { for (const id of ids) store.unretain(id, owner); }
}
