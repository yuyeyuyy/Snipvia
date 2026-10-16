import { mkdtemp, readFile, writeFile, readdir, rm, symlink, link, rename, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { inflateRawSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotebookService } from '../../src/main/notes/NotebookService';
import { noteHeadings, noteLinks, resolveNoteLink, rewriteNoteLinks, renderableNote } from '../../src/shared/note-markdown';
import { noteNameSchema, notePathSchema } from '../../src/shared/notes';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
async function fixture() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'snipvia-notes-')));
  const trash = vi.fn(async (path: string) => { await rename(path, join(directory, 'trashed')); });
  const service = new NotebookService(join(directory, 'config', 'notebooks.json'), trash);
  cleanups.push(async () => { service.dispose(); await service.idle(); await rm(directory, { recursive: true, force: true }); });
  const location = await service.chooseLocation(directory); const book = await service.create(location.token, '学习笔记');
  return { directory, service, book, trash };
}
async function note(service: NotebookService, id: string, name: string, content = '', parent = '') {
  const path = await service.createEntry(id, parent, name, 'note'); const doc = await service.read(id, path);
  const saved = await service.save(id, { ...doc, content }); if (saved.conflict) throw new Error('unexpected conflict'); return saved.document;
}
function unzip(bytes: Buffer) {
  const eocd = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])); const files = new Map<string, string>();
  let position = bytes.readUInt32LE(eocd + 16);
  for (let i = 0; i < bytes.readUInt16LE(eocd + 10); i++) {
    expect(bytes.readUInt32LE(position)).toBe(0x02014b50);
    const length = bytes.readUInt16LE(position + 28); const name = bytes.subarray(position + 46, position + 46 + length).toString();
    const local = bytes.readUInt32LE(position + 42); const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    const data = bytes.subarray(start, start + bytes.readUInt32LE(position + 20));
    files.set(name, (bytes.readUInt16LE(position + 10) === 8 ? inflateRawSync(data) : data).toString());
    position += 46 + length + bytes.readUInt16LE(position + 30) + bytes.readUInt16LE(position + 32);
  }
  return files;
}

