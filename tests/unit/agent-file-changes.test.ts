import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFileToolSystem } from '../../src/main/agent/createFileToolSystem';
import { FileChangeService } from '../../src/main/agent/FileChangeService';
import { PermissionManager, type FileApprovalPrompt, type ApprovalReceipt } from '../../src/main/agent/PermissionManager';
import { ToolExecutor } from '../../src/main/agent/ToolExecutor';
import { applySearchReplace, createFileDiff } from '../../src/main/agent/fileChanges/textPatch';
import type { FileApprovalRequest } from '../../src/shared/agent-file-change';
import type { WorkspaceGrant } from '../../src/main/agent/WorkspaceService';
import type { ToolResult } from '../../src/main/agent/types/tool';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, rename: vi.fn(actual.rename), link: vi.fn(actual.link), open: vi.fn(actual.open) };
});
const actualFs = await vi.importActual<typeof fs>('node:fs/promises');
let root: string;
let tools: ReturnType<typeof createFileToolSystem>;
let grant: WorkspaceGrant;
let approvals: FileApprovalRequest[];
let prompt: FileApprovalPrompt;
let callId = 0;

beforeEach(async () => {
  vi.mocked(fs.rename).mockImplementation(actualFs.rename);
  vi.mocked(fs.link).mockImplementation(actualFs.link);
  vi.mocked(fs.open).mockImplementation(actualFs.open);
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'snipvia-file-change-'));
  await fs.writeFile(path.join(root, 'code.ts'), 'const first = 1;\nconst second = 2;\n');
  approvals = [];
  prompt = async (request) => { approvals.push(request); return 'approve'; };
  tools = createFileToolSystem((request, signal) => prompt(request, signal));
  grant = await tools.workspaces.authorizeWorkspace(root);
});

afterEach(async () => {
  tools.executor.cancelAll();
  vi.useRealTimers();
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});

function write(content = 'replacement\n', filePath = 'code.ts', signal?: AbortSignal) {
  return tools.executor.execute({ id: `write_${++callId}`, name: 'write_file', input: { path: filePath, content } }, { workspace: grant, signal });
}
function edit(edits = [{ search: 'first = 1', replace: 'first = 3' }], filePath = 'code.ts') {
  return tools.executor.execute({ id: `edit_${++callId}`, name: 'edit_file', input: { path: filePath, edits } }, { workspace: grant });
}
const read = (file = 'code.ts') => fs.readFile(path.join(root, file), 'utf8');
function undoId(result: ToolResult): string {
  expect(result.success).toBe(true);
  return (result.output as { undoId: string }).undoId;
}

