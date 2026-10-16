import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotebookService } from '../../src/main/notes/NotebookService';
import { NotebookWriter } from '../../src/main/agent/notes/NotebookWriter';
import { NoteCheckpointStore, undoCheckpoint, undoState, checkpointDiff } from '../../src/main/agent/notes/NoteCheckpoints';
import { createFileToolSystem } from '../../src/main/agent/createFileToolSystem';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'snipvia-checkpoint-')), root = join(directory, '算法笔记');
  await mkdir(root); await writeFile(join(root, '基础.md'), '# 基础\n原有内容\n');
  const notebooks = new NotebookService(join(directory, 'registry.json'), async () => {});
  const book = await notebooks.open(root);
  const changed = vi.fn(), flush = vi.fn(async () => {});
  const system = createFileToolSystem({ readOnly: true, notebookWriter: workspaces => new NotebookWriter({ workspaces, notebook: id => notebooks.authorizedNotebook(id), beforeWrite: async () => {}, review: async () => {}, changed }) });
  const grant = await system.workspaces.authorizeWorkspace(root), writer = system.noteWriter!;
  const store = new NoteCheckpointStore(join(directory, 'checkpoints'));
  const conversationId = randomUUID(), signal = new AbortController().signal;
  const deps = { workspaces: system.workspaces, notebook: (id: string) => notebooks.authorizedNotebook(id), flush, changed };
  /** One Agent run: apply edits through a scope, then persist its checkpoint like AgentExecutionService. */
  const run = async (work: (scope: object) => Promise<unknown>) => {
    const scope = writer.createScope(book, grant), id = randomUUID();
    await work(scope);
    await store.save({ id, conversationId, notebookId: book.id, notebookDirectory: book.directory, files: writer.checkpointFiles(scope) });
    writer.closeScope(scope);
    return (await store.findByChange(writer.checkpointFiles(scope)[0].summary.id))!;
  };
  cleanups.push(async () => { notebooks.dispose(); await rm(directory, { recursive: true, force: true }); });
  return { directory, root, store, writer, run, deps, flush, changed, signal, conversationId, grant, book };
}

describe('笔记检查点与撤销', () => {
  it('撤销一轮的新建与编辑：新建的笔记删除，编辑的笔记恢复原文', async () => {
    const f = await fixture();
    const checkpoint = await f.run(async (scope) => {
      await f.writer.apply(scope, { kind: 'create', path: '二分查找.md', content: '# 二分查找\n' }, f.signal);
      await f.writer.apply(scope, { kind: 'edit', path: '基础.md', edits: [{ search: '原有内容', replace: 'AI 改写' }] }, f.signal);
    });
    expect(undoState(checkpoint)).toEqual({ available: true, reverted: false });
    expect(checkpointDiff(checkpoint, checkpoint.files[1].summary.id)?.diff).toContain('+AI 改写');
    expect(await undoCheckpoint(checkpoint, f.deps, f.signal)).toEqual({ restored: 2 });
    expect(await readdir(f.root)).not.toContain('二分查找.md');
    expect(await readFile(join(f.root, '基础.md'), 'utf8')).toBe('# 基础\n原有内容\n');
    expect(f.flush).toHaveBeenCalledOnce(); expect(f.changed).toHaveBeenCalled();
    await f.store.markReverted(checkpoint.id);
    const reverted = (await f.store.findByChange(checkpoint.files[0].summary.id))!;
    expect(undoState(reverted)).toEqual({ available: false, reverted: true });
    await expect(undoCheckpoint(reverted, f.deps, f.signal)).rejects.toMatchObject({ code: 'NO_CHANGES' });
  });

  it('之后被手动修改的笔记不会被覆盖，整轮都不撤销', async () => {
    const f = await fixture();
    const checkpoint = await f.run(async (scope) => {
      await f.writer.apply(scope, { kind: 'create', path: '新建.md', content: '# 新建\n' }, f.signal);
      await f.writer.apply(scope, { kind: 'edit', path: '基础.md', edits: [{ search: '原有内容', replace: 'AI 改写' }] }, f.signal);
    });
    await writeFile(join(f.root, '基础.md'), '# 基础\nAI 改写\n我自己的补充\n');
    await expect(undoCheckpoint(checkpoint, f.deps, f.signal)).rejects.toMatchObject({ code: 'FILE_CONFLICT' });
    expect(await readdir(f.root)).toContain('新建.md'); // Verified before touching any file.
    expect(await readFile(join(f.root, '基础.md'), 'utf8')).toContain('我自己的补充');
  });

  it('按顺序撤销多轮：先撤销较晚的一轮，再撤销较早的一轮', async () => {
    const f = await fixture();
    const first = await f.run(scope => f.writer.apply(scope, { kind: 'edit', path: '基础.md', edits: [{ search: '原有内容', replace: '第一轮' }] }, f.signal));
    const second = await f.run(scope => f.writer.apply(scope, { kind: 'edit', path: '基础.md', edits: [{ search: '第一轮', replace: '第二轮' }] }, f.signal));
    await expect(undoCheckpoint(first, f.deps, f.signal)).rejects.toMatchObject({ code: 'FILE_CONFLICT' });
    await undoCheckpoint(second, f.deps, f.signal);
    expect(await readFile(join(f.root, '基础.md'), 'utf8')).toContain('第一轮');
    await undoCheckpoint(first, f.deps, f.signal);
    expect(await readFile(join(f.root, '基础.md'), 'utf8')).toBe('# 基础\n原有内容\n');
  });

  it('命令移动的笔记移回原处；过大或无法读取的内容不能自动撤销', async () => {
    const f = await fixture();
    await mkdir(join(f.root, '算法'));
    const moved = await f.run(async (scope) => {
      await writeFile(join(f.root, '算法/基础.md'), '# 基础\n原有内容\n'); await rm(join(f.root, '基础.md'));
      f.writer.recordCommandChange(scope, { path: '基础.md', content: '# 基础\n原有内容\n', version: 'a' }, { path: '算法/基础.md', content: '# 基础\n原有内容\n', version: 'b' });
    });
    expect(moved.files[0].summary).toMatchObject({ operation: 'move', previousPath: '基础.md' });
    await undoCheckpoint(moved, f.deps, f.signal);
    expect(await readdir(f.root)).toContain('基础.md'); expect(await readdir(join(f.root, '算法'))).not.toContain('基础.md');
    const large = await f.run(async (scope) => {
      f.writer.recordCommandChange(scope, { path: '大文件.md', content: null, version: 'a', truncated: true }, undefined);
    });
    expect(undoState(large)).toMatchObject({ available: false, reverted: false });
    await expect(undoCheckpoint(large, f.deps, f.signal)).rejects.toMatchObject({ code: 'UNDO_UNAVAILABLE' });
  });

  it('删除对话时一并删除检查点；损坏的检查点文件被忽略', async () => {
    const f = await fixture();
    const checkpoint = await f.run(scope => f.writer.apply(scope, { kind: 'create', path: '临时.md', content: '# 临时\n' }, f.signal));
    await writeFile(join(f.directory, 'checkpoints', `${randomUUID()}.json`), '{broken');
    await f.store.deleteConversation(f.conversationId);
    expect(await f.store.findByChange(checkpoint.files[0].summary.id)).toBeUndefined();
  });
});
