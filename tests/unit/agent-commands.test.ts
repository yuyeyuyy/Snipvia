import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, link, realpath, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotebookService } from '../../src/main/notes/NotebookService';
import { NotebookWriter } from '../../src/main/agent/notes/NotebookWriter';
import { createFileToolSystem } from '../../src/main/agent/createFileToolSystem';
import { shellQuote, cleanCommandEnvironment, type CommandSandbox } from '../../src/main/agent/commands/ProcessSandbox';
import { ToolError } from '../../src/main/agent/ToolError';
import { AgentLoop } from '../../src/main/agent/AgentLoop';
import type { LLMProvider } from '../../src/main/ai/llm/LLMProvider';
import { ContextManager } from '../../src/main/agent/ContextManager';
import type { PermissionDecision, PermissionRequest } from '../../src/shared/agent/permission';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); vi.unstubAllEnvs(); });
async function fixture(sandbox?: CommandSandbox, decision: PermissionDecision = 'allow_once') {
  const prompts: PermissionRequest[] = [];
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'snipvia-commands-'))), root = join(directory, '算法笔记');
  await mkdir(root); await mkdir(join(root, 'assets')); await writeFile(join(root, '二分查找.md'), '# 二分查找\nleft = mid\n');
  const notebooks = new NotebookService(join(directory, 'registry.json'), async () => {}), book = await notebooks.open(root);
  const guard = vi.fn<(id: string, signal: AbortSignal) => Promise<void>>(async () => {}), changed = vi.fn();
  const system = createFileToolSystem({ readOnly: true, prompt: async (request) => { prompts.push(request); return decision; },
    commands: { protectedPaths: [], sandbox }, notebookWriter: workspaces => new NotebookWriter({ workspaces, notebook: id => notebooks.authorizedNotebook(id), beforeWrite: guard, changed }) });
  const grant = await system.workspaces.authorizeWorkspace(root), writer = system.noteWriter!, scope = writer.createScope(book, grant);
  cleanups.push(async () => { writer.closeScope(scope); notebooks.dispose(); await rm(directory, { recursive: true, force: true }); });
  const signal = new AbortController().signal;
  const command = (command: string, options: { timeoutMs?: number; cwd?: string; scope?: object; signal?: AbortSignal } = {}) =>
    system.commandRunner!.run(options.scope ?? scope, { kind: 'command', command, timeoutMs: options.timeoutMs ?? 4000, cwd: options.cwd ?? '.' }, options.signal ?? signal, 10_000);
  const script = (language: 'javascript' | 'python' | 'shell', code: string, options: { scope?: object; signal?: AbortSignal } = {}) =>
    system.commandRunner!.run(options.scope ?? scope, { kind: 'script', language, code, cwd: '.', timeoutMs: 4000 }, options.signal ?? signal, 10_000);
  return { directory, root, book, notebooks, writer, scope, signal, system, grant, guard, changed, command, script, prompts };
}
describe('笔记本内系统沙箱命令', () => {
  it('真实创建目录、移动笔记，支持中文、空格和单引号，记录新位置', async () => {
    const f = await fixture(), target = "算法题目 '一'";
    const result = await f.command(`mkdir -p ${shellQuote(target)} && mv -n '二分查找.md' ${shellQuote(`${target}/二分查找.md`)} && printf '完成\\n' | cat`);
    expect(result, JSON.stringify(result)).toMatchObject({ success: true, output: { exitCode: 0, stdout: '完成\n', createdDirectories: [target], noteChanges: [{ operation: 'move', previousPath: '二分查找.md', path: `${target}/二分查找.md` }] } });
    expect(await readFile(join(f.root, target, '二分查找.md'), 'utf8')).toContain('left = mid');
    expect(f.guard).toHaveBeenCalledTimes(1); expect(f.changed).toHaveBeenCalledTimes(1);
    expect(f.writer.diff(result.output!.noteChanges[0].id).diff).toContain('rename from 二分查找.md');
  });
  it('JavaScript 用标准输入执行算法并写入 Markdown，不继承私密环境', async () => {
    const f = await fixture(); vi.stubEnv('SNIPVIA_TEST_API_KEY', 'do-not-leak'); vi.stubEnv('NODE_OPTIONS', '--fake-option');
    const result = await f.script('javascript', `import { writeFileSync } from 'node:fs';\nconsole.log([1, 3, 5].indexOf(3)); console.log(process.env.SNIPVIA_TEST_API_KEY ?? 'clean');\nwriteFileSync('验证.md', '# 验证\\n返回 1。\\n');`);
    expect(result, JSON.stringify(result)).toMatchObject({ success: true, output: { stdout: '1\nclean\n', noteChanges: [{ operation: 'create', path: '验证.md' }] } });
    expect(await readFile(join(f.root, '验证.md'), 'utf8')).toBe('# 验证\n返回 1。\n');
  });
  it('Shell 脚本和 heredoc 都可以生成笔记，Python 可以测试算法', async () => {
    const f = await fixture();
    expect(await f.script('shell', "cat > 'Shell.md' <<'NOTE'\n# Shell\nNOTE\n")).toMatchObject({ success: true });
    const python = await f.script('python', "print(sum([1, 2, 3]))");
    expect(python, JSON.stringify(python)).toMatchObject({ success: true, output: { stdout: '6\n' } });
    expect(await readFile(join(f.root, 'Shell.md'), 'utf8')).toBe('# Shell\n');
  });
  it('非零退出也保留 stdout、stderr 与真实文件变更', async () => {
    const f = await fixture();
    expect(await f.command("printf '# 已写入\\n' > '部分.md'; printf 'output'; printf 'error' >&2; exit 7")).toMatchObject({ success: false,
      error: { code: 'COMMAND_FAILED' }, output: { exitCode: 7, stdout: 'output', stderr: 'error', noteChanges: [{ path: '部分.md' }] } });
  });
  it('禁止外部文件读写、敏感笔记文件读取及网络访问', async () => {
    const f = await fixture(), outside = join(f.directory, 'private.txt'); await writeFile(outside, 'private-content'); await writeFile(join(f.root, '.env'), 'private-env');
    for (const command of [`cat ${shellQuote(outside)}`, `printf bad > ${shellQuote(outside)}`, 'cat .env', 'curl --connect-timeout 1 --max-time 2 http://127.0.0.1:9']) {
      const result = await f.command(command); expect(result, command).toMatchObject({ success: false }); expect(result.output?.stdout).not.toContain('private');
    }
    expect(await readFile(outside, 'utf8')).toBe('private-content');
    let requests = 0;
    const server = createServer((_request, response) => { requests++; response.end('should-not-reach'); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); if (!address || typeof address === 'string') throw new Error('missing test listener');
    try {
      const result = await f.command(`curl --noproxy '*' --fail --connect-timeout 1 --max-time 2 http://127.0.0.1:${address.port}`);
      expect(result).toMatchObject({ success: false }); expect(requests).toBe(0); expect(result.output?.stdout).not.toContain('should-not-reach');
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  });
  it('只读范围允许执行计算，不能写笔记', async () => {
    const f = await fixture(), scope = f.writer.createScope(f.book, f.grant, true);
    expect(await f.script('javascript', 'console.log(2 + 2)', { scope })).toMatchObject({ success: true, output: { stdout: '4\n' } });
    expect(await f.command("printf bad > '拒绝.md'", { scope })).toMatchObject({ success: false });
    expect(await readdir(f.root)).not.toContain('拒绝.md');
  });
  it('相对 cwd 校验拒绝越界、绝对目录与符号链接', async () => {
    const f = await fixture(); await symlink(f.directory, join(f.root, 'escape'));
    for (const cwd of ['..', f.directory, 'escape']) expect(await f.command('pwd', { cwd })).toMatchObject({ success: false });
    await mkdir(join(f.root, '题目')); expect(await f.command('pwd', { cwd: '题目' })).toMatchObject({ success: true, output: { stdout: `${f.root}/题目\n` } });
  });
  it('硬链接拒绝执行；符号链接读写不能越过系统沙箱', async () => {
    const f = await fixture(), outside = join(f.directory, 'private.md'); await writeFile(outside, 'private');
    await symlink(outside, join(f.root, '链接.md')); expect(await f.command("cat '链接.md'")).toMatchObject({ success: false });
    await link(outside, join(f.root, '硬链接.md')); expect(await f.command("printf bad > '硬链接.md'")).toMatchObject({ success: false, error: { code: 'SYMLINK_NOT_ALLOWED' } });
    expect(await readFile(outside, 'utf8')).toBe('private');
  });
  it('超时停止整个普通子进程组，保留已提交变更', async () => {
    const f = await fixture();
    const result = await f.command("printf '# 提前写入\\n' > '提前.md'; (sleep 1; printf bad > '延迟.md') & wait", { timeoutMs: 350 });
    expect(result, JSON.stringify(result)).toMatchObject({ success: false, error: { code: 'TIMEOUT' }, output: { timedOut: true, noteChanges: [{ path: '提前.md' }] } });
    await new Promise(resolve => setTimeout(resolve, 1100)); expect(await readdir(f.root)).not.toContain('延迟.md');
  });
  it('用户停止后等待退出，再记录实际变更', async () => {
    const f = await fixture(), controller = new AbortController();
    const pending = f.command("printf '# 停止前\\n' > '停止.md'; sleep 3", { signal: controller.signal });
    await vi.waitFor(async () => { expect(await readFile(join(f.root, '停止.md'), 'utf8')).toContain('停止前'); }); controller.abort();
    expect(await pending).toMatchObject({ success: false, error: { code: 'ABORTED' }, output: { cancelled: true, noteChanges: [{ path: '停止.md' }] } });
  });
  it('输出超过一 MiB 时终止，返回有界输出', async () => {
    const f = await fixture(), result = await f.command("yes 'abcdefghijk' ");
    expect(result).toMatchObject({ success: false, error: { code: 'RESPONSE_TOO_LARGE' }, output: { truncated: true, outputLimit: true } });
    expect(Buffer.byteLength(result.output!.stdout)).toBeLessThanOrEqual(16 * 1024);
  });
  it('无范围、已结束能力、资格检查失败和沙箱缺失都不执行', async () => {
    const prepare = vi.fn(async () => { throw new ToolError('SANDBOX_UNAVAILABLE', 'missing'); }), f = await fixture({ prepare });
    expect(await f.command('echo bad', { scope: {} })).toMatchObject({ success: false, error: { code: 'WORKSPACE_REQUIRED' } });
    f.guard.mockRejectedValueOnce(new ToolError('PERMISSION_DENIED', 'expired'));
    expect(await f.command('echo bad')).toMatchObject({ success: false, error: { code: 'PERMISSION_DENIED' } }); expect(prepare).not.toHaveBeenCalled();
    expect(await f.command("printf bad > '禁止.md'")).toMatchObject({ success: false, error: { code: 'SANDBOX_UNAVAILABLE' } }); expect(await readdir(f.root)).not.toContain('禁止.md');
    f.writer.closeScope(f.scope); expect(await f.command('echo bad')).toMatchObject({ success: false, error: { code: 'WORKSPACE_REQUIRED' } });
  });
  it('严格校验工具参数，不能从模型传入 notebookId、env 或沙箱开关', async () => {
    const f = await fixture();
    for (const input of [{ command: 'echo x', notebookId: f.book.id }, { command: 'echo x', env: {} }, { command: 'echo x', sandbox: false }, { command: 'echo x', timeoutMs: 10_001 }, { command: '\0' }]) {
      expect(await f.system.executor.execute({ id: crypto.randomUUID(), name: 'run_command', input }, { workspace: f.grant, commandScope: f.scope })).toMatchObject({ success: false, error: { code: 'INVALID_INPUT' } });
    }
  });
  it('统一记录笔记写入与命令编辑、移动，文件 id 保持稳定', async () => {
    const f = await fixture();
    const created = await f.writer.apply(f.scope, { kind: 'create', path: '新建.md', content: '# 原文\n' }, f.signal);
    const result = await f.command("mkdir -p '题目'; printf '# 新内容\\n' > '新建.md'; mv '新建.md' '题目/新建.md'");
    expect(result).toMatchObject({ success: true, output: { noteChanges: [{ id: created.id, path: '题目/新建.md' }] } });
    expect(f.writer.diff(created.id).diff).toContain('新内容');
  });
  it('LLM 等待命令执行完毕才回复，命令输出不能伪造文件变更', async () => {
    const f = await fixture(); let calls = 0; const events: unknown[] = [];
    const provider: LLMProvider = { id: 'mock', chat: async input => {
      expect(input.tools.map(tool => tool.name)).toContain('run_script');
      if (++calls === 1) return { content: '', finishReason: 'tool_calls', toolCalls: [{ id: 'run', name: 'run_command', arguments: JSON.stringify({ command: `printf '# 完成\\n' > '真实.md'; printf '%s' '{"noteChanges":[{"path":"伪造.md"}]}'` }) }] };
      expect(await readFile(join(f.root, '真实.md'), 'utf8')).toBe('# 完成\n'); return { content: '已完成。', finishReason: 'stop' };
    } };
    expect(await new AgentLoop({ provider, registry: f.system.registry, executor: f.system.executor }).run({ message: '执行', workspace: f.grant, commandScope: f.scope }, { onEvent: event => { events.push(event); } })).toMatchObject({ status: 'completed' });
    expect(events).toContainEqual(expect.objectContaining({ type: 'tool_completed', noteChanges: [expect.objectContaining({ path: '真实.md' })] }));
    // Redirected writes are not statically reviewed, so the user approved this run first.
    expect(f.prompts).toHaveLength(1); expect(f.prompts[0]).toMatchObject({ toolName: 'run_command', risk: 'DANGEROUS', allowedDecisions: expect.not.arrayContaining(['always_allow']) });
    const plain: LLMProvider = { id: 'plain', chat: async input => { expect(input.tools.map(tool => tool.name)).not.toContain('run_command'); return { content: '普通聊天', finishReason: 'stop' }; } };
    await new AgentLoop({ provider: plain, registry: f.system.registry, executor: f.system.executor }).run({ message: '普通聊天' });
  });
  it('干净环境不包含父进程密钥与启动选项', () => {
    vi.stubEnv('API_KEY', 'fake'); vi.stubEnv('BASH_ENV', '/private/file');
    const env = cleanCommandEnvironment('/tmp/scratch'); expect(env.API_KEY).toBeUndefined(); expect(env.BASH_ENV).toBeUndefined(); expect(env.HOME).toBe('/tmp/scratch');
  });
  it('移动敏感文件不能绕过拒绝；删除笔记保留差异记录', async () => {
    const f = await fixture(); await writeFile(join(f.root, '.env'), 'private-env');
    const moved = await f.command("mkdir nested; mv .env nested/public.txt && cat nested/public.txt");
    expect(moved).toMatchObject({ success: false }); expect(moved.output?.stdout).not.toContain('private-env');
    const deleted = await f.command("rm '二分查找.md'"); expect(deleted).toMatchObject({ success: true, output: { noteChanges: [{ operation: 'delete', path: '二分查找.md', removed: 2 }] } });
    expect(f.writer.diff(deleted.output!.noteChanges[0].id).diff).toContain('-left = mid');
  });
  it('大批整理的可信清单不随模型输出预算截断', async () => {
    const f = await fixture(); let calls = 0; const changes: string[] = [];
    const provider: LLMProvider = { id: 'many', chat: async input => {
      if (++calls === 1) return { content: '', finishReason: 'tool_calls', toolCalls: [{ id: 'many', name: 'run_script', arguments: JSON.stringify({ language: 'javascript', code: `import {writeFileSync} from 'node:fs'; for(let i=0;i<30;i++) writeFileSync('算法主题'.repeat(15)+i+'.md', '# 算法\\n'); console.log('x'.repeat(16000));` }) }] };
      const feedback = JSON.parse(String(input.messages.at(-1)!.content)); expect(feedback.output).toMatchObject({ exitCode: 0, truncated: true }); return { content: '完成', finishReason: 'stop' };
    } };
    const result = await new AgentLoop({ provider, registry: f.system.registry, executor: f.system.executor }).run({ message: '生成主题', workspace: f.grant, commandScope: f.scope }, {
      onEvent: event => { if (event.type === 'tool_completed') changes.push(...(event.noteChanges ?? []).map(value => value.path)); }
    });
    expect(result).toMatchObject({ status: 'completed' }); expect(changes).toHaveLength(30);
    expect(f.prompts.map(prompt => prompt.toolName)).toEqual(['run_script']);
  });
  it('截断失败输出仍保留退出码与 UTF-8 完整性', () => {
    const result = new ContextManager().toolFeedback({ success: false, error: { code: 'COMMAND_FAILED', message: 'failed' }, output: { exitCode: 7, stdout: '算法'.repeat(10000), stderr: 'wrong'.repeat(10000), timedOut: false, cancelled: false } }, 8192);
    expect(result.result).toMatchObject({ success: false, output: { exitCode: 7, truncated: true } }); expect(result.content).not.toContain('�'); expect(Buffer.byteLength(result.content)).toBeLessThanOrEqual(8192);
  });
  it('工作区撤销会终止已经开始的进程，并阻止后续写入', async () => {
    const f = await fixture();
    const pending = f.system.executor.execute({ id: 'revoke', name: 'run_command', input: { command: "printf start > marker; sleep 1; printf bad > '迟到.md'" } }, { workspace: f.grant, commandScope: f.scope });
    await vi.waitFor(async () => { expect(await readFile(join(f.root, 'marker'), 'utf8')).toBe('start'); }, { timeout: 3000 }); f.system.workspaces.revoke(f.grant);
    expect(await pending).toMatchObject({ success: false, error: { code: 'ABORTED' }, output: { cancelled: true } });
    await new Promise(resolve => setTimeout(resolve, 1100)); expect(await readdir(f.root)).not.toContain('迟到.md');
  });
  it('只读和笔记本内整理命令免确认，脚本、重定向和系统设置命令需要确认', async () => {
    const f = await fixture();
    const run = (name: 'run_command' | 'run_script', input: object) => f.system.executor.execute({ id: crypto.randomUUID(), name, input }, { workspace: f.grant, commandScope: f.scope });
    expect(await run('run_command', { command: "ls -la && grep -n 'left' '二分查找.md' | head -n 1" })).toMatchObject({ success: true });
    expect(await run('run_command', { command: "mkdir -p '算法' && mv -n '二分查找.md' '算法/二分查找.md'" })).toMatchObject({ success: true });
    expect(f.prompts).toHaveLength(0);
    expect(await run('run_script', { language: 'javascript', code: 'console.log(1 + 1)' })).toMatchObject({ success: true, output: { stdout: '2\n' } });
    expect(await run('run_command', { command: 'export SNIPVIA_TEST=1' })).toMatchObject({ success: true });
    expect(await run('run_command', { command: "mv '算法/二分查找.md' '覆盖.md'" })).toMatchObject({ success: true });
    expect(f.prompts.map(prompt => prompt.toolName)).toEqual(['run_script', 'run_command', 'run_command']);
    expect(f.prompts[1].reasons.join('；')).toContain('环境变量');
    expect(f.prompts[2].reasons.join('；')).toContain('-n');
    expect(f.prompts.every(prompt => prompt.risk === 'DANGEROUS' && !prompt.allowedDecisions.includes('always_allow'))).toBe(true);
  });
  it('拒绝后脚本不执行，也不会产生笔记变更', async () => {
    const f = await fixture(undefined, 'deny');
    const result = await f.system.executor.execute({ id: 'denied', name: 'run_script', input: { language: 'javascript', code: "import {writeFileSync} from 'node:fs'; writeFileSync('不应出现.md', 'x')" } }, { workspace: f.grant, commandScope: f.scope });
    expect(result).toMatchObject({ success: false, error: { code: 'APPROVAL_DENIED' } });
    expect(await readdir(f.root)).not.toContain('不应出现.md'); expect(f.guard).not.toHaveBeenCalled();
  });
});
