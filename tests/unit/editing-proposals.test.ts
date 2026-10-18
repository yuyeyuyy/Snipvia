import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { NotebookService } from '../../src/main/notes/NotebookService';
import { WorkspaceService } from '../../src/main/agent/WorkspaceService';
import { EditingProposals, editingDigest } from '../../src/main/agent/editing/EditingProposals';
import { branchContent, branchDiff, proposeBranches } from '../../src/main/agent/editing/branches';
import { branchOperationsSchema, noteProposalInputSchema } from '../../src/shared/agent/editing';
import { defaultPredictionBranches, type PredictionBranch } from '../../src/shared/screenshot-understanding';
import { NotebookWriter } from '../../src/main/agent/notes/NotebookWriter';
import type { FileChangePreview } from '../../src/shared/agent-file-change';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { vi.useRealTimers(); for (const cleanup of cleanups.splice(0)) await cleanup(); });
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'snipvia-editing-')); const root = join(directory, '算法'); await mkdir(root);
  const books = new NotebookService(join(directory, 'books.json'), async () => {}); const book = await books.open(root);
  await writeFile(join(root, '二分.md'), '\ufeff# 二分\r\nleft = mid\r\n');
  let branches = structuredClone(defaultPredictionBranches); let busy = false; let profile = { provider: 'custom' as const, endpoint: 'http://localhost:11434/v1', model: 'test' };
  const workspaces = new WorkspaceService(); const applied = vi.fn(async () => {}); const beforeWrite = vi.fn(async () => {});
  const save = vi.fn((expected: string, after: PredictionBranch[]) => { if (expected !== editingDigest(branches)) throw new Error('conflict'); branches = structuredClone(after); });
  const service = new EditingProposals({ workspaces, book: id => books.authorizedNotebook(id), books: async () => [{ id: book.id, name: book.name }], profile: () => profile,
    branches: () => branches, saveBranches: save, exists: () => {}, busy: () => busy, beforeWrite, notify: () => {}, applied });
  const id = randomUUID(), signal = new AbortController().signal;
  cleanups.push(async () => { busy = false; service.clear(); books.dispose(); await rm(directory, { recursive: true, force: true }); });
  return { service, directory, root, books, book, workspaces, id, signal, save, beforeWrite, applied, branches: () => branches, changeBranches: (value: PredictionBranch[]) => { branches = value; }, busy: (value: boolean) => { busy = value; }, model: () => { profile = { ...profile, model: 'changed' }; } };
}
async function noteScope(f: Awaited<ReturnType<typeof fixture>>, create = false) {
  await f.service.select(1, f.id, { kind: 'note', notebookId: f.book.id, path: create ? null : '二分.md' });
  const scope = f.service.begin(1, f.id)!.scope; await f.service.execute(scope, { kind: 'read' }, f.signal); return scope;
}
async function candidate(f: Awaited<ReturnType<typeof fixture>>, create = false) {
  const scope = await noteScope(f, create);
  await f.service.execute(scope, { kind: 'note', change: create ? { mode: 'create', path: '栈.md', content: '# 栈\n' } : { mode: 'edit', path: '二分.md', edits: [{ search: 'left = mid', replace: 'left = mid + 1' }] } }, f.signal);
  return { scope, summary: f.service.finish(scope, true).at(-1)! };
}

