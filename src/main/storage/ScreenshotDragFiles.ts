import { lstatSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { ScreenshotStore } from './ScreenshotStore';

type DragFile = { path: string; bytes: number; usedAt: number };
/** Private originals for native drag; independent of Collection removal during a drop. */
export class ScreenshotDragFiles {
  private root: string | null = null;
  private files = new Map<string, DragFile>();
  private total = 0;
  constructor(private readonly temporaryRoot: string, private readonly now = Date.now,
    private readonly limit = { bytes: 256 * 1024 * 1024, items: 128, retentionMs: 30 * 60 * 1000 }) {}
  prepare(id: string, store: Pick<ScreenshotStore, 'image'>) {
    z.string().uuid().parse(id);
    const now = this.now();
    for (const [key, file] of this.files) {
      if (now - file.usedAt < this.limit.retentionMs) continue;
      try { rmSync(file.path, { force: true }); } catch { continue; } // A drop target may still hold the file on Windows.
      this.total -= file.bytes; this.files.delete(key);
    }
    const cached = this.files.get(id);
    if (cached) {
      const info = lstatSync(cached.path);
      if (!info.isFile() || info.isSymbolicLink() || info.size !== cached.bytes) throw new Error('拖放临时文件无效，请使用导出 PNG');
      cached.usedAt = now; return cached.path;
    }
    const { item, bytes } = store.image(id);
    if (bytes.length > this.limit.bytes - this.total || this.files.size >= this.limit.items) throw new Error('拖放临时空间已满，请使用导出 PNG；原图已保留');
    if (!this.root) this.root = mkdtempSync(join(this.temporaryRoot, 'snipvia-drag-'));
    const path = join(this.root, 'Snipvia-' + id + (item.mimeType === 'image/png' ? '.png' : '.jpg'));
    writeFileSync(path, bytes, { flag: 'wx', mode: 0o600 });
    this.files.set(id, { path, bytes: bytes.length, usedAt: now }); this.total += bytes.length;
    return path;
  }
  dispose() {
    if (this.root) {
      try { rmSync(this.root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }); }
      catch { /* A receiver may hold a Windows lock; temporary cleanup must not block quit. */ }
    }
    this.root = null; this.files.clear(); this.total = 0;
  }
}
