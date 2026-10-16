import { constants, watch, type FSWatcher } from 'node:fs';
import { mkdir, readFile, writeFile, rename, lstat, realpath, readdir, open, unlink } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { ZipFile } from 'yazl';
import { z } from 'zod';
import { noteNameSchema, notePathSchema, type Notebook, type NoteEntry, type NoteDocument, type NotesState, type NoteSaveResult, type NoteAsset } from '../../shared/notes';
import { noteLinks, resolveNoteLink, rewriteNoteLinks } from '../../shared/note-markdown';

const storeSchema = z.object({ notebooks: z.array(z.object({ id: z.string().uuid(), name: noteNameSchema, directory: z.string() })).max(100), activeId: z.string().uuid().nullable() });
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';
const noteLimit = 2 * 1024 * 1024;
const imageTypes: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
const isInside = (root: string, target: string) => { const part = relative(root, target); return part === '' || (!part.startsWith(`..${sep}`) && part !== '..' && !part.startsWith(sep)); };

/** User-selected directories only; the renderer never supplies an absolute filesystem path. */
export class NotebookService {
  private stateValue: NotesState = { notebooks: [], activeId: null };
  private loaded?: Promise<void>;
  private queue: Promise<unknown> = Promise.resolve();
  private locations = new Map<string, { directory: string; expires: number }>();
  private watcher?: FSWatcher;
  private timer?: NodeJS.Timeout;
  constructor(private readonly storePath: string, private readonly trashItem: (path: string) => Promise<void>, private readonly changed: (id: string) => void = () => {}) {}
  private load() {
    return this.loaded ??= (async () => {
      try { this.stateValue = storeSchema.parse(JSON.parse(await readFile(this.storePath, 'utf8'))); }
      catch (error) { if (!missing(error)) throw new Error('笔记本列表读取失败，原文件已保留'); }
    })();
  }
  private async locked<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation, operation); this.queue = next.catch(() => {}); return next;
  }
  async idle() { await this.queue; }
  notifyChanged(id: string) { this.changed(id); }
  dispose() { this.watcher?.close(); clearTimeout(this.timer); }
  async state() { await this.load(); return structuredClone(this.stateValue); }
  async authorizedNotebook(id: string): Promise<Notebook> { return { ...await this.book(id) }; }
  private async persist() {
    await mkdir(dirname(this.storePath), { recursive: true });
    const temp = `${this.storePath}.${randomUUID()}.tmp`;
    try { await writeFile(temp, JSON.stringify(this.stateValue), { flag: 'wx', mode: 0o600 }); await rename(temp, this.storePath); }
    finally { await unlink(temp).catch(() => {}); }
  }
  async chooseLocation(directory: string) {
    const canonical = await realpath(directory); if (!(await lstat(canonical)).isDirectory()) throw new Error('请选择文件夹');
    const token = randomUUID();
    for (const [id, entry] of this.locations) if (entry.expires <= Date.now()) this.locations.delete(id);
    if (this.locations.size >= 5) this.locations.delete(this.locations.keys().next().value!);
    this.locations.set(token, { directory: canonical, expires: Date.now() + 10 * 60_000 });
    return { token, directory: canonical };
  }
  async create(token: string, name: string): Promise<Notebook> {
    return this.locked(async () => {
      await this.load(); name = noteNameSchema.parse(name);
      const location = this.locations.get(token);
      if (!location || location.expires < Date.now()) throw new Error('目录选择已过期，请重新选择');
      if (await realpath(location.directory) !== location.directory) throw new Error('目录位置已改变，请重新选择');
      const directory = join(location.directory, name);
      await mkdir(directory); // Never adopt/overwrite an existing same-name folder implicitly.
      await mkdir(join(directory, 'assets'));
      const book = await this.register(directory, name); this.locations.delete(token); return book;
    });
  }
  async open(directory: string): Promise<Notebook> {
    return this.locked(async () => {
      await this.load(); const root = await realpath(directory);
      if (!(await lstat(root)).isDirectory()) throw new Error('请选择笔记本目录');
      return this.register(root, noteNameSchema.parse(basename(root)));
    });
  }
  private async register(directory: string, name: string) {
    const previous = this.stateValue.notebooks.find((item) => item.directory === directory);
    if (!previous && this.stateValue.notebooks.length >= 100) throw new Error('最多保留 100 个笔记本');
    const notebook = previous ?? { id: randomUUID(), name, directory };
    const before = structuredClone(this.stateValue);
    if (!previous) this.stateValue.notebooks.push(notebook);
    this.stateValue.activeId = notebook.id;
    try { await this.persist(); } catch (error) { this.stateValue = before; throw error; }
    this.observe(notebook); return { ...notebook };
  }
  async select(id: string) {
    return this.locked(async () => { const book = await this.book(id); return this.register(book.directory, book.name); });
  }
  async unlink(id: string): Promise<NotesState> {
    return this.locked(async () => {
      await this.load();
      if (!this.stateValue.notebooks.some((item) => item.id === id)) throw new Error('笔记本链接已不存在');
      const before = structuredClone(this.stateValue);
      this.stateValue.notebooks = this.stateValue.notebooks.filter((item) => item.id !== id);
      if (this.stateValue.activeId === id) this.stateValue.activeId = null;
      try { await this.persist(); } catch (error) { this.stateValue = before; throw error; }
      // Only remove the registry entry; even a missing directory can be unlinked.
      if (before.activeId === id) this.dispose();
      return structuredClone(this.stateValue);
    });
  }
  private observe(book: Notebook) {
    this.watcher?.close(); clearTimeout(this.timer);
    try {
      this.watcher = watch(book.directory, { recursive: true }, (_event, filename) => {
        if (filename?.split(/[\\/]/).some((part) => part.startsWith('.'))) return;
        clearTimeout(this.timer); this.timer = setTimeout(() => this.changed(book.id), 300); this.timer.unref();
      });
      this.watcher.on('error', () => this.changed(book.id));
    } catch { /* The UI also refreshes on focus and exposes manual refresh. */ }
  }
  private async book(id: string): Promise<Notebook> {
    await this.load(); const book = this.stateValue.notebooks.find((item) => item.id === id);
    if (!book) throw new Error('笔记本尚未授权，请通过目录选择器打开');
    if ((await lstat(book.directory)).isSymbolicLink() || await realpath(book.directory) !== book.directory) throw new Error('笔记本路径已改变，请重新打开');
    return book;
  }
  private async path(book: Notebook, input: string, allowMissing = false): Promise<string> {
    notePathSchema.parse(input);
    let current = book.directory; const parts = input.split('/');
    for (let i = 0; i < parts.length; i++) {
      current = join(current, parts[i]);
      try {
        const info = await lstat(current);
        if (info.isSymbolicLink()) throw new Error('不支持符号链接，文件必须位于笔记本中');
        if (i < parts.length - 1 && !info.isDirectory()) throw new Error('父路径不是目录');
      } catch (error) { if (!(allowMissing && i === parts.length - 1 && missing(error))) throw error; }
    }
    if (!isInside(book.directory, current) || !isInside(book.directory, await realpath(dirname(current)))) throw new Error('文件超出笔记本目录');
    return current;
  }
  private async readBytes(book: Notebook, path: string, limit: number) {
    const absolute = await this.path(book, path);
    const handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > limit) throw new Error(`文件过大或不是普通文件（最多 ${Math.round(limit / 1024 / 1024)} MB）`);
      const bytes = Buffer.alloc(Math.min(limit + 1, info.size + 1)); let total = 0;
      while (total < bytes.length) { const result = await handle.read(bytes, total, bytes.length - total, total); if (!result.bytesRead) break; total += result.bytesRead; }
      if (total > limit || total > info.size) throw new Error('文件正在被其他程序修改，请重试');
      return { bytes: bytes.subarray(0, total), info };
    } finally { await handle.close(); }
  }
  private async document(book: Notebook, path: string) {
    if (!/\.md$/i.test(path)) throw new Error('只支持编辑 Markdown 文件');
    const { bytes, info } = await this.readBytes(book, path, noteLimit);
    let content: string;
    try { content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { throw new Error('文件不是 UTF-8 文本，已保留原文件'); }
    return { path, content, version: hash(bytes), info };
  }
  async read(id: string, path: string): Promise<NoteDocument> { const doc = await this.document(await this.book(id), path); return { path: doc.path, content: doc.content, version: doc.version }; }
  async entries(id: string): Promise<NoteEntry[]> {
    const book = await this.book(id); const entries: NoteEntry[] = [];
    const walk = async (parent: string, depth: number) => {
      if (depth > 40) throw new Error('笔记本目录层级超过 40 层');
      const directory = parent ? await this.path(book, parent) : book.directory;
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) continue;
        const path = parent ? `${parent}/${entry.name}` : entry.name;
        if (!notePathSchema.safeParse(path).success) continue;
        const info = await lstat(await this.path(book, path));
        entries.push({ path, name: entry.name, kind: info.isDirectory() ? 'folder' : /\.md$/i.test(entry.name) ? 'note' : 'asset', modifiedAt: info.mtimeMs, createdAt: info.birthtimeMs, size: info.size });
        if (entries.length > 10_000) throw new Error('笔记本超过 10000 个条目，请拆分笔记本');
        if (info.isDirectory()) await walk(path, depth + 1);
      }
    };
    await walk('', 0); return entries;
  }
  private async replace(book: Notebook, before: NoteDocument, content: string): Promise<NoteDocument> {
    const original = await this.document(book, before.path);
    if (original.version !== before.version) throw new Error('文件已被其他程序修改，请重新读取');
    if (original.info.nlink !== 1) throw new Error('不修改硬链接文件，请先复制为独立文件');
    const bom = original.content.startsWith('\ufeff');
    const newline = original.content.includes('\r\n') ? '\r\n' : '\n';
    content = content.replace(/^\ufeff/, '').replace(/\r\n|\r|\n/g, newline);
    if (bom) content = `\ufeff${content}`;
    if (Buffer.byteLength(content) > noteLimit) throw new Error('单篇笔记最多 2 MB');
    const absolute = await this.path(book, before.path); const temp = join(dirname(absolute), `.snipvia-${randomUUID()}.tmp`);
    try {
      const handle = await open(temp, 'wx', original.info.mode & 0o777);
      try { await handle.writeFile(content, 'utf8'); await handle.sync(); } finally { await handle.close(); }
      const current = await this.document(book, before.path);
      if (current.version !== before.version || current.info.ino !== original.info.ino) throw new Error('文件在保存时发生变化，未覆盖');
      await this.path(book, before.path); await rename(temp, absolute);
      return { path: before.path, content, version: hash(Buffer.from(content)) };
    } finally { await unlink(temp).catch(() => {}); }
  }
  async save(id: string, document: NoteDocument): Promise<NoteSaveResult> {
    return this.locked(async () => {
      const book = await this.book(id); const current = await this.read(id, document.path);
      if (current.version !== document.version) return { conflict: true, current };
      if (current.content === document.content) return { conflict: false, document: current };
      return { conflict: false, document: await this.replace(book, current, document.content) };
    });
  }
  async createEntry(id: string, parent: string, name: string, kind: 'folder' | 'note') {
    return this.locked(async () => {
      const book = await this.book(id); name = noteNameSchema.parse(name);
      if (parent === 'assets' || parent.startsWith('assets/')) throw new Error('assets 用于附件，请选择笔记目录');
      const path = [parent, kind === 'note' ? name.replace(/\.md$/i, '') + '.md' : name].filter(Boolean).join('/');
      const absolute = await this.path(book, path, true);
      if (kind === 'folder') await mkdir(absolute); else await writeFile(absolute, '', { flag: 'wx' });
      this.changed(id); return path;
    });
  }
  async move(id: string, from: string, to: string) {
    return this.locked(async () => {
      if (from === to) return;
      if (from === 'assets' || to === 'assets' || to.startsWith(`${from}/`)) throw new Error('不能移动附件根目录或移动到自身内部');
      const book = await this.book(id); const source = await this.path(book, from); const destination = await this.path(book, to, true);
      noteNameSchema.parse(basename(to));
      if (/\.md$/i.test(from) && (!/\.md$/i.test(to) || to.startsWith('assets/'))) throw new Error('笔记必须保留 .md 后缀并放在笔记目录');
      try { await lstat(destination); throw new Error('目标名称已存在'); } catch (error) { if (!missing(error)) throw error; }
      const entries = await this.entries(id); const paths = entries.filter((item) => item.kind !== 'folder').map((item) => item.path);
      const moved = (path: string) => path === from || path.startsWith(`${from}/`) ? to + path.slice(from.length) : path;
      const changes: Array<{ before: NoteDocument; content: string }> = [];
      for (const entry of entries.filter((item) => item.kind === 'note')) {
        const doc = await this.read(id, entry.path); const content = rewriteNoteLinks(doc.content, entry.path, moved(entry.path), paths, moved);
        if (content !== doc.content) changes.push({ before: doc, content });
      }
      for (const change of changes) if ((await this.read(id, change.before.path)).version !== change.before.version) throw new Error('关联笔记已变化，未执行移动');
      await this.path(book, from); await this.path(book, to, true);
      try { await lstat(destination); throw new Error('目标名称已存在'); } catch (error) { if (!missing(error)) throw error; }
      await rename(source, destination);
      const saved: Array<{ old: NoteDocument; current: NoteDocument }> = [];
      try {
        for (const change of changes) {
          const old = { ...change.before, path: moved(change.before.path) };
          saved.push({ old, current: await this.replace(book, old, change.content) });
        }
      } catch (error) {
        let restored = true;
        for (const item of saved.reverse()) try { await this.replace(book, item.current, item.old.content); } catch { restored = false; }
        if (restored) {
          try { await lstat(source); restored = false; } catch (checkError) { if (!missing(checkError)) restored = false; }
          if (restored) try { await this.path(book, from, true); await rename(destination, source); } catch { restored = false; }
        }
        this.changed(id);
        throw new Error(restored ? `移动失败，已还原：${error instanceof Error ? error.message : '写入错误'}` : '关联文件发生并发修改，已停止；请刷新并检查链接');
      }
      this.changed(id);
    });
  }
  async trash(id: string, path: string) {
    return this.locked(async () => {
      if (path === 'assets') throw new Error('不能删除附件根目录');
      const absolute = await this.path(await this.book(id), path); await this.trashItem(absolute); this.changed(id);
    });
  }
  async backlinks(id: string, target: string) {
    const entries = await this.entries(id); const paths = entries.filter((item) => item.kind !== 'folder').map((item) => item.path); const result = [];
    for (const entry of entries.filter((item) => item.kind === 'note' && item.path !== target)) {
      const doc = await this.read(id, entry.path);
      const link = noteLinks(doc.content).find((item) => resolveNoteLink(item.target, entry.path, paths, item.wiki).path === target);
      if (link) result.push({ path: entry.path, name: entry.name.replace(/\.md$/i, ''), excerpt: doc.content.slice(Math.max(0, link.from - 35), link.to + 70).replace(/\s+/g, ' ') });
    }
    return result;
  }
  async addAsset(id: string, name: string, bytes: Uint8Array): Promise<NoteAsset> {
    return this.locked(async () => {
      if (!bytes.length || bytes.length > 25 * 1024 * 1024) throw new Error('附件最多 25 MB');
      const book = await this.book(id); const assets = await this.path(book, 'assets', true); await mkdir(assets).catch((error) => { if (error.code !== 'EEXIST') throw error; });
      await this.path(book, 'assets');
      const safeName = basename(name).replace(/[^\p{L}\p{N}_. -]/gu, '-').replace(/^\.+/, '').slice(-100) || 'attachment';
      const path = `assets/${randomUUID().slice(0, 8)}-${safeName}`;
      await writeFile(await this.path(book, path, true), bytes, { flag: 'wx' }); this.changed(id);
      return { path, image: !!imageTypes[extname(path).toLowerCase()] };
    });
  }
  async image(id: string, path: string): Promise<string | null> {
    const type = imageTypes[extname(path).toLowerCase()]; if (!type) return null;
    const { bytes } = await this.readBytes(await this.book(id), path, 25 * 1024 * 1024);
    const valid = type === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : type === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 : type === 'image/gif' ? /^GIF8[79]a/.test(bytes.subarray(0, 6).toString())
        : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
    return valid ? `data:${type};base64,${bytes.toString('base64')}` : null;
  }
  async revealPath(id: string, path: string) { return this.path(await this.book(id), path); }
  async export(id: string, outputPath: string) {
    return this.locked(async () => {
      const book = await this.book(id); const destination = resolve(await realpath(dirname(outputPath)), basename(outputPath));
      if (isInside(book.directory, destination)) throw new Error('请将导出文件保存到笔记本目录之外');
      const entries = await this.entries(id);
      if (entries.reduce((total, entry) => total + (entry.kind === 'folder' ? 0 : entry.size), 0) > 512 * 1024 * 1024) throw new Error('打包内容超过 512 MB，请直接复制笔记本文件夹');
      const zip = new ZipFile(); const temp = `${destination}.${randomUUID()}.tmp`; const file = await open(temp, 'wx', 0o600);
      const stream = file.createWriteStream(); zip.on('error', (error) => stream.destroy(error));
      const copying = pipeline(zip.outputStream, stream); void copying.catch(() => {});
      try {
        zip.addEmptyDirectory(`${book.name}/`);
        for (const entry of entries) {
          const name = `${book.name}/${entry.path}`;
          if (entry.kind === 'folder') zip.addEmptyDirectory(`${name}/`);
          else zip.addReadStreamLazy(name, { size: entry.size, mtime: new Date(entry.modifiedAt) }, (callback) => {
            void this.path(book, entry.path).then((path) => open(path, constants.O_RDONLY | constants.O_NOFOLLOW)).then(async (handle) => {
              try {
                const info = await handle.stat();
                if (!info.isFile() || info.size !== entry.size || info.mtimeMs !== entry.modifiedAt) throw new Error('文件在导出时发生变化，请重试');
                callback(null, handle.createReadStream());
              } catch (error) { await handle.close(); callback(error, null!); }
            }).catch((error) => callback(error, null!));
          });
        }
        zip.end(); await copying; await rename(temp, destination); return destination;
      } finally { stream.destroy(); await file.close().catch(() => {}); await unlink(temp).catch(() => {}); }
    });
  }
}