describe('file change preview and approval', () => {
  it('does not touch the target or create a temp file before approval; previews the actual content', async () => {
    prompt = async (request) => {
      approvals.push(request);
      expect(await read()).toBe('const first = 1;\nconst second = 2;\n');
      expect(await fs.readdir(root)).toEqual(['code.ts']);
      expect(request.preview).toMatchObject({ path: 'code.ts', operation: 'replace', before: await read(), after: 'replacement\n' });
      expect(request.preview.diff).toContain('-const first = 1;');
      expect(request.preview.diff).toContain('+replacement');
      return 'approve';
    };
    expect(await write()).toMatchObject({ success: true });
    expect(await read()).toBe('replacement\n');
    expect(await fs.readdir(root)).toEqual(['code.ts']);
    expect(approvals).toHaveLength(1);
  });

  it('rejects without approval plumbing and on explicit rejection', async () => {
    const noPrompt = createFileToolSystem();
    const otherGrant = await noPrompt.workspaces.authorizeWorkspace(root);
    expect(await noPrompt.executor.execute({ id: 'no_ui', name: 'write_file', input: { path: 'code.ts', content: 'bad' } },
      { workspace: otherGrant })).toMatchObject({ error: { code: 'APPROVAL_REQUIRED' } });
    prompt = async () => 'reject';
    expect(await write()).toMatchObject({ error: { code: 'APPROVAL_DENIED' } });
    expect(await read()).toContain('first = 1');
  });

  it('creates a new file only after confirmation and marks the creation in diff', async () => {
    expect(await write('你好\n', 'new.txt')).toMatchObject({ success: true, output: { operation: 'create', beforeHash: null } });
    expect(approvals[0].preview).toMatchObject({ before: null, after: '你好\n' });
    expect(approvals[0].preview.diff).toContain('--- /dev/null');
    expect(await read('new.txt')).toBe('你好\n');
  });

  it('refuses missing parents, unsafe paths and symlink targets without prompting', async () => {
    await fs.symlink(path.join(root, 'code.ts'), path.join(root, 'link.ts'));
    expect(await write('x', '../escape.ts')).toMatchObject({ error: { code: 'PATH_OUTSIDE_WORKSPACE' } });
    expect(await write('x', 'missing/new.ts')).toMatchObject({ error: { code: 'NOT_FOUND' } });
    expect(await write('x', 'link.ts')).toMatchObject({ error: { code: 'SYMLINK_NOT_ALLOWED' } });
    expect(approvals).toHaveLength(0);
  });

  it('applies multiple exact edits as one approved transaction', async () => {
    expect(await edit([{ search: 'first = 1', replace: 'first = 3' }, { search: 'second = 2', replace: 'second = 4' }])).toMatchObject({ success: true });
    expect(await read()).toBe('const first = 3;\nconst second = 4;\n');
    expect(approvals).toHaveLength(1);
  });

  it.each([
    [[{ search: 'missing', replace: 'x' }], 'NO_MATCH'],
    [[{ search: 'const', replace: 'let' }], 'AMBIGUOUS_MATCH'],
    [[{ search: '', replace: 'x' }], 'INVALID_INPUT'],
    [[{ search: 'first = 1', replace: 'first = 1' }], 'NO_CHANGES'],
    [[{ search: 'first = 1', replace: 'first = 3' }, { search: 'missing', replace: 'x' }], 'NO_MATCH']
  ])('does not partially write failed SEARCH/REPLACE: %s', async (edits, code) => {
    expect(await edit(edits as Array<{ search: string; replace: string }>)).toMatchObject({ error: { code } });
    expect(await read()).toContain('first = 1');
    expect(approvals).toHaveLength(0);
  });

  it('detects overlapping matches and represents missing final newline in the diff', () => {
    expect(() => applySearchReplace('aaa', [{ search: 'aa', replace: 'b' }])).toThrow(expect.objectContaining({ code: 'AMBIGUOUS_MATCH' }));
    expect(createFileDiff('x', 'old', 'new')).toBe('--- a/x\n+++ b/x\n@@ -1,1 +1,1 @@\n-old\n\\ No newline at end of file\n+new\n\\ No newline at end of file');
  });

  it('preserves CRLF, UTF-8 BOM and file mode while accepting LF patch input', async () => {
    await fs.writeFile(path.join(root, 'code.ts'), '\ufeff第一行\r\n第二行\r\n');
    await fs.chmod(path.join(root, 'code.ts'), 0o640);
    expect(await edit([{ search: '第一行\n第二行\n', replace: '第一行\n修改后\n' }])).toMatchObject({ success: true });
    expect(await read()).toBe('\ufeff第一行\r\n修改后\r\n');
    expect((await fs.stat(path.join(root, 'code.ts'))).mode & 0o777).toBe(0o640);
    expect(approvals[0].preview).toMatchObject({ newline: 'CRLF', utf8Bom: true });
    expect(await write('完整\n覆盖\n')).toMatchObject({ success: true });
    expect(await read()).toBe('\ufeff完整\r\n覆盖\r\n');
  });

  it('preserves no-final-newline files and rejects binary, invalid Unicode and mixed newlines', async () => {
    await fs.writeFile(path.join(root, 'code.ts'), 'first = 1');
    expect(await edit()).toMatchObject({ success: true });
    expect(await read()).toBe('first = 3');
    await fs.writeFile(path.join(root, 'code.ts'), 'a\r\nb\n');
    expect(await write()).toMatchObject({ error: { code: 'MIXED_NEWLINES' } });
    await fs.writeFile(path.join(root, 'code.ts'), Buffer.from([0, 1, 2]));
    expect(await write()).toMatchObject({ error: { code: 'UNSUPPORTED_ENCODING' } });
    expect(await write('\ud800', 'new.txt')).toMatchObject({ error: { code: 'UNSUPPORTED_ENCODING' } });
  });
});

