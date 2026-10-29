import { clipboard, ClipboardItem } from 'electron';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, lstat, readFile, writeFile, rm } from 'node:fs/promises';
import { join, dirname, basename, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { ScreenshotStore } from './ScreenshotStore';
import { quickTargetClipboardMetadata } from '../quick-target/clipboard-marker';

const batchName = /^batch-[0-9a-f-]{36}$/;
const imageName = /^\d{3}-[0-9a-f-]{36}\.(png|jpg)$/;
const cacheLimit = 512 * 1024 * 1024, retentionMs = 30 * 60 * 1000;
let copying = false;
const canonical = (path: string) => process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path);

async function clipboardFiles() {
  const items = await clipboard.read();
  for (const item of items) {
    if (!item.types.includes('text/uri-list')) continue;
    const value = await item.getType('text/uri-list');
    if (!(value instanceof Blob) || value.size > 1024 * 1024) throw new Error('剪贴板文件列表无效');
    return (await value.text()).split(/\r?\n/).filter(line => line && !line.startsWith('#')).flatMap(line => {
      try { return new URL(line).protocol === 'file:' ? [fileURLToPath(line)] : []; } catch { return []; }
    });
  }
  return [];
}

/** Remove only old private batches which the current native clipboard no longer references. */
async function cacheUsage(root: string, protectedPaths: string[]) {
  const protectedFolders = new Set(protectedPaths.map(path => canonical(dirname(path))));
  let total = 0;
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !batchName.test(entry.name)) continue;
    const folder = join(root, entry.name), entries = await readdir(folder, { withFileTypes: true });
    const info = await lstat(folder);
    if (entries.every(file => file.isFile() && imageName.test(file.name))
      && !protectedFolders.has(canonical(folder)) && Date.now() - info.mtimeMs >= retentionMs) {
      try { await rm(folder, { recursive: true }); continue; } catch { /* A receiver may still hold a file. */ }
    }
    for (const file of entries) {
      const info = await lstat(join(folder, file.name));
      if (info.isFile()) total += info.size;
    }
  }
  return total;
}

async function reusableFiles(store: ScreenshotStore, ids: string[], root: string, files: string[], names: string[]) {
  if (files.length !== ids.length || !files.length) return false;
  const folder = dirname(files[0]);
  if (canonical(dirname(folder)) !== canonical(root) || !batchName.test(basename(folder))) return false;
  try { const info = await lstat(folder); if (!info.isDirectory() || info.isSymbolicLink()) return false; } catch { return false; }
  for (const [index, file] of files.entries()) {
    if (canonical(dirname(file)) !== canonical(folder) || basename(file) !== names[index]) return false;
    try {
      const info = await lstat(file), { bytes } = store.image(ids[index]);
      if (!info.isFile() || info.isSymbolicLink() || info.size !== bytes.length || !(await readFile(file)).equals(bytes)) return false;
    } catch { return false; }
  }
  return true;
}

/** One native copied-files entry, preserving all original bytes and Collection order. */
export async function copyCollectionImages(store: ScreenshotStore, ids: string[], cacheRoot: string, marker?: string) {
  if (!ids.length || ids.length > 32 || new Set(ids).size !== ids.length) throw new Error('没有可复制的截图或收纳列表无效');
  if (copying) throw new Error('正在复制收纳图片，请稍候');
  copying = true;
  const owner = 'clipboard:' + randomUUID(), retained: string[] = [];
  let folder: string | undefined, committed = false;
  try {
    for (const id of ids) { store.retain(id, owner); retained.push(id); }
    await mkdir(cacheRoot, { recursive: true, mode: 0o700 });
    const rootInfo = await lstat(cacheRoot);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error('复制缓存目录无效');
    const previous = await clipboardFiles();
    let usage = await cacheUsage(cacheRoot, previous);
    const names = ids.map((id, index) => String(index + 1).padStart(3, '0') + '-' + id + (store.metadata(id).mimeType === 'image/png' ? '.png' : '.jpg'));
    let paths = previous;
    if (!await reusableFiles(store, ids, cacheRoot, previous, names)) {
      const candidate = join(cacheRoot, 'batch-' + randomUUID());
      await mkdir(candidate, { mode: 0o700 }); folder = candidate;
      paths = [];
      for (const [index, id] of ids.entries()) {
        const { bytes } = store.image(id);
        if (bytes.length > cacheLimit - usage) throw new Error('复制缓存空间已满，请使用导出 PNG；原图已保留');
        const path = join(folder, names[index]);
        await writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
        paths.push(path); usage += bytes.length;
      }
    }
    const list = paths.map(path => pathToFileURL(path).href).join('\r\n');
    await clipboard.write([new ClipboardItem({ 'text/uri-list': new Blob([list], { type: 'text/uri-list' }), ...quickTargetClipboardMetadata(marker) })]);
    committed = true;
    const actual = await clipboardFiles();
    if (actual.length !== paths.length || actual.some((path, index) => canonical(path) !== canonical(paths[index]))) {
      throw new Error('系统剪贴板未保留全部图片，或已被其他应用更新；请重试，原图已保留');
    }
  } catch (error) {
    // Do not delete a batch already referenced by the native clipboard, even if readback failed.
    if (folder && !committed) await rm(folder, { recursive: true, force: true }).catch(() => {});
    throw error;
  } finally {
    for (const id of retained) store.unretain(id, owner);
    copying = false;
  }
}