describe('authorized local notebook storage', () => {
  it('creates an empty vault with assets, restores its registration and rejects arbitrary ids or consumed tokens', async () => {
    const { directory, service, book } = await fixture();
    expect(await readdir(book.directory)).toEqual(['assets']);
    const restored = new NotebookService(join(directory, 'config', 'notebooks.json'), async () => {});
    expect(await restored.state()).toMatchObject({ activeId: book.id, notebooks: [book] });
    await expect(service.entries('00000000-0000-4000-8000-000000000000')).rejects.toThrow('尚未授权');
    const location = await service.chooseLocation(directory); await service.create(location.token, '其他笔记');
    await expect(service.create(location.token, '再次创建')).rejects.toThrow('过期');
    const same = await service.open(book.directory); expect(same.id).toBe(book.id); expect((await service.state()).notebooks).toHaveLength(2);
  });
  it('does not adopt or overwrite an existing folder and allows correcting the name', async () => {
    const { directory, service } = await fixture(); const location = await service.chooseLocation(directory);
    await expect(service.create(location.token, '学习笔记')).rejects.toMatchObject({ code: 'EEXIST' });
    expect((await service.create(location.token, '新的笔记')).name).toBe('新的笔记');
  });
  it('unlinks the active notebook after queued saves, preserves files and attachments, and can reopen it', async () => {
    const { directory, service, book, trash } = await fixture();
    const doc = await note(service, book.id, '草稿', '原文');
    const asset = await service.addAsset(book.id, 'sample.txt', Buffer.from('附件'));
    const saving = service.save(book.id, { ...doc, content: '移除前最后一笔' });
    const removing = service.unlink(book.id);
    expect((await saving).conflict).toBe(false);
    expect(await removing).toEqual({ notebooks: [], activeId: null });
    expect(await readFile(join(book.directory, doc.path), 'utf8')).toBe('移除前最后一笔');
    expect(await readFile(join(book.directory, asset.path), 'utf8')).toBe('附件');
    expect(trash).not.toHaveBeenCalled();
    await expect(service.read(book.id, doc.path)).rejects.toThrow('尚未授权');
    const restored = new NotebookService(join(directory, 'config', 'notebooks.json'), trash);
    expect(await restored.state()).toEqual({ notebooks: [], activeId: null });
    const reopened = await service.open(book.directory);
    expect(reopened.id).not.toBe(book.id);
    expect((await service.read(reopened.id, doc.path)).content).toBe('移除前最后一笔');
  });
  it('unlinks inactive or unavailable notebooks without changing the active notebook', async () => {
    const { directory, service, book, trash } = await fixture();
    const location = await service.chooseLocation(directory); const other = await service.create(location.token, '另一个笔记本');
    await rename(book.directory, join(directory, '已移动'));
    expect(await service.unlink(book.id)).toEqual({ notebooks: [other], activeId: other.id });
    expect((await service.entries(other.id)).map((entry) => entry.path)).toEqual(['assets']);
    await expect(service.unlink(book.id)).rejects.toThrow('链接已不存在');
    expect(trash).not.toHaveBeenCalled();
  });
  it('rolls back registration when unlink persistence fails', async () => {
    const { directory, service, book } = await fixture(); const store = join(directory, 'config', 'notebooks.json');
    const saved = await readFile(store, 'utf8');
    await rename(join(directory, 'config'), join(directory, 'config-backup'));
    await writeFile(join(directory, 'config'), '阻止写入');
    await expect(service.unlink(book.id)).rejects.toThrow();
    expect(await service.state()).toEqual({ notebooks: [book], activeId: book.id });
    expect(await readFile(join(directory, 'config-backup', 'notebooks.json'), 'utf8')).toBe(saved);
    expect(await service.authorizedNotebook(book.id)).toEqual(book);
  });
  it('preserves UTF-8 BOM and CRLF, serializes competing saves and leaves no temp files', async () => {
    const { service, book } = await fixture();
    await writeFile(join(book.directory, 'Windows.md'), '\ufeff# 标题\r\n原文\r\n');
    const doc = await service.read(book.id, 'Windows.md');
    const [first, second] = await Promise.all([service.save(book.id, { ...doc, content: '# 新标题\n新内容\n' }), service.save(book.id, { ...doc, content: 'late edit' })]);
    expect(first.conflict).toBe(false); expect(second.conflict).toBe(true);
    expect(await readFile(join(book.directory, doc.path), 'utf8')).toBe('\ufeff# 新标题\r\n新内容\r\n');
    expect((await readdir(book.directory)).some((name) => name.startsWith('.snipvia-'))).toBe(false);
  });
  it('does not overwrite concurrent edits, non-UTF8 or hard-linked files', async () => {
    const { service, book, directory } = await fixture(); const doc = await note(service, book.id, 'draft', 'original');
    await writeFile(join(book.directory, doc.path), 'external');
    expect(await service.save(book.id, { ...doc, content: 'mine' })).toMatchObject({ conflict: true, current: { content: 'external' } });
    expect(await readFile(join(book.directory, doc.path), 'utf8')).toBe('external');
    await writeFile(join(book.directory, 'binary.md'), Buffer.from([0xff, 0xfe]));
    await expect(service.read(book.id, 'binary.md')).rejects.toThrow('UTF-8');
    await link(join(book.directory, doc.path), join(directory, 'hard.md'));
    await expect(service.save(book.id, { ...await service.read(book.id, doc.path), content: 'changed' })).rejects.toThrow('硬链接');
  });
  it('rejects traversal, symlink files and intermediate symlink folders without reading outside the selected root', async () => {
    const { service, book, directory } = await fixture(); await writeFile(join(directory, 'secret.md'), 'outside');
    await symlink(join(directory, 'secret.md'), join(book.directory, 'shortcut.md'));
    await symlink(directory, join(book.directory, 'outside'));
    for (const path of ['../secret.md', '/etc/passwd', 'outside/secret.md', 'shortcut.md', '.private/key.md', 'C:\\secret.md']) await expect(service.read(book.id, path)).rejects.toThrow();
    expect((await service.entries(book.id)).some((entry) => entry.path.includes('outside') || entry.path.includes('shortcut'))).toBe(false);
    await expect(service.createEntry(book.id, 'outside', 'new', 'note')).rejects.toThrow('符号链接');
  });
  it('renames notes and folders, updates incoming/outgoing links, preserves aliases and code, and returns backlinks', async () => {
    const { service, book } = await fixture(); await service.createEntry(book.id, '', '项目', 'folder'); await service.createEntry(book.id, '', '归档', 'folder');
    const target = await note(service, book.id, '计划', '# 标题\n[[入口]]', '项目');
    await note(service, book.id, '入口', '[[项目/计划#标题|计划别名]]\n[计划](项目/计划.md)\n```md\n[[项目/计划]]\n```');
    expect(await service.backlinks(book.id, target.path)).toMatchObject([{ path: '入口.md' }]);
    await service.move(book.id, '项目', '归档/项目');
    const content = (await service.read(book.id, '入口.md')).content;
    expect(content).toContain('[[归档/项目/计划#标题|计划别名]]'); expect(content).toContain('](%E5%BD%92%E6%A1%A3/%E9%A1%B9%E7%9B%AE/%E8%AE%A1%E5%88%92.md)');
    expect(content).toContain('```md\n[[项目/计划]]\n```');
    expect((await service.read(book.id, '归档/项目/计划.md')).content).toContain('[[入口]]');
    await service.move(book.id, '归档/项目/计划.md', '归档/项目/新计划.md');
    expect((await service.read(book.id, '入口.md')).content).toContain('[[归档/项目/新计划#标题|计划别名]]');
    await expect(service.move(book.id, '入口.md', '归档/项目/新计划.md')).rejects.toThrow('已存在');
  });
  it('imports attachments under assets without overwriting names and rejects SVG image rendering', async () => {
    const { service, book } = await fixture(); const bytes = Buffer.from('attachment content');
    const one = await service.addAsset(book.id, '../report.txt', bytes); const two = await service.addAsset(book.id, 'report.txt', bytes);
    expect(one.path).toMatch(/^assets\//); expect(one.path).not.toBe(two.path); expect(await readFile(join(book.directory, one.path), 'utf8')).toBe('attachment content');
    const svg = await service.addAsset(book.id, 'test.svg', Buffer.from('<svg onload="alert(1)"/>')); expect(await service.image(book.id, svg.path)).toBeNull();
    await note(service, book.id, '附件链接', `[[${one.path}]]`);
    await service.move(book.id, one.path, 'report.txt');
    expect(await readFile(join(book.directory, 'report.txt'), 'utf8')).toBe('attachment content');
    expect((await service.read(book.id, '附件链接.md')).content).toBe('[[report.txt]]');
    await expect(service.createEntry(book.id, 'assets', 'bad-note', 'note')).rejects.toThrow('附件');
  });
  it('refuses folder cycles and duplicate folder names without changing either tree', async () => {
    const { service, book } = await fixture();
    await service.createEntry(book.id, '', '项目', 'folder'); await service.createEntry(book.id, '项目', '子目录', 'folder');
    const doc = await note(service, book.id, '草稿', '原始内容', '项目/子目录');
    await expect(service.move(book.id, '项目', '项目/子目录/项目')).rejects.toThrow('自身内部');
    await service.createEntry(book.id, '', '归档', 'folder'); await service.createEntry(book.id, '归档', '项目', 'folder');
    await expect(service.move(book.id, '项目', '归档/项目')).rejects.toThrow('已存在');
    expect((await service.read(book.id, doc.path)).content).toBe('原始内容');
    expect((await service.entries(book.id)).map((item) => item.path)).toContain('归档/项目');
  });
  it('exports a valid zip with Markdown, attachments and empty folders, excludes hidden/symlink files, and uses trash', async () => {
    const { service, book, directory, trash } = await fixture(); const doc = await note(service, book.id, '入口', '# 内容\n[[下一篇]]');
    await service.createEntry(book.id, '', '空目录', 'folder'); const asset = await service.addAsset(book.id, 'readme.txt', Buffer.from('attachment'));
    await writeFile(join(book.directory, '.private'), 'not exported'); await symlink(join(directory, 'config'), join(book.directory, 'alias'));
    const output = join(directory, 'export.zip'); await service.export(book.id, output); const files = unzip(await readFile(output));
    expect(files.get('学习笔记/入口.md')).toBe(doc.content); expect(files.get(`学习笔记/${asset.path}`)).toBe('attachment'); expect(files.has('学习笔记/空目录/')).toBe(true);
    expect([...files.keys()].some((name) => name.includes('private') || name.includes('alias'))).toBe(false);
    await expect(service.export(book.id, join(book.directory, 'bad.zip'))).rejects.toThrow('目录之外');
    await service.trash(book.id, doc.path); expect(trash).toHaveBeenCalledWith(join(book.directory, doc.path)); expect(await readFile(join(directory, 'trashed'), 'utf8')).toBe(doc.content);
  });
  it('refuses malformed registration rather than replacing the existing file', async () => {
    const { directory } = await fixture(); const file = join(directory, 'invalid.json'); await writeFile(file, 'bad');
    const service = new NotebookService(file, async () => {}); await expect(service.state()).rejects.toThrow('原文件已保留'); expect(await readFile(file, 'utf8')).toBe('bad');
  });
});

describe('Markdown outlines and Obsidian-style links', () => {
  it('ignores fenced code headings, supports ATX/setext, and preserves duplicate heading positions', () => {
    const content = '# 开始\n\n```md\n# code\n```\n## 测试\n内容\n测试\n---\n## 测试';
    const headings = noteHeadings(content); expect(headings.map((heading) => heading.text)).toEqual(['开始', '测试', '测试', '测试']);
    expect(new Set(headings.map((heading) => heading.id)).size).toBe(4); expect(headings.every((heading) => content.slice(heading.from).startsWith(heading.level === 1 ? '# 开始' : heading.line === 8 ? '测试' : '## 测试'))).toBe(true);
    expect(noteHeadings('# `API` 说明\n## **功能** ###').map((heading) => heading.text)).toEqual(['API 说明', '功能']);
  });
  it('resolves headings, relative Markdown, unique short names, ambiguous names, and missing notes without workspace escape', () => {
    const paths = ['a/Plan.md', 'b/Plan.md', 'Home.md', 'assets/photo.png'];
    expect(resolveNoteLink('Plan#步骤', 'Home.md', paths)).toMatchObject({ path: null, ambiguous: ['a/Plan.md', 'b/Plan.md'] });
    expect(resolveNoteLink('../Home.md#标题', 'a/Plan.md', paths, false)).toMatchObject({ path: 'Home.md', anchor: '标题' });
    expect(resolveNoteLink('assets/photo.png', 'a/Plan.md', paths)).toMatchObject({ path: 'assets/photo.png' });
    expect(resolveNoteLink('#标题', 'Home.md', paths)).toMatchObject({ path: 'Home.md' });
    expect(resolveNoteLink('新目录/新笔记', 'Home.md', paths).missing).toBe('新目录/新笔记.md');
    expect(resolveNoteLink('../../private', 'Home.md', paths).missing).toBeNull();
    expect(resolveNoteLink('file:///secret', 'Home.md', paths).path).toBeNull();
  });
  it('does not rewrite code or external links and encodes wiki targets without activating HTML', () => {
    const content = '[[A#Title|标签]] ![[assets/p.png]] `[[A]]`\n```\n[[A]]\n```\n[外链](https://example.com)';
    expect(noteLinks(content)).toHaveLength(3);
    expect(rewriteNoteLinks(content, 'Home.md', 'Home.md', ['A.md', 'assets/p.png'], (path) => path === 'A.md' ? 'B.md' : path)).toContain('[[B#Title|标签]]');
    expect(renderableNote(content)).toContain('[标签](snipvia-note:A%23Title)'); expect(renderableNote(content)).toContain('`[[A]]`');
  });
  it('validates portable filenames and opaque relative paths', () => {
    for (const name of ['../escape', '.hidden', 'a#b', 'CON', 'a:b', 'end.', 'bad\0name']) expect(noteNameSchema.safeParse(name).success).toBe(false);
    expect(noteNameSchema.safeParse('学习计划 2026').success).toBe(true);
    for (const path of ['../x.md', '/tmp/x', 'a/../../x', 'a\\b.md', 'a/.git/config']) expect(notePathSchema.safeParse(path).success).toBe(false);
  });
});