describe('concurrency, cancellation and atomic submission', () => {
  it('refuses changes made during review and refuses replacing a newly created target', async () => {
    prompt = async (request) => { await fs.writeFile(path.join(root, request.preview.path), 'external edit'); return 'approve'; };
    expect(await write()).toMatchObject({ error: { code: 'FILE_CONFLICT' } });
    expect(await read()).toBe('external edit');
    expect(await write('new content', 'new.txt')).toMatchObject({ error: { code: 'FILE_CONFLICT' } });
    expect(await read('new.txt')).toBe('external edit');
  });

  it('checks inode even when a replacement has identical bytes', async () => {
    prompt = async () => {
      await fs.rename(path.join(root, 'code.ts'), path.join(root, 'old.ts'));
      await fs.writeFile(path.join(root, 'code.ts'), await read('old.ts'));
      return 'approve';
    };
    expect(await write()).toMatchObject({ error: { code: 'FILE_CONFLICT' } });
    expect(await read()).toContain('first = 1');
  });

  it('rechecks after staging, before atomic replacement', async () => {
    vi.mocked(fs.open).mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      const handle = await actualFs.open(...args);
      if (args[1] === 'wx') {
        const originalSync = handle.sync.bind(handle);
        handle.sync = async () => { await fs.writeFile(path.join(root, 'code.ts'), 'edited while staging'); await originalSync(); };
      }
      return handle;
    });
    expect(await write()).toMatchObject({ error: { code: 'FILE_CONFLICT' } });
    expect(await read()).toBe('edited while staging');
    expect(await fs.readdir(root)).toEqual(['code.ts']);
  });

  it('uses exclusive atomic creation even if another file appears at the final syscall', async () => {
    vi.mocked(fs.link).mockImplementationOnce(async (source, destination) => {
      await fs.writeFile(destination, 'concurrent creator');
      await actualFs.link(source, destination);
    });
    expect(await write('proposal', 'new.txt')).toMatchObject({ error: { code: 'FILE_CONFLICT' } });
    expect(await read('new.txt')).toBe('concurrent creator');
  });

  it('returns actual success if cancellation arrives after atomic commit was dispatched', async () => {
    const abort = new AbortController();
    vi.mocked(fs.rename).mockImplementationOnce(async (source, destination) => {
      abort.abort();
      await actualFs.rename(source, destination);
    });
    expect(await write('committed', 'code.ts', abort.signal)).toMatchObject({ success: true });
    expect(await read()).toBe('committed');
  });

  it('cancels a pending approval without writing', async () => {
    const abort = new AbortController();
    prompt = async () => { abort.abort(); return 'approve'; };
    expect(await write('cancelled', 'code.ts', abort.signal)).toMatchObject({ error: { code: 'ABORTED' } });
    expect(await read()).toContain('first = 1');
    prompt = async () => { tools.workspaces.revoke(grant); return 'approve'; };
    expect(await write()).toMatchObject({ error: { code: 'PERMISSION_DENIED' } });
    expect(await read()).toContain('first = 1');
  });

  it('reports disk-full and rename failures and cleans temporary files', async () => {
    vi.mocked(fs.open).mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      const handle = await actualFs.open(...args);
      if (args[1] === 'wx') handle.writeFile = async () => { throw Object.assign(new Error('private path'), { code: 'ENOSPC' }); };
      return handle;
    });
    expect(await write()).toMatchObject({ error: { code: 'WRITE_FAILED', message: '磁盘空间或配额不足，文件未提交' } });
    vi.mocked(fs.open).mockImplementation(actualFs.open);
    vi.mocked(fs.rename).mockRejectedValueOnce(Object.assign(new Error('private path'), { code: 'EIO' }));
    expect(await write()).toMatchObject({ error: { code: 'WRITE_FAILED' } });
    expect(await read()).toContain('first = 1');
    expect(await fs.readdir(root)).toEqual(['code.ts']);
  });

  it('allows only one of two concurrent proposals based on the same file version to commit', async () => {
    let arrived = 0;
    let release: () => void = () => {};
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    prompt = async () => { if (++arrived === 2) release(); await barrier; return 'approve'; };
    const results = await Promise.all([write('A'), write('B')]);
    expect(results.filter((result) => result.success)).toHaveLength(1);
    expect(results.filter((result) => !result.success)[0].error!.code).toMatch(/FILE_BUSY|FILE_CONFLICT/);
    expect(['A', 'B']).toContain(await read());
  });
});

