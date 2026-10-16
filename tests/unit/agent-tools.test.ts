import { mkdtemp, mkdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ToolExecutor } from '../../src/main/agent/ToolExecutor';
import { ToolRegistry } from '../../src/main/agent/ToolRegistry';
import { registerReadOnlyTools } from '../../src/main/agent/registerReadOnlyTools';
import { WorkspaceService, type WorkspaceGrant } from '../../src/main/agent/WorkspaceService';
import type { SearchFilesOutput } from '../../src/main/agent/tools/file/searchFiles';
import type { ToolResult } from '../../src/main/agent/types/tool';

let temporary: string;
let root: string;
let outside: string;
let workspaces: WorkspaceService;
let grant: WorkspaceGrant;
let executor: ToolExecutor;
let nextId = 0;

beforeEach(async () => {
  temporary = await mkdtemp(path.join(os.tmpdir(), 'snipvia-agent-tools-'));
  root = path.join(temporary, 'workspace');
  outside = path.join(temporary, 'workspace-other');
  await mkdir(root);
  await mkdir(outside);
  await mkdir(path.join(root, 'src'));
  await mkdir(path.join(root, 'empty'));
  await writeFile(path.join(root, 'README.md'), '你好 Snipvia\r\nAgent tools\r\n');
  await writeFile(path.join(root, 'src', 'alpha.ts'), 'const value = 1;\n// NEEDLE\n');
  await writeFile(path.join(root, 'src', 'beta.js'), 'const value = 2;');
  await writeFile(path.join(outside, 'secret.txt'), 'OUTSIDE_SENTINEL');
  workspaces = new WorkspaceService();
  grant = await workspaces.authorizeWorkspace(root);
  const registry = new ToolRegistry();
  registerReadOnlyTools(registry);
  executor = new ToolExecutor(registry, workspaces);
});

afterEach(async () => {
  executor.cancelAll();
  await rm(temporary, { recursive: true, force: true });
});

function call(name: string, input: unknown, workspace: WorkspaceGrant | undefined = grant) {
  return executor.execute({ id: `call_${++nextId}`, name, input }, { workspace });
}

function searchOutput(result: ToolResult): SearchFilesOutput {
  expect(result.success).toBe(true);
  if (!result.success) throw new Error(result.error.code);
  return result.output as SearchFilesOutput;
}

