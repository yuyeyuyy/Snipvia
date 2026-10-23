import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { screenshotItemSchema, type ScreenshotItem } from '../../shared/screenshot';

const indexSchema = z.strictObject({ version: z.literal(1), items: z.array(screenshotItemSchema).max(100000) });
type RuntimeScreenshot = { item: ScreenshotItem; bytes: Buffer };

/** Lazy metadata index + bounded runtime bytes + independently persisted image files. */
export class ScreenshotStore {
  private runtime = new Map<string, RuntimeScreenshot>();
  private persisted: ScreenshotItem[] | null = null;
  private runtimeBytes = 0;
  private owners = new Map<string, Set<string>>();
  constructor(private readonly root: string) {}
  private get index() { return join(this.root, 'index.json'); }
  private load() {
    if (this.persisted) return;
    const items = existsSync(this.index) ? indexSchema.parse(JSON.parse(readFileSync(this.index, 'utf8'))).items : [];
    if (new Set(items.map(item => item.id)).size !== items.length || items.some(item => item.status !== 'saved' || !item.fileName || item.fileName !== item.id + (item.mimeType === 'image/png' ? '.png' : '.jpg'))) throw new Error('截图索引无效，原文件已保留');
    this.persisted = items;
  }
  private commit(items: ScreenshotItem[]) {
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    const tmp = this.index + '.' + randomUUID() + '.tmp';
    try { writeFileSync(tmp, JSON.stringify({ version: 1, items }), { flag: 'wx', mode: 0o600 }); renameSync(tmp, this.index); }
    finally { if (existsSync(tmp)) unlinkSync(tmp); }
    this.persisted = items;
  }
  create(bytes: Buffer, metadata: Pick<ScreenshotItem, 'width' | 'height' | 'mimeType' | 'sourceDisplayId'>, identity?: { id: string; createdAt: string; legacyCaptureId: string }) {
    if (bytes.length === 0 || bytes.length > 64 * 1024 * 1024) throw new Error('截图文件大小无效');
    const item = screenshotItemSchema.parse({ ...metadata, ...identity, id: identity?.id ?? randomUUID(), createdAt: identity?.createdAt ?? new Date().toISOString(), status: 'temporary' });
    if (this.runtime.has(item.id)) return { ...this.runtime.get(item.id)!.item };
    const candidates = [...this.runtime.keys()].filter(id => !this.owners.get(id)?.size);
    const releasableBytes = candidates.reduce((total, id) => total + this.runtime.get(id)!.bytes.length, 0);
    if (this.runtime.size - candidates.length >= 32 || this.runtimeBytes - releasableBytes + bytes.length > 256 * 1024 * 1024) throw new Error('收纳空间已满（最多 32 张 / 256 MiB），请先导出或移除图片；已有图片已保留');
    while (this.runtime.size >= 32 || this.runtimeBytes + bytes.length > 256 * 1024 * 1024) this.release(candidates.shift()!);
    this.runtime.set(item.id, { item, bytes: Buffer.from(bytes) }); this.runtimeBytes += bytes.length;
    return { ...item };
  }
  metadata(id: string): ScreenshotItem {
    z.string().uuid().parse(id);
    const runtime = this.runtime.get(id);
    if (runtime) return { ...runtime.item };
    this.load();
    const item = this.persisted!.find(item => item.id === id);
    if (!item) throw new Error('截图已失效或不存在');
    return { ...item };
  }
  retain(id: string, owner: string) {
    this.metadata(id);
    const refs = this.owners.get(id) ?? new Set<string>(); refs.add(owner); this.owners.set(id, refs);
  }
  unretain(id: string, owner: string) {
    const refs = this.owners.get(id); refs?.delete(owner);
    if (!refs?.size) { this.owners.delete(id); this.release(id); }
  }
  list() { this.load(); return this.persisted!.map(item => ({ ...item })); }
  image(id: string) {
    z.string().uuid().parse(id);
    const runtime = this.runtime.get(id);
    if (runtime) return { item: { ...runtime.item }, bytes: Buffer.from(runtime.bytes) };
    this.load();
    const item = this.persisted!.find(item => item.id === id);
    if (!item?.fileName) throw new Error('截图已失效或不存在');
    const file = join(this.root, item.fileName);
    const info = lstatSync(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 64 * 1024 * 1024) throw new Error('截图文件无效');
    return { item: { ...item }, bytes: readFileSync(file) };
  }
  save(id: string) {
    this.load();
    const saved = this.persisted!.find(item => item.id === id);
    if (saved) return { ...saved };
    const runtime = this.image(id);
    const item: ScreenshotItem = { ...runtime.item, status: 'saved', fileName: id + (runtime.item.mimeType === 'image/png' ? '.png' : '.jpg') };
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    const target = join(this.root, item.fileName!);
    // Never overwrite an orphaned/foreign image on an interrupted previous run.
    if (existsSync(target)) {
      const info = lstatSync(target);
      if (!info.isFile() || info.isSymbolicLink() || info.size !== runtime.bytes.length || !readFileSync(target).equals(runtime.bytes)) throw new Error('同名截图文件已存在，原文件已保留');
    }
    const existed = existsSync(target);
    try {
      if (!existed) writeFileSync(target, runtime.bytes, { flag: 'wx', mode: 0o600 });
      this.commit([item, ...this.persisted!]);
    } catch (error) { if (!existed && existsSync(target)) unlinkSync(target); throw error; }
    this.release(id);
    return { ...item };
  }
  delete(id: string) {
    z.string().uuid().parse(id);
    if (this.owners.get(id)?.size) throw new Error('截图仍被使用，请先从收纳区移除');
    this.load();
    const saved = this.persisted!.find(item => item.id === id);
    if (saved) {
      // Commit first. A failed file removal leaves an orphan, never a broken index.
      this.commit(this.persisted!.filter(item => item.id !== id));
      try { unlinkSync(join(this.root, saved.fileName!)); } catch { /* An orphan can be cleaned later; no source/legacy file is touched. */ }
    }
    this.release(id);
  }
  release(id: string) {
    if (this.owners.get(id)?.size) return;
    const item = this.runtime.get(id);
    if (item) { this.runtimeBytes -= item.bytes.length; this.runtime.delete(id); }
  }
  runtimeUsage() { return { items: this.runtime.size, bytes: this.runtimeBytes }; }
  dispose() { this.owners.clear(); this.runtime.clear(); this.runtimeBytes = 0; }
}