describe('approval binding and Undo', () => {
  it('does not trust mutated previews, forged receipts, or replayed approvals', async () => {
    const permissions = new PermissionManager(async (request) => { request.preview.after = 'tampered'; return 'approve'; });
    const changes = new FileChangeService(tools.workspaces, permissions);
    const signal = new AbortController().signal;
    const plan = await changes.prepare({ kind: 'write', path: 'code.ts', content: 'approved' }, grant, 'call_1', signal);
    const otherPlan = await changes.prepare({ kind: 'write', path: 'code.ts', content: 'other' }, grant, 'call_2', signal);
    const receipt = await changes.approve(plan, signal);
    await expect(changes.commit(otherPlan, receipt, signal)).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' });
    await expect(changes.commit(plan, {} as ApprovalReceipt, signal)).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' });
    expect(await read()).toContain('first = 1');
    const fresh = await changes.prepare({ kind: 'write', path: 'code.ts', content: 'approved' }, grant, 'call_3', signal);
    const valid = await changes.approve(fresh, signal);
    await changes.commit(fresh, valid, signal);
    expect(await read()).toBe('approved');
    await expect(changes.commit(fresh, valid, signal)).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' });
  });

  it('expires approval separately from filesystem timeout', async () => {
    const permissions = new PermissionManager(async () => new Promise(() => {}), 10);
    const changes = new FileChangeService(tools.workspaces, permissions);
    const executor = new ToolExecutor(tools.registry, tools.workspaces, { fileChanges: changes });
    expect(await executor.execute({ id: 'expires', name: 'write_file', input: { path: 'code.ts', content: 'x' } },
      { workspace: grant })).toMatchObject({ error: { code: 'APPROVAL_EXPIRED' } });
    expect(await read()).toContain('first = 1');
  });

  it('requires another approval to Undo and restores original bytes, BOM and CRLF', async () => {
    await fs.writeFile(path.join(root, 'code.ts'), '\ufeff原文\r\n');
    const id = undoId(await write('修改\n'));
    expect(await tools.executor.undo(id, { workspace: grant })).toMatchObject({ success: true });
    expect(await read()).toBe('\ufeff原文\r\n');
    expect(approvals).toHaveLength(2);
    expect(approvals[1].preview.after).toBe('原文\r\n');
    expect(await tools.executor.undo(id, { workspace: grant })).toMatchObject({ error: { code: 'UNDO_UNAVAILABLE' } });
  });

  it('supports undoing creation, rejects undo after subsequent edits, and rejects other grants', async () => {
    const created = undoId(await write('new content', 'new.txt'));
    const otherGrant = await tools.workspaces.authorizeWorkspace(root);
    expect(await tools.executor.undo(created, { workspace: otherGrant })).toMatchObject({ error: { code: 'UNDO_UNAVAILABLE' } });
    expect(await tools.executor.undo(created, { workspace: grant })).toMatchObject({ success: true });
    expect(approvals.at(-1)!.preview.operation).toBe('delete');
    await expect(read('new.txt')).rejects.toMatchObject({ code: 'ENOENT' });
    const id = undoId(await edit());
    await fs.writeFile(path.join(root, 'code.ts'), 'external');
    expect(await tools.executor.undo(id, { workspace: grant })).toMatchObject({ error: { code: 'FILE_CONFLICT' } });
    expect(await read()).toBe('external');
  });
});