describe('read-only Agent tools', () => {
  it('reads UTF-8 text without changing CRLF and reports measured metadata', async () => {
    const result = await call('read_file', { path: './README.md' });
    expect(result).toMatchObject({ success: true, output: {
      path: 'README.md', content: '你好 Snipvia\r\nAgent tools\r\n', encoding: 'utf-8',
      byteLength: Buffer.byteLength('你好 Snipvia\r\nAgent tools\r\n')
    }, metadata: { toolName: 'read_file', durationMs: expect.any(Number) } });
    expect(result.metadata!.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('lists one level in sorted order and reports truncation', async () => {
    expect(await call('list_directory', {})).toMatchObject({ success: true, output: {
      path: '.', entries: [
        { name: 'README.md', path: 'README.md', type: 'file' },
        { name: 'empty', type: 'directory' }, { name: 'src', type: 'directory' }
      ], truncated: false
    } });
    expect(await call('list_directory', { maxEntries: 1 })).toMatchObject({ success: true, output: { entries: [expect.any(Object)], truncated: true } });
    expect(await call('list_directory', { path: 'empty' })).toMatchObject({ success: true, output: { entries: [], truncated: false } });
  });

  it('searches names, recursive globs and literal keywords with intersection semantics', async () => {
    expect(searchOutput(await call('search_files', { name: 'ALPHA' })).matches).toEqual([{ path: 'src/alpha.ts' }]);
    expect(searchOutput(await call('search_files', { glob: '**/*.ts', keyword: 'needle' })).matches).toEqual([
      { path: 'src/alpha.ts', line: 2, preview: '// NEEDLE' }
    ]);
    expect(searchOutput(await call('search_files', { path: 'src', glob: '*.js', name: 'beta', keyword: 'value' })).matches).toEqual([
      { path: 'src/beta.js', line: 1, preview: 'const value = 2;' }
    ]);
    expect(searchOutput(await call('search_files', { keyword: 'needle', caseSensitive: true })).matches).toEqual([]);
    expect(searchOutput(await call('search_files', { name: 'alpha', glob: '*.js' })).matches).toEqual([]);
  });

  it('bounds result count, depth and preview size', async () => {
    await writeFile(path.join(root, 'long.txt'), `${'x'.repeat(2000)}needle${'y'.repeat(2000)}`);
    const limited = searchOutput(await call('search_files', { glob: '**/*', maxResults: 1 }));
    expect(limited.matches).toHaveLength(1);
    expect(limited).toMatchObject({ truncated: true, limitsReached: ['results'] });
    const shallow = searchOutput(await call('search_files', { glob: '**/*.ts', maxDepth: 0 }));
    expect(shallow.matches).toEqual([]);
    expect(shallow.limitsReached).toContain('depth');
    const text = searchOutput(await call('search_files', { name: 'long', keyword: 'needle' }));
    expect(text.matches[0].preview!.length).toBeLessThanOrEqual(240);
    expect(text.matches[0].preview).toContain('needle');
  });

  it('skips binary/oversized files and bulk dependency directories during search', async () => {
    await mkdir(path.join(root, 'node_modules'));
    await writeFile(path.join(root, 'node_modules', 'skip.ts'), 'NEEDLE');
    await writeFile(path.join(root, 'binary.bin'), Buffer.from([0, 1, 2, 3]));
    await writeFile(path.join(root, 'invalid.txt'), Buffer.from([0xc3, 0x28]));
    await writeFile(path.join(root, 'huge.txt'), Buffer.alloc(1024 * 1024 + 1, 'a'));
    const result = searchOutput(await call('search_files', { keyword: 'NEEDLE' }));
    expect(result.matches.map((item) => item.path)).toEqual(['src/alpha.ts']);
    expect(result.skipped).toMatchObject({ binary: 2, tooLarge: 1, excludedDirectories: 1 });
    expect(result.readBytes).toBeGreaterThanOrEqual(6);
    expect(await call('read_file', { path: 'binary.bin' })).toMatchObject({ error: { code: 'UNSUPPORTED_ENCODING' } });
    expect(await call('read_file', { path: 'invalid.txt' })).toMatchObject({ error: { code: 'UNSUPPORTED_ENCODING' } });
  });

  it.each([
    ['read_file', { path: 'missing.txt' }, 'NOT_FOUND'],
    ['read_file', { path: 'src' }, 'NOT_A_FILE'],
    ['list_directory', { path: 'README.md' }, 'NOT_A_DIRECTORY'],
    ['read_file', { path: 'README.md', maxBytes: 2 }, 'FILE_TOO_LARGE'],
    ['read_file', { path: 'README.md', maxBytes: 2 ** 30 }, 'INVALID_INPUT'],
    ['read_file', { path: 'README.md', unexpected: true }, 'INVALID_INPUT'],
    ['read_file', { path: 42 }, 'INVALID_INPUT'],
    ['search_files', {}, 'INVALID_INPUT'],
    ['search_files', { glob: '../../*' }, 'INVALID_INPUT'],
    ['search_files', { glob: '{a,b}/*' }, 'INVALID_INPUT'],
    ['search_files', { glob: '*.ts', maxDepth: 100 }, 'INVALID_INPUT']
  ])('normalizes %s failures without native error paths', async (name, input, code) => {
    const result = await call(name, input);
    expect(result).toMatchObject({ success: false, error: { code } });
    expect(JSON.stringify(result)).not.toContain(temporary);
  });
});

describe('workspace authorization and path boundaries', () => {
  it('requires a real explicit grant from the same service', async () => {
    const input = { id: 'no_grant', name: 'read_file', input: { path: 'README.md' } };
    expect(await executor.execute(input)).toMatchObject({ error: { code: 'WORKSPACE_REQUIRED' } });
    expect(await executor.execute(input, { workspace: { id: grant.id } as WorkspaceGrant })).toMatchObject({ error: { code: 'WORKSPACE_REQUIRED' } });
    const otherService = new WorkspaceService();
    expect(await call('read_file', { path: 'README.md' }, await otherService.authorizeWorkspace(root))).toMatchObject({ error: { code: 'WORKSPACE_REQUIRED' } });
    workspaces.revoke(grant);
    expect(await call('read_file', { path: 'README.md' })).toMatchObject({ error: { code: 'PERMISSION_DENIED' } });
  });

  it.each([
    '../workspace-other/secret.txt', 'src/../../workspace-other/secret.txt',
    'src/../README.md', '/etc/passwd', 'C:\\Windows\\win.ini', 'C:secret.txt',
    '\\\\server\\share', 'README.md:stream', 'README.md\0', 'src\\..\\README.md',
    'NUL', 'COM1.txt', 'src/.. /secret.txt', 'src/../'
  ])('rejects unsafe paths for all tools: %s', async (inputPath) => {
    for (const name of ['read_file', 'list_directory', 'search_files']) {
      const result = await call(name, { path: inputPath, ...(name === 'search_files' ? { glob: '*' } : {}) });
      expect(result).toMatchObject({ success: false, error: { code: 'PATH_OUTSIDE_WORKSPACE' } });
      expect(JSON.stringify(result)).not.toContain('OUTSIDE_SENTINEL');
    }
  });

  it('rejects absolute paths even when inside the workspace', async () => {
    expect(await call('read_file', { path: path.join(root, 'README.md') })).toMatchObject({ error: { code: 'PATH_OUTSIDE_WORKSPACE' } });
  });

  it('rejects file and parent symlinks, including links back inside workspace', async () => {
    await symlink(outside, path.join(root, 'escape'), 'dir');
    await symlink(path.join(outside, 'secret.txt'), path.join(root, 'secret-link'));
    await symlink(path.join(root, 'README.md'), path.join(root, 'internal-link'));
    for (const item of ['escape/secret.txt', 'secret-link', 'internal-link']) {
      expect(await call('read_file', { path: item })).toMatchObject({ error: { code: 'SYMLINK_NOT_ALLOWED' } });
    }
    expect(await call('list_directory', { path: 'escape' })).toMatchObject({ error: { code: 'SYMLINK_NOT_ALLOWED' } });
    expect(await call('search_files', { path: 'escape', glob: '*' })).toMatchObject({ error: { code: 'SYMLINK_NOT_ALLOWED' } });
    const search = searchOutput(await call('search_files', { keyword: 'OUTSIDE_SENTINEL' }));
    expect(search.matches).toEqual([]);
    expect(search.skipped.symlinks).toBe(3);
  });

  it('invalidates a grant when the authorized directory is replaced', async () => {
    await rename(root, `${root}-moved`);
    await symlink(outside, root, 'dir');
    expect(await call('read_file', { path: 'secret.txt' })).toMatchObject({ error: { code: 'WORKSPACE_CHANGED' } });
  });

  it('keeps concurrent calls scoped to their own workspace grants', async () => {
    const other = await workspaces.authorizeWorkspace(outside);
    const [inside, external] = await Promise.all([
      call('read_file', { path: 'secret.txt' }),
      call('read_file', { path: 'secret.txt' }, other)
    ]);
    expect(inside).toMatchObject({ error: { code: 'NOT_FOUND' } });
    expect(external).toMatchObject({ success: true, output: { content: 'OUTSIDE_SENTINEL' } });
  });
});