describe('用户确认的编辑提案', () => {
  it('生成、查看和取消均不写入；确认只写入所预览内容，保留 BOM/CRLF，重复确认幂等', async () => {
    const f = await fixture(); const original = await readFile(join(f.root, '二分.md'));
    const first = await candidate(f); expect(await readFile(join(f.root, '二分.md'))).toEqual(original);
    await expect(f.service.apply(1, f.id, first.summary.id, first.summary.digest)).rejects.toThrow('先查看');
    const preview = f.service.preview(1, f.id, first.summary.id); expect(preview.diff).toContain('+left = mid + 1'); expect(await readFile(join(f.root, '二分.md'))).toEqual(original);
    await expect(f.service.apply(1, f.id, first.summary.id, 'a'.repeat(64))).rejects.toThrow('先查看');
    f.service.cancel(1, f.id, first.summary.id); await expect(f.service.apply(1, f.id, first.summary.id, first.summary.digest)).rejects.toThrow();
    expect(await readFile(join(f.root, '二分.md'))).toEqual(original);
    const next = await candidate(f); f.service.preview(1, f.id, next.summary.id);
    expect((await f.service.apply(1, f.id, next.summary.id, next.summary.digest)).status).toBe('applied');
    expect(await readFile(join(f.root, '二分.md'), 'utf8')).toBe('\ufeff# 二分\r\nleft = mid + 1\r\n');
    await f.service.apply(1, f.id, next.summary.id, next.summary.digest); expect(f.applied).toHaveBeenCalledTimes(1);
  });
  it('新建笔记不能覆盖已有文件；保存后上下文指向实际新笔记', async () => {
    const f = await fixture(); const { summary } = await candidate(f, true);
    expect(await readFile(join(f.root, '二分.md'), 'utf8')).toContain('left = mid');
    f.service.preview(1, f.id, summary.id); await f.service.apply(1, f.id, summary.id, summary.digest);
    expect(await readFile(join(f.root, '栈.md'), 'utf8')).toBe('# 栈\n');
    expect(f.service.state(1, f.id).context?.request).toMatchObject({ kind: 'note', path: '栈.md' });
    await f.service.select(1, f.id, { kind: 'note', notebookId: f.book.id, path: null }); const scope = f.service.begin(1, f.id)!.scope;
    await f.service.execute(scope, { kind: 'read' }, f.signal);
    await expect(f.service.execute(scope, { kind: 'note', change: { mode: 'create', path: '栈.md', content: 'overwrite' } }, f.signal)).rejects.toMatchObject({ code: 'FILE_CONFLICT' });
  });
  it('阻止越权目标、伪造能力、未读取上下文、别的窗口和别的会话', async () => {
    const f = await fixture(); const scope = await noteScope(f);
    await expect(f.service.execute({}, { kind: 'read' }, f.signal)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(f.service.execute(scope, { kind: 'note', change: { mode: 'replace', path: '其他.md', content: 'oops' } }, f.signal)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    const value = f.service.begin(1, f.id)!;
    await expect(f.service.execute(value.scope, { kind: 'note', change: { mode: 'replace', path: '二分.md', content: 'oops' } }, f.signal)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    const { summary } = await candidate(f);
    expect(() => f.service.preview(2, f.id, summary.id)).toThrow('当前窗口');
    expect(() => f.service.preview(1, randomUUID(), summary.id)).toThrow();
    await expect(f.service.select(2, f.id, null)).rejects.toThrow('授权');
  });
  it.each(['changed', 'moved', 'unlinked', 'model'] as const)('应用前 %s，原有内容保持原状', async type => {
    const f = await fixture(); const { summary } = await candidate(f); f.service.preview(1, f.id, summary.id);
    if (type === 'changed') await writeFile(join(f.root, '二分.md'), '用户新内容');
    if (type === 'moved') await rename(join(f.root, '二分.md'), join(f.root, '移动.md'));
    if (type === 'unlinked') await f.books.unlink(f.book.id);
    if (type === 'model') f.model();
    await expect(f.service.apply(1, f.id, summary.id, summary.digest)).rejects.toThrow();
    const path = type === 'moved' ? '移动.md' : '二分.md';
    expect(await readFile(join(f.root, path), 'utf8')).toBe(type === 'changed' ? '用户新内容' : '\ufeff# 二分\r\nleft = mid\r\n'); expect(f.applied).not.toHaveBeenCalled();
  });
  it('停止、再生成、清除上下文和过期会撤销未提交提案', async () => {
    const f = await fixture(); const first = await candidate(f); f.service.begin(1, f.id); expect(f.service.state(1, f.id).proposals[0].status).toBe('expired');
    const scope = f.service.begin(1, f.id)!.scope; await f.service.execute(scope, { kind: 'read' }, f.signal);
    await f.service.execute(scope, { kind: 'note', change: { mode: 'append', path: '二分.md', content: '部分建议' } }, f.signal);
    expect(f.service.finish(scope, false).at(-1)?.status).toBe('expired');
    const next = await candidate(f); vi.useFakeTimers(); vi.setSystemTime(Date.now() + 11 * 60_000);
    expect(() => f.service.preview(1, f.id, next.summary.id)).toThrow('失效');
    await f.service.select(1, f.id, null); expect(f.service.state(1, f.id).context).toBeNull();
    expect(await readFile(join(f.root, '二分.md'), 'utf8')).toContain('left = mid\r\n'); expect(first.summary.status).toBe('pending');
  });
  it('全文改写必须完整读取分块上下文，普通局部修改保留其余原文', async () => {
    const f = await fixture(); await writeFile(join(f.root, '二分.md'), '内容'.repeat(3000));
    const scope = await noteScope(f);
    await expect(f.service.execute(scope, { kind: 'note', change: { mode: 'replace', path: '二分.md', content: '总结' } }, f.signal)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    let offset: number | null = 1500;
    while (offset !== null) { const chunk = await f.service.execute(scope, { kind: 'read', offset }, f.signal) as { nextOffset: number | null }; offset = chunk.nextOffset; }
    expect(await f.service.execute(scope, { kind: 'note', change: { mode: 'replace', path: '二分.md', content: '总结' } }, f.signal)).toMatchObject({ saved: false });
    expect(await readFile(join(f.root, '二分.md'), 'utf8')).toBe('内容'.repeat(3000));
  });
  it('保存失败、编辑器刷新失败和重复点击不会更改文件；附属记录失败如实报告已提交', async () => {
    const f = await fixture(); const { summary } = await candidate(f); f.service.preview(1, f.id, summary.id);
    const spy = vi.spyOn(f.workspaces, 'commitSnapshot').mockRejectedValueOnce(new Error('WRITE_FAILED'));
    await expect(f.service.apply(1, f.id, summary.id, summary.digest)).rejects.toThrow('WRITE_FAILED'); expect(await readFile(join(f.root, '二分.md'), 'utf8')).toContain('left = mid\r\n'); spy.mockRestore();
    f.beforeWrite.mockRejectedValueOnce(new Error('编辑器刷新失败'));
    await expect(f.service.apply(1, f.id, summary.id, summary.digest)).rejects.toThrow('编辑器刷新失败');
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); f.beforeWrite.mockImplementationOnce(() => gate);
    f.applied.mockRejectedValueOnce(new Error('history failed'));
    const first = f.service.apply(1, f.id, summary.id, summary.digest);
    await expect(f.service.apply(1, f.id, summary.id, summary.digest)).rejects.toThrow('等待'); release();
    expect(await first).toMatchObject({ status: 'applied', message: expect.stringContaining('记录保存失败') });
    expect(await readFile(join(f.root, '二分.md'), 'utf8')).toContain('left = mid + 1');
  });
  it('分支候选验证整个现有 Schema；预览前零写入，手工改动与绑定失效会冲突', async () => {
    const f = await fixture(); const selected = f.branches().map(branch => branch.id);
    await f.service.select(1, f.id, { kind: 'branches', branchIds: selected }); const scope = f.service.begin(1, f.id)!.scope;
    await f.service.execute(scope, { kind: 'read' }, f.signal);
    await f.service.execute(scope, { kind: 'branches', operations: [{ op: 'update', id: 'explain-code', patch: { label: '整理代码', notebookId: f.book.id } }, { op: 'create', branch: { label: '算法练习', runningLabel: '正在分析…', trigger: 'question', prompt: '解释算法', enabled: true } }] }, f.signal);
    const summary = f.service.finish(scope, true)[0]; expect(f.save).not.toHaveBeenCalled(); f.service.preview(1, f.id, summary.id);
    f.changeBranches(f.branches().map(branch => ({ ...branch, enabled: false })));
    await expect(f.service.apply(1, f.id, summary.id, summary.digest)).rejects.toMatchObject({ code: 'FILE_CONFLICT' }); expect(f.save).not.toHaveBeenCalled();
    await f.service.select(1, f.id, { kind: 'branches', branchIds: selected }); const next = f.service.begin(1, f.id)!.scope; await f.service.execute(next, { kind: 'read' }, f.signal);
    await f.service.execute(next, { kind: 'branches', operations: [{ op: 'update', id: 'explain-code', patch: { label: '新代码规则' } }] }, f.signal);
    const value = f.service.finish(next, true)[0]; f.service.preview(1, f.id, value.id); await f.service.apply(1, f.id, value.id, value.digest);
    expect(f.branches().find(branch => branch.id === 'explain-code')?.label).toBe('新代码规则');
  });
  it('分支保存失败或目标笔记本取消链接时，原有规则保持不变', async () => {
    const f = await fixture(); const original = structuredClone(f.branches());
    await f.service.select(1, f.id, { kind: 'branches', branchIds: ['explain-code'] }); const scope = f.service.begin(1, f.id)!.scope;
    await f.service.execute(scope, { kind: 'read' }, f.signal);
    await f.service.execute(scope, { kind: 'branches', operations: [{ op: 'update', id: 'explain-code', patch: { notebookId: f.book.id } }] }, f.signal);
    const summary = f.service.finish(scope, true)[0]; f.service.preview(1, f.id, summary.id);
    f.save.mockImplementationOnce(() => { throw new Error('disk failed'); });
    await expect(f.service.apply(1, f.id, summary.id, summary.digest)).rejects.toThrow('disk failed');
    expect(f.branches()).toEqual(original);
    await f.books.unlink(f.book.id);
    await expect(f.service.apply(1, f.id, summary.id, summary.digest)).rejects.toMatchObject({ code: 'WORKSPACE_CHANGED' });
    expect(f.branches()).toEqual(original); expect(f.save).toHaveBeenCalledTimes(1);
  });
});

describe('平面分支校验', () => {
  it('拒绝非法引用、未知关系字段、内置删除、重复顺序和超量；部分排序保留未授权规则', () => {
    const before = structuredClone(defaultPredictionBranches), selected = ['explain-error', 'explain-code'];
    expect(() => proposeBranches(before, selected, [{ op: 'update', id: 'answer-question', patch: { enabled: false } }])).toThrow('未授权');
    expect(() => proposeBranches(before, selected, [{ op: 'remove', id: 'explain-code' }])).toThrow('内置');
    expect(branchOperationsSchema.safeParse([{ op: 'update', id: 'explain-code', patch: { parentId: 'explain-error', mode: 'schedule' } }]).success).toBe(false);
    expect(() => proposeBranches(before, selected, [{ op: 'reorder', ids: ['explain-code', 'explain-code'] }])).toThrow('重复');
    const after = proposeBranches(before, selected, [{ op: 'reorder', ids: ['explain-code', 'explain-error'] }]);
    expect(after.map(branch => branch.id)).toEqual(['explain-code', 'explain-error', 'answer-question', 'create-schedule']); expect(before).toEqual(defaultPredictionBranches);
    const create = { op: 'create' as const, branch: { label: '规则', runningLabel: '运行', trigger: 'code' as const, prompt: '说明代码', enabled: true } };
    expect(() => proposeBranches(before, selected, Array(30).fill(create))).toThrow();
    expect(noteProposalInputSchema.safeParse({ mode: 'replace', path: 'assets/private.md', content: 'x' }).success).toBe(false);
  });
  it('字段顺序不产生伪修改，分支差异保留未修改规则', () => {
    const before = structuredClone(defaultPredictionBranches);
    expect(() => proposeBranches(before, ['explain-code'], [{ op: 'update', id: 'explain-code', patch: { label: '解释代码' } }])).toThrow('没有变化');
    const after = proposeBranches(before, ['explain-code'], [{ op: 'update', id: 'explain-code', patch: { label: '算法解释' } }]);
    expect(branchContent(after).replace('算法解释', '解释代码')).toBe(branchContent(before));
    expect(branchDiff(before, after)).toContain('+  "label": "算法解释"');
    expect(branchDiff(before, after)).not.toContain('answer-question');
    const withNew = proposeBranches(after, [], [{ op: 'create', branch: { label: '新规则', runningLabel: '运行', trigger: 'code', prompt: '分析', enabled: true } }]);
    const diff = branchDiff(before, withNew);
    expect(diff).toContain('--- /dev/null'); expect(diff).toContain('截图预测规则/顺序');
    expect(diff).not.toContain('-  "id": "answer-question"');
  });
});

describe('旧截图笔记写入也必须确认', () => {
  it('默认没有审批时拒绝；等待审批时不落盘，确认期间文件变化会拒绝覆盖', async () => {
    const f = await fixture(); const grant = await f.workspaces.authorizeWorkspace(f.root);
    const noApproval = new NotebookWriter({ workspaces: f.workspaces, notebook: id => f.books.authorizedNotebook(id), beforeWrite: async () => {}, changed: () => {} });
    await expect(noApproval.apply(noApproval.createScope(f.book, grant), { kind: 'append', path: '二分.md', content: '自动覆盖' }, f.signal)).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' });
    let approve!: () => void; let preview: FileChangePreview | undefined; const gate = new Promise<void>(resolve => { approve = resolve; });
    const writer = new NotebookWriter({ workspaces: f.workspaces, notebook: id => f.books.authorizedNotebook(id), beforeWrite: async () => {}, changed: () => {}, review: async value => { preview = value; await gate; } });
    const pending = writer.apply(writer.createScope(f.book, grant), { kind: 'append', path: '二分.md', content: '需要确认的内容' }, f.signal);
    await vi.waitFor(() => expect(preview?.diff).toContain('需要确认的内容'));
    expect(await readFile(join(f.root, '二分.md'), 'utf8')).not.toContain('需要确认');
    await writeFile(join(f.root, '二分.md'), '人工编辑'); approve(); await expect(pending).rejects.toMatchObject({ code: 'FILE_CONFLICT' });
    expect(await readFile(join(f.root, '二分.md'), 'utf8')).toBe('人工编辑');
  });
});
