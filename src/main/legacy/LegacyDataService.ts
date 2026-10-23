import { lstat, readFile, realpath } from 'node:fs/promises';
import { existsSync, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { ZipFile } from 'yazl';
import type { LegacyRecord, LegacySnapshot } from '../../shared/legacy';
import type { ScreenshotStore } from '../storage/ScreenshotStore';

const recordsSchema = z.array(z.object({ id: z.string().uuid(), title: z.string().optional(), createdAt: z.string(), messages: z.array(z.unknown()).optional(), events: z.array(z.unknown()).optional(),
  capture: z.object({ id: z.string().uuid(), fileName: z.string().regex(/^[0-9a-f-]+\.jpg$/), width: z.number().int().positive(), height: z.number().int().positive(), createdAt: z.string() }).optional()
}).passthrough()).max(100000);
const booksSchema = z.object({ notebooks: z.array(z.object({ id: z.string().uuid(), name: z.string(), directory: z.string() })).max(100), activeId: z.string().nullable().optional() });

/** No initialization side effects, watchers, credentials, pruning, AI requests or writes to old data. */
export class LegacyDataService {
  constructor(private readonly userData: string) {}
  private async bytes(relative: string, max = 32 * 1024 * 1024) {
    const path = join(this.userData, relative);
    if (!existsSync(path)) return null;
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > max) throw new Error(relative + ' 无法安全读取，原文件已保留');
    // Parent directories must also stay inside the stable userData root.
    const canonicalRoot = await realpath(this.userData);
    if (await realpath(dirname(path)) !== join(canonicalRoot, dirname(relative) === '.' ? '' : dirname(relative))) throw new Error('旧数据目录链接不受支持');
    return readFile(path);
  }
  private async records(kind: 'history' | 'schedule') {
    const bytes = await this.bytes(kind === 'history' ? 'history/conversations.json' : 'schedule/jobs.json');
    return bytes ? recordsSchema.parse(JSON.parse(bytes.toString('utf8'))) : [];
  }
  private async books() {
    const bytes = await this.bytes('notebooks.json');
    return bytes ? booksSchema.parse(JSON.parse(bytes.toString('utf8'))).notebooks : [];
  }
  async read(): Promise<LegacySnapshot> {
    const result: LegacySnapshot = { conversations: [], schedule: [], notebooks: [], errors: [] };
    for (const [kind, target] of [['history', 'conversations'], ['schedule', 'schedule']] as const) {
      try {
        result[target] = (await this.records(kind)).map((record): LegacyRecord => ({
          id: record.id, title: record.title || (kind === 'schedule' ? '旧日程记录' : '旧截图对话'), createdAt: record.createdAt,
          detail: JSON.stringify(kind === 'schedule' ? record.events ?? [] : record.messages ?? [], null, 2).slice(0, 100000)
        }));
      } catch { result.errors.push(kind + ' 索引无法读取，原文件已保留。'); }
    }
    try { result.notebooks = await this.books(); } catch { result.errors.push('笔记目录索引无法读取，原文件已保留。'); }
    return result;
  }
  async notebookDirectory(id: string) {
    z.string().uuid().parse(id);
    const book = (await this.books()).find(book => book.id === id);
    if (!book) throw new Error('原笔记本不存在');
    const canonical = await realpath(book.directory);
    if (!(await lstat(canonical)).isDirectory()) throw new Error('原笔记本目录不可用');
    return canonical;
  }
  async importScreenshots(store: ScreenshotStore) {
    const result = { imported: 0, existing: 0, errors: [] as string[] };
    const existing = new Set(store.list().map(item => item.id));
    for (const kind of ['history', 'schedule'] as const) {
      let records: Awaited<ReturnType<LegacyDataService['records']>>;
      try { records = await this.records(kind); } catch { result.errors.push(kind + ' 索引无法导入，原文件已保留。'); continue; }
      for (const record of records) {
        const capture = record.capture;
        if (!capture) continue;
        if (existing.has(capture.id)) { result.existing++; continue; }
        try {
          if (capture.fileName !== capture.id + '.jpg') throw new Error('旧截图文件名无效');
          const bytes = await this.bytes(kind + '/captures/' + capture.fileName, 64 * 1024 * 1024);
          if (!bytes) throw new Error('旧截图文件缺失');
          store.create(bytes, { width: capture.width, height: capture.height, mimeType: 'image/jpeg' }, { id: capture.id, createdAt: capture.createdAt, legacyCaptureId: capture.id });
          try { store.save(capture.id); } finally { store.release(capture.id); }
          existing.add(capture.id); result.imported++;
        } catch { result.errors.push('截图 ' + capture.id + ' 未导入，原文件已保留。'); }
      }
    }
    return result;
  }
  async exportTo(path: string) {
    const zip = new ZipFile();
    // Only these historical indexes and their referenced screenshots are eligible.
    // User-owned external Markdown stays in place; the original registry is exported.
    let total = 0;
    for (const relative of ['history/conversations.json', 'schedule/jobs.json', 'notebooks.json']) {
      const bytes = await this.bytes(relative);
      if (bytes) { zip.addBuffer(bytes, relative, { mode: 0o600 }); total += bytes.length; }
    }
    const added = new Set<string>();
    for (const kind of ['history', 'schedule'] as const) {
      // A damaged index is still exported above byte-for-byte; skip only its image references.
      let records: Awaited<ReturnType<LegacyDataService['records']>> = [];
      try { records = await this.records(kind); } catch { /* Raw index is already preserved. */ }
      for (const record of records) {
        if (!record.capture) continue;
        const relative = kind + '/captures/' + record.capture.fileName;
        if (added.has(relative)) continue;
        const bytes = await this.bytes(relative, 64 * 1024 * 1024);
        if (!bytes) continue;
        total += bytes.length; if (total > 512 * 1024 * 1024) throw new Error('旧记录超过 512 MiB，请从本地数据目录备份');
        zip.addBuffer(bytes, relative, { mode: 0o600 }); added.add(relative);
      }
    }
    zip.addBuffer(Buffer.from('Legacy indexes and referenced screenshots only. External Markdown remains in its original directory; see notebooks.json. Credentials are excluded.\n'), 'README.txt');
    const stream = createWriteStream(path, { flags: 'wx', mode: 0o600 });
    const complete = pipeline(zip.outputStream, stream); zip.end(); await complete;
  }
}
