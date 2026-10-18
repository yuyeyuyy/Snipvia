import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, link, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotebookService } from '../../src/main/notes/NotebookService';
import { NotebookWriter } from '../../src/main/agent/notes/NotebookWriter';
import { createFileToolSystem } from '../../src/main/agent/createFileToolSystem';
import { AgentLoop } from '../../src/main/agent/AgentLoop';
import type { LLMProvider } from '../../src/main/ai/llm/LLMProvider';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'snipvia-note-write-')), root = join(directory, '算法笔记');
  await mkdir(root); await mkdir(join(root, 'assets'));
  const notebooks = new NotebookService(join(directory, 'registry.json'), async () => {});
  const book = await notebooks.open(root);
  const guard = vi.fn<(id: string, signal: AbortSignal) => Promise<void>>(async () => {}), changed = vi.fn();
  const system = createFileToolSystem({ readOnly: true, prompt: async () => { throw new Error('Automatic notes must not prompt'); },
    notebookWriter: workspaces => new NotebookWriter({ workspaces, notebook: id => notebooks.authorizedNotebook(id), beforeWrite: guard, changed }) });
  const grant = await system.workspaces.authorizeWorkspace(root), writer = system.noteWriter!, scope = writer.createScope(book, grant);
  cleanups.push(async () => { writer.closeScope(scope); notebooks.dispose(); await rm(directory, { recursive: true, force: true }); });
  return { directory, root, notebooks, book, system, grant, writer, scope, guard, changed, signal: new AbortController().signal };
}
describe('选定笔记本的自动 Markdown 写入', () => {
  it('真实创建、追加、精确编辑，统计净修改；重复工具请求不重复追加', async () => {
    const f = await fixture();
    const create = { kind: 'create' as const, path: '二分查找.md', content: '# 二分查找\n\nleft = mid\n' };
    const created = await f.writer.apply(f.scope, create, f.signal);
    expect(created).toMatchObject({ operation: 'create', path: '二分查找.md', added: 3, removed: 0 });
    const append = { kind: 'append' as const, path: create.path, content: '\n## 边界\n空数组返回 -1。\n' };
    const appended = await f.writer.apply(f.scope, append, f.signal);
    expect(appended.id).toBe(created.id);
    await f.writer.apply(f.scope, append, f.signal);
    expect((await readFile(join(f.root, create.path), 'utf8')).match(/空数组/g)).toHaveLength(1);
    const edited = await f.writer.apply(f.scope, { kind: 'edit', path: create.path, edits: [{ search: 'left = mid', replace: 'left = mid + 1' }] }, f.signal);
    expect(edited.id).toBe(created.id); expect(edited.removed).toBe(0);
    expect(await f.writer.apply(f.scope, create, f.signal)).toEqual(edited);
    expect(f.writer.diff(edited.id).diff).toContain('+left = mid + 1');
    expect(f.changed).toHaveBeenCalledTimes(3);
  });
  it('已有文件不能被 create 覆盖，编辑保留其他内容及 BOM/CRLF', async () => {
    const f = await fixture(), path = join(f.root, '旧笔记.md');
    await writeFile(path, '\ufeff# 我的原文\r\n\r\nleft = mid\r\n');
    await expect(f.writer.apply(f.scope, { kind: 'create', path: '旧笔记.md', content: 'overwrite' }, f.signal)).rejects.toMatchObject({ code: 'FILE_CONFLICT' });
    const result = await f.writer.apply(f.scope, { kind: 'edit', path: '旧笔记.md', edits: [{ search: 'left = mid', replace: 'left = mid + 1' }] }, f.signal);
    expect(result).toMatchObject({ operation: 'edit', added: 1, removed: 1 });
    expect(await readFile(path, 'utf8')).toBe('\ufeff# 我的原文\r\n\r\nleft = mid + 1\r\n');
  });
  it.each(['../outside.md', '/tmp/outside.md', 'assets/附件.md', 'Assets/附件.md', '.secret/笔记.md', 'config.json'])('拒绝路径 %s', async path => {
    const f = await fixture();
    await expect(f.writer.apply(f.scope, { kind: 'create', path, content: 'blocked' }, f.signal)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(f.changed).not.toHaveBeenCalled();
  });
  it('拒绝伪造、结束、撤销和失去登记的能力', async () => {
    const f = await fixture(), intent = { kind: 'create' as const, path: '笔记.md', content: '# 笔记' };
    await expect(f.writer.apply({}, intent, f.signal)).rejects.toMatchObject({ code: 'WORKSPACE_REQUIRED' });
    f.writer.closeScope(f.scope);
    await expect(f.writer.apply(f.scope, intent, f.signal)).rejects.toMatchObject({ code: 'WORKSPACE_REQUIRED' });
    const other = f.writer.createScope(f.book, f.grant);
    f.system.workspaces.revoke(f.grant);
    await expect(f.writer.apply(other, intent, f.signal)).rejects.toThrow();
    const grant = await f.system.workspaces.authorizeWorkspace(f.root), scope = f.writer.createScope(f.book, grant);
    await f.notebooks.unlink(f.book.id);
    await expect(f.writer.apply(scope, intent, f.signal)).rejects.toMatchObject({ code: 'WORKSPACE_CHANGED' });
  });
  it('符号链接和硬链接不能把写入带到笔记本以外', async () => {
    const f = await fixture(), outside = join(f.directory, 'outside.md'); await writeFile(outside, 'private');
    await symlink(outside, join(f.root, '链接.md')); await link(outside, join(f.root, '硬链接.md'));
    for (const path of ['链接.md', '硬链接.md']) await expect(f.writer.apply(f.scope, { kind: 'append', path, content: 'bad' }, f.signal)).rejects.toThrow();
    expect(await readFile(outside, 'utf8')).toBe('private');
  });
  it('提交前文件被外部编辑时保留外部内容，临时文件得到清理', async () => {
    const f = await fixture(); await writeFile(join(f.root, '冲突.md'), '# 原文\n');
    const original = f.system.workspaces.commitSnapshot.bind(f.system.workspaces);
    vi.spyOn(f.system.workspaces, 'commitSnapshot').mockImplementationOnce(async (...args) => {
      await writeFile(join(f.root, '冲突.md'), '# 用户新输入\n'); return original(...args);
    });
    await expect(f.writer.apply(f.scope, { kind: 'edit', path: '冲突.md', edits: [{ search: '原文', replace: 'AI' }] }, f.signal)).rejects.toMatchObject({ code: 'FILE_CONFLICT' });
    expect(await readFile(join(f.root, '冲突.md'), 'utf8')).toBe('# 用户新输入\n');
    expect((await readdir(f.root)).some(path => path.startsWith('.snipvia'))).toBe(false); expect(f.changed).not.toHaveBeenCalled();
  });
  it('取消或保存检查失败时不写；原子提交完成后如实保留成功结果', async () => {
    const f = await fixture(), controller = new AbortController(), input = { kind: 'create' as const, path: '笔记.md', content: '# 笔记\n' };
    controller.abort();
    await expect(f.writer.apply(f.scope, input, controller.signal)).rejects.toMatchObject({ code: 'ABORTED' });
    f.guard.mockRejectedValueOnce(new Error('editor conflict'));
    await expect(f.writer.apply(f.scope, input, f.signal)).rejects.toThrow('editor conflict');
    expect(await readdir(f.root)).toEqual(['assets']);
    const late = new AbortController(), original = f.system.workspaces.commitSnapshot.bind(f.system.workspaces);
    vi.spyOn(f.system.workspaces, 'commitSnapshot').mockImplementationOnce(async (...args) => { const result = await original(...args); late.abort(); return result; });
    expect(await f.writer.apply(f.scope, input, late.signal)).toMatchObject({ operation: 'create' });
    expect(await readFile(join(f.root, '笔记.md'), 'utf8')).toBe(input.content);
  });
  it('开放笔记专用工具，通用写入和伪造 notebookId 仍被拒绝', async () => {
    const f = await fixture();
    expect(f.system.registry.descriptors().map(tool => tool.name)).toContain('write_note');
    expect(f.system.registry.descriptors().map(tool => tool.name)).not.toContain('write_file');
    const execute = (name: string, input: unknown, noteScope?: object) => f.system.executor.execute({ id: Math.random().toString(), name, input }, { workspace: f.grant, noteScope });
    expect(await execute('write_file', { path: '笔记.md', content: 'blocked' }, f.scope)).toMatchObject({ success: false, error: { code: 'PERMISSION_DENIED' } });
    expect(await execute('write_note', { path: '笔记.md', mode: 'create', content: '# 笔记' })).toMatchObject({ success: false, error: { code: 'WORKSPACE_REQUIRED' } });
    expect(await execute('write_note', { path: '笔记.md', mode: 'create', content: '# 笔记', notebookId: f.book.id }, f.scope)).toMatchObject({ success: false, error: { code: 'INVALID_INPUT' } });
    expect(await execute('write_note', { path: '笔记.md', mode: 'create', content: '# 笔记' }, f.scope)).toMatchObject({ success: true });
  });
  it('写入未完成时不进入最终回复，写入工具只在有笔记能力时提供', async () => {
    const f = await fixture(); let calls = 0;
    let entered!: () => void, release!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; }), arrived = new Promise<void>(resolve => { entered = resolve; });
    f.guard.mockImplementationOnce(async () => { entered(); await waiting; });
    const provider: LLMProvider = { id: 'mock', chat: vi.fn<LLMProvider['chat']>(async input => {
      expect(input.tools.map(tool => tool.name)).toContain('write_note');
      if (++calls === 1) return { content: '', finishReason: 'tool_calls', toolCalls: [{ id: 'create', name: 'write_note', arguments: JSON.stringify({ path: '二分.md', mode: 'create', content: '# 二分\n' }) }] };
      expect(await readFile(join(f.root, '二分.md'), 'utf8')).toBe('# 二分\n');
      return { content: '知识点已经保存。', finishReason: 'stop' };
    }) };
    const loop = new AgentLoop({ provider, registry: f.system.registry, executor: f.system.executor });
    const pending = loop.run({ message: '分析并记录', workspace: f.grant, noteScope: f.scope });
    await arrived; expect(calls).toBe(1); expect(await readdir(f.root)).toEqual(['assets']);
    release(); expect(await pending).toMatchObject({ status: 'completed', finalAnswer: '知识点已经保存。' });
    const plain: LLMProvider = { id: 'plain', chat: async input => { expect(input.tools.map(tool => tool.name)).not.toContain('write_note'); return { content: '普通回复', finishReason: 'stop' }; } };
    await new AgentLoop({ provider: plain, registry: f.system.registry, executor: f.system.executor }).run({ message: '普通聊天', workspace: f.grant });
  });
});
