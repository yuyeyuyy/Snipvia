import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ExecutionPresenter } from '../../src/main/agent/ui/ExecutionPresenter';
import { AgentExecutionService, type AgentUIContext } from '../../src/main/agent/ui/AgentExecutionService';
import { createFileToolSystem } from '../../src/main/agent/createFileToolSystem';
import type { AgentEventPayload } from '../../src/main/agent/types/agent';
import type { AgentExecutionSnapshot, AgentRunView } from '../../src/shared/agent/execution';
import type { AgentChatResponse } from '../../src/shared/agent/message';
import type { LLMProvider } from '../../src/main/ai/llm/LLMProvider';

function presenter() {
  const view: AgentRunView = { runId: 'run', captureId: 'capture', question: 'task', messageIndex: 0, saved: false, sequence: 0, state: 'thinking', finished: false, steps: [] };
  const target = new ExecutionPresenter(view); let sequence = 0;
  const emit = (event: AgentEventPayload) => target.accept({ ...event, runId: 'run', sequence: ++sequence, timestamp: Date.now(), step: 1 });
  return { view, target, emit };
}
const call = { id: 'read', name: 'read_file', arguments: '{"path":"package.json"}' };
describe('safe execution projection', () => {
  it('does not emit tool commentary, partial tool arguments or provider state', () => {
    const { view, emit } = presenter();
    expect(emit({ type: 'tool_call_delta', index: 0, argumentsDelta: 'SECRET' })).toBe(false);
    expect(emit({ type: 'assistant_delta', text: 'TOOL_COMMENTARY' })).toBe(false);
    emit({ type: 'llm_completed', response: { content: 'PRIVATE_CHAIN_OF_THOUGHT', providerState: 'SECRET', finishReason: 'tool_calls', toolCalls: [call] } });
    expect(JSON.stringify(view)).not.toMatch(/PRIVATE_CHAIN|SECRET/); expect(view.steps[0]).toMatchObject({ state: 'tool_pending', detail: 'package.json' });
  });
  it('shows the todo_write plan as a checklist instead of a tool row, and asks inline before a script', () => {
    const { view, emit } = presenter();
    const plan = { id: 'plan', name: 'todo_write', arguments: '{}' }, script = { id: 'script', name: 'run_script', arguments: '{"language":"python","code":"print(1)"}' };
    emit({ type: 'llm_completed', response: { content: '', finishReason: 'tool_calls', toolCalls: [plan, script] } });
    emit({ type: 'tool_started', call: plan, executionId: 'run:1:0' });
    emit({ type: 'todo_updated', callId: 'plan', todos: [{ content: '检索笔记', status: 'completed' }, { content: '验证算法', status: 'in_progress' }] });
    emit({ type: 'tool_completed', callId: 'plan', name: 'todo_write', result: { success: true, output: {} }, skipped: false });
    expect(view.steps.map(step => step.toolName)).toEqual(['run_script']);
    expect(view.todos).toEqual([{ content: '检索笔记', status: 'completed' }, { content: '验证算法', status: 'in_progress' }]);
    emit({ type: 'tool_started', call: script, executionId: 'run:1:1' });
    emit({ type: 'permission_request', request: { requestId: randomUUID(), toolCallId: 'run:1:1', toolName: 'run_script', risk: 'DANGEROUS', reasons: ['将运行 Python 脚本'],
      workspacePath: '/notes', target: 'print(1)', scopeDescription: '仅本次', expiresAt: Date.now() + 1000, allowedDecisions: ['allow_once', 'allow_session', 'deny'],
      command: { risk: 'DANGEROUS', reasons: ['将运行 Python 脚本'], blocked: false } } });
    expect(view.state).toBe('permission_required');
    expect(view.steps[0]).toMatchObject({ state: 'permission_required', detail: 'python', permission: { command: 'print(1)', risk: 'DANGEROUS' } });
  });
  it('projects response increments, clears them for a tool turn, and preserves partial text when cancelled', () => {
    const { view, emit } = presenter();
    emit({ type: 'assistant_delta', text: '你好' }); emit({ type: 'assistant_delta', text: '世界' });
    expect(view).toMatchObject({ answer: '你好世界', answerStreaming: true, finished: false });
    emit({ type: 'tool_call_delta', index: 0, name: 'read_file' });
    expect(view.answer).toBeUndefined(); expect(view.answerStreaming).toBe(false);
    emit({ type: 'llm_started' }); emit({ type: 'assistant_delta', text: '部分回答' });
    emit({ type: 'run_finished', status: 'cancelled', message: '已停止，回答未完成' });
    expect(view).toMatchObject({ answer: '部分回答', answerStreaming: false, state: 'cancelled', notice: '已停止，回答未完成' });
  });
  it('projects only website hostnames and associates cached page chunks with their source', () => {
    const { view, emit } = presenter();
    emit({ type: 'tool_started', call: { id: 'fetch', name: 'fetch_url', arguments: '{"url":"https://example.com/private/path?key=SECRET"}' }, executionId: 'e1' });
    expect(view.steps[0].webTarget).toBe('example.com');
    emit({ type: 'tool_completed', callId: 'fetch', name: 'fetch_url', skipped: false,
      result: { success: true, output: { url: 'https://docs.example.com/page', metadata: { contentId: 'page-id' } } } });
    emit({ type: 'tool_started', call: { id: 'chunk', name: 'read_web_chunk', arguments: '{"contentId":"page-id","offset":4000}' }, executionId: 'e2' });
    expect(view.steps[1].webTarget).toBe('docs.example.com');
  });
  it('shows pending until executor explicitly starts, then real byte count and duration', () => {
    const { view, emit } = presenter();
    emit({ type: 'tool_started', call, executionId: 'exec' }); expect(view.steps[0].state).toBe('tool_pending');
    emit({ type: 'tool_running', executionId: 'exec' }); expect(view.steps[0].state).toBe('tool_running');
    emit({ type: 'tool_completed', callId: 'read', name: 'read_file', skipped: false, result: { success: true, output: { byteLength: 4301 }, metadata: { durationMs: 22, toolCallId: 'exec', toolName: 'read_file' } } });
    expect(view.steps[0]).toMatchObject({ state: 'tool_success', summary: '4.2 KB', durationMs: 22 });
    emit({ type: 'run_finished', status: 'completed', message: 'done' }); expect(view.state).toBe('completed');
  });
  it('records search counts, tool errors and cancellation without claiming success', () => {
    const { view, emit } = presenter();
    emit({ type: 'tool_started', call: { ...call, name: 'web_search', arguments: '{"query":"Electron"}' }, executionId: 'exec' });
    emit({ type: 'tool_completed', callId: 'read', name: 'web_search', skipped: false, result: { success: true, output: { results: Array(8).fill({}) } } }); expect(view.steps[0].summary).toBe('找到 8 条结果');
    emit({ type: 'tool_completed', callId: 'bad', name: 'bad', skipped: false, result: { success: false, error: { code: 'TOOL_NOT_FOUND', message: '工具未注册' } } });
    expect(view.steps[1].state).toBe('tool_error');
    emit({ type: 'tool_started', call: { ...call, id: 'pending' }, executionId: 'p' });
    emit({ type: 'run_finished', status: 'cancelled', message: '已停止' }); expect(view.steps[2].state).toBe('cancelled');
    expect(view.steps[0].state).toBe('tool_success');
  });
  it('shows only validated successful note commits and updates each file once', () => {
    const { view, emit } = presenter();
    const change = { id: randomUUID(), notebookId: randomUUID(), notebookName: '算法笔记', path: '二分.md', operation: 'create' as const, added: 3, removed: 0 };
    const result = (id: string, output: unknown) => emit({ type: 'tool_completed', callId: id, name: 'write_note', skipped: false, result: { success: true, output } });
    emit({ type: 'tool_started', call: { id: 'start', name: 'write_note', arguments: '{"path":"二分.md","mode":"create","content":"PRIVATE_CONTENT"}' }, executionId: 'exec' });
    expect(view.noteChanges).toBeUndefined();
    result('malformed', { ...change, path: '../outside.md' });
    result('private', { ...change, content: 'PRIVATE_CONTENT' });
    emit({ type: 'tool_completed', callId: 'failed', name: 'edit_note', skipped: false, result: { success: false, error: { code: 'FILE_CONFLICT', message: '文件已改变' } } });
    expect(view.noteChanges).toBeUndefined();
    result('start', change); result('append', { ...change, added: 6 });
    expect(view.noteChanges).toEqual([{ ...change, added: 6 }]);
    expect(JSON.stringify(view)).not.toContain('PRIVATE_CONTENT');
    emit({ type: 'run_finished', status: 'cancelled', message: '已停止' });
    expect(view.noteChanges).toEqual([{ ...change, added: 6 }]);
  });
  it('projects command approval and completion as plain data', () => {
    const { view, emit } = presenter();
    emit({ type: 'tool_started', call: { id: 'shell', name: 'run_command', arguments: '{"command":"pnpm test"}' }, executionId: 'exec' });
    emit({ type: 'permission_request', request: { requestId: randomUUID(), toolCallId: 'exec', toolName: 'run_command', risk: 'DANGEROUS', target: 'pnpm test', workspacePath: '/workspace', reasons: ['执行命令'], scopeDescription: '当前操作', expiresAt: Date.now() + 10000, allowedDecisions: ['deny', 'allow_once'], command: { risk: 'DANGEROUS', reasons: [], blocked: false } } });
    expect(view.steps[0]).toMatchObject({ state: 'permission_required', permission: { command: 'pnpm test', workspacePath: '/workspace' } });
    emit({ type: 'tool_completed', callId: 'shell', name: 'run_command', skipped: false, result: { success: true, output: { exitCode: 0, stdout: '67 tests passed' } } });
    expect(view.steps[0].summary).toContain('67 tests passed');
  });
});

const resources: Array<{ directory: string; service: AgentExecutionService }> = [];
afterEach(async () => { for (const item of resources.splice(0)) { item.service.clear(); await rm(item.directory, { recursive: true, force: true }); } });
async function harness(provider?: LLMProvider) {
  const directory = await mkdtemp(join(tmpdir(), 'snipvia-execution-ui-')); await writeFile(join(directory, 'example.ts'), 'const value = 1;\n');
  const system = createFileToolSystem({ prompt: (request, signal) => service.permissionPrompt(request, signal) ?? Promise.resolve('deny') });
  const context: AgentUIContext & { captureId: string; image: string } = { captureId: randomUUID(), conversationId: randomUUID(), image: 'data:image/jpeg;base64,test', messages: [], profile: { provider: 'custom', endpoint: 'https://example.com', model: 'test' } };
  const responses: AgentChatResponse[] = [
    { content: 'PRIVATE_INTERNAL_TEXT', finishReason: 'tool_calls', toolCalls: [{ id: randomUUID(), name: 'edit_file', arguments: JSON.stringify({ path: 'example.ts', edits: [{ search: '1', replace: '2' }] }) }] },
    { content: '已处理', finishReason: 'stop' }
  ];
  const llm: LLMProvider = provider ?? { id: 'mock', chat: vi.fn(async () => responses.shift()!) };
  const snapshots: AgentExecutionSnapshot[] = [];
  const service: AgentExecutionService = new AgentExecutionService({ ...system, context: (id) => { if (id !== context.captureId) throw new Error('stale'); return structuredClone(context); }, provider: () => llm,
    beforeStart: () => {}, save: (_context, question, answer) => { context.messages.push({ role: 'user', content: question }, { role: 'assistant', content: answer }); } });
  service.subscribe(1, context.captureId, (snapshot) => snapshots.push(snapshot));
  await service.authorizeWorkspace(1, context.captureId, directory);
  resources.push({ directory, service });
  const latest = () => snapshots.at(-1)!;
  return { directory, service, context, llm, latest, snapshots, system };
}
describe('execution UI service and ownership', () => {
  it('revokes a removed notebook across subscribers and blocks scope changes while persistence is pending', async () => {
    const h = await harness(); const notebook = { id: randomUUID(), name: '笔记', directory: h.directory };
    const grant = await h.system.workspaces.authorizeWorkspace(h.directory); const signal = h.system.workspaces.revocationSignal(grant);
    vi.spyOn(h.system.workspaces, 'authorizeWorkspace').mockResolvedValueOnce(grant);
    await h.service.selectNotebook(1, h.context.captureId, notebook);
    const shared: AgentExecutionSnapshot[] = []; h.service.subscribe(2, h.context.captureId, (snapshot) => shared.push(snapshot));
    let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
    const removing = h.service.unlinkNotebook(notebook.id, () => gate);
    expect(() => h.service.start(1, h.context.captureId, '读取笔记')).toThrow('正在选择笔记');
    await expect(h.service.selectNotebook(1, h.context.captureId, notebook)).rejects.toThrow('等待');
    expect(signal.aborted).toBe(false); release(); await removing;
    expect(signal.aborted).toBe(true);
    expect(h.latest()).toMatchObject({ notebook: null, workspacePath: null, notebookNotice: '笔记本链接已移除，请重新选择笔记。' });
    expect(shared.at(-1)?.notebook).toBeNull();
  });
  it('keeps notebook access when removal fails and leaves an unrelated selection intact', async () => {
    const h = await harness(); const notebook = { id: randomUUID(), name: '笔记', directory: h.directory };
    await h.service.selectNotebook(1, h.context.captureId, notebook);
    await expect(h.service.unlinkNotebook(notebook.id, async () => { throw new Error('磁盘错误'); })).rejects.toThrow('磁盘错误');
    expect(h.latest().notebook?.id).toBe(notebook.id);
    await h.service.unlinkNotebook(randomUUID(), async () => {});
    expect(h.latest().notebook?.id).toBe(notebook.id);
    await expect(h.service.selectNotebook(1, h.context.captureId, null)).resolves.toMatchObject({ notebook: null });
  });
  it('selects registered notebook metadata, shares it across windows/continuation, and revokes access when cleared', async () => {
    const h = await harness(); const notebook = { id: randomUUID(), name: '学习笔记', directory: h.directory };
    const grant = await h.system.workspaces.authorizeWorkspace(h.directory); const signal = h.system.workspaces.revocationSignal(grant);
    vi.spyOn(h.system.workspaces, 'authorizeWorkspace').mockResolvedValueOnce(grant);
    await h.service.selectNotebook(1, h.context.captureId, notebook);
    expect(h.latest().notebook).toEqual({ id: notebook.id, name: notebook.name });
    expect(h.service.subscribe(2, h.context.captureId, () => {}).notebook).toEqual(h.latest().notebook);
    h.context.captureId = randomUUID();
    expect(h.service.subscribe(2, h.context.captureId, () => {}).notebook?.id).toBe(notebook.id);
    await h.service.selectNotebook(2, h.context.captureId, null);
    expect(signal.aborted).toBe(true);
    expect(h.service.snapshot(2, h.context)).toMatchObject({ notebook: null, workspacePath: null });
    expect(h.llm.chat).not.toHaveBeenCalled();
  });
  it('rejects a delayed notebook authorization if the capture has changed and releases its grant', async () => {
    const h = await harness(); const grant = await h.system.workspaces.authorizeWorkspace(h.directory); const signal = h.system.workspaces.revocationSignal(grant);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    vi.spyOn(h.system.workspaces, 'authorizeWorkspace').mockImplementationOnce(async () => { await gate; return grant; });
    const changing = h.service.selectNotebook(1, h.context.captureId, { id: randomUUID(), name: '笔记', directory: h.directory });
    expect(() => h.service.start(1, h.context.captureId, '不要抢先开始')).toThrow('正在选择笔记');
    h.context.captureId = randomUUID(); release();
    await expect(changing).rejects.toThrow('stale');
    expect(signal.aborted).toBe(true);
    expect(h.service.snapshot(1, h.context).notebook).toBeNull();
  });
  it('opens only note changes belonging to the current conversation, including restored history', async () => {
    const h = await harness();
    const change = { id: randomUUID(), notebookId: randomUUID(), notebookName: '算法笔记', path: '二分.md', operation: 'create' as const, added: 3, removed: 0 };
    h.context.messages.push({ role: 'assistant', content: '已记录', noteChanges: [change] });
    const copy = h.service.noteChange(h.context.captureId, change.id);
    copy.path = '伪造.md';
    expect(h.service.noteChange(h.context.captureId, change.id)).toEqual(change);
    expect(() => h.service.noteChange(h.context.captureId, randomUUID())).toThrow('没有此笔记修改');
    expect(() => h.service.noteChange(randomUUID(), change.id)).toThrow('stale');
  });
  it('publishes bounded streaming updates before the model completes and saves only the complete answer', async () => {
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    const h = await harness({ id: 'stream', chat: async () => { throw new Error('stream expected'); },
      async *stream() {
        for (const text of ['正', '在', '回', '答']) yield { type: 'text_delta' as const, text };
        await gate;
        yield { type: 'text_delta' as const, text: '。' };
        yield { type: 'complete' as const, response: { content: '正在回答。', finishReason: 'stop' as const } };
      } });
    h.service.start(1, h.context.captureId, 'stream');
    await vi.waitFor(() => expect(h.latest().runs[0]?.answer).toBe('正在回答'));
    expect(h.latest().busy).toBe(true); expect(h.context.messages).toEqual([]);
    expect(h.snapshots.filter((item) => item.runs[0]?.answerStreaming)).toHaveLength(1);
    finish();
    await vi.waitFor(() => expect(h.latest().busy).toBe(false));
    expect(h.latest().runs[0]).toMatchObject({ answer: '正在回答。', answerStreaming: false, saved: true });
    expect(h.context.messages.at(-1)?.content).toBe('正在回答。');
  });
  it('stops a live text stream, retains visible partial output, and rejects late deltas', async () => {
    let resume!: () => void;
    const gate = new Promise<void>((resolve) => { resume = resolve; });
    const h = await harness({ id: 'stream', chat: async () => { throw new Error('stream expected'); },
      async *stream() {
        yield { type: 'text_delta' as const, text: '部分回答' };
        await gate;
        yield { type: 'text_delta' as const, text: '不应出现' };
        yield { type: 'complete' as const, response: { content: '完整回答', finishReason: 'stop' as const } };
      } });
    h.service.start(1, h.context.captureId, 'stream');
    await vi.waitFor(() => expect(h.latest().runs[0]?.answer).toBe('部分回答'));
    h.service.stop(1, h.context.captureId, h.latest().runs[0].runId);
    await vi.waitFor(() => expect(h.latest().busy).toBe(false)); resume();
    expect(h.latest().runs[0]).toMatchObject({ answer: '部分回答', answerStreaming: false, state: 'cancelled' });
    expect(JSON.stringify(h.snapshots)).not.toContain('不应出现');
  });
  it('shows real diff before allowing a file change, then resumes and saves the answer', async () => {
    const h = await harness(); h.service.start(1, h.context.captureId, '修改文件');
    await vi.waitFor(() => expect(h.latest().runs[0].steps[0]?.permission).toBeDefined());
    const run = h.latest().runs[0]; const step = run.steps[0];
    expect(await readFile(join(h.directory, 'example.ts'), 'utf8')).toContain('1'); expect(step.diff).toMatchObject({ added: 1, removed: 1 });
    expect(h.service.diff(1, h.context.captureId, run.runId, step.id).diff).toContain('+const value = 2;');
    expect(() => h.service.decide(2, h.context.captureId, run.runId, step.permission!.requestId, 'allow_once')).toThrow();
    expect(() => h.service.decide(1, h.context.captureId, run.runId, step.permission!.requestId, 'always_allow')).toThrow();
    h.service.decide(1, h.context.captureId, run.runId, step.permission!.requestId, 'allow_once');
    await vi.waitFor(() => expect(h.latest().busy).toBe(false));
    expect(await readFile(join(h.directory, 'example.ts'), 'utf8')).toContain('2'); expect(h.latest().runs[0]).toMatchObject({ saved: true, state: 'completed', answer: '已处理' });
    expect(JSON.stringify(h.snapshots)).not.toContain('PRIVATE_INTERNAL_TEXT');
    expect(h.snapshots.some((item) => item.runs[0]?.steps[0]?.state === 'tool_running')).toBe(true);
    expect(() => h.service.decide(1, h.context.captureId, run.runId, step.permission!.requestId, 'allow_once')).toThrow();
  });
  it('denial leaves the file untouched and reports the actual tool failure', async () => {
    const h = await harness(); h.service.start(1, h.context.captureId, 'modify');
    await vi.waitFor(() => expect(h.latest().runs[0].steps[0]?.permission).toBeDefined()); const run = h.latest().runs[0];
    h.service.decide(1, h.context.captureId, run.runId, run.steps[0].permission!.requestId, 'deny');
    await vi.waitFor(() => expect(h.latest().busy).toBe(false));
    expect(h.latest().runs[0].steps[0]).toMatchObject({ state: 'tool_error', summary: '已拒绝，未执行' }); expect(await readFile(join(h.directory, 'example.ts'), 'utf8')).toContain('1');
  });
  it('Stop aborts a pending approval and rejects late approval', async () => {
    const h = await harness(); h.service.start(1, h.context.captureId, 'modify');
    await vi.waitFor(() => expect(h.latest().runs[0].steps[0]?.permission).toBeDefined()); const run = h.latest().runs[0];
    h.service.stop(1, h.context.captureId, run.runId); await vi.waitFor(() => expect(h.latest().busy).toBe(false));
    expect(h.latest().runs[0].state).toBe('cancelled'); expect(h.latest().runs[0].steps[0].permission).toBeUndefined();
    expect(() => h.service.decide(1, h.context.captureId, run.runId, run.steps[0].permission!.requestId, 'allow_once')).toThrow();
    expect(await readFile(join(h.directory, 'example.ts'), 'utf8')).toContain('1');
  });
  it('Stop reaches the LLM AbortSignal and prevents simultaneous runs', async () => {
    let received: AbortSignal | undefined;
    const h = await harness({ id: 'wait', chat: async (request) => { received = request.signal; return new Promise(() => {}); } });
    const first = h.service.start(1, h.context.captureId, 'wait');
    expect(() => h.service.start(2, h.context.captureId, 'again')).toThrow();
    await vi.waitFor(() => expect(received).toBeDefined());
    expect(() => h.service.stop(2, h.context.captureId, first.runs[0].runId)).toThrow();
    h.service.stop(1, h.context.captureId, first.runs[0].runId); await vi.waitFor(() => expect(h.latest().busy).toBe(false));
    expect(received!.aborted).toBe(true); expect(h.latest().runs[0].state).toBe('cancelled');
  });
  it('handoff transfers approval ownership; closing the old window does not stop the task', async () => {
    const h = await harness(); h.service.start(1, h.context.captureId, 'modify');
    await vi.waitFor(() => expect(h.latest().runs[0].steps[0]?.permission).toBeDefined()); const run = h.latest().runs[0];
    h.service.transfer(1, 2); h.service.detach(1);
    expect(h.service.busy).toBe(true); expect(() => h.service.decide(1, h.context.captureId, run.runId, run.steps[0].permission!.requestId, 'allow_once')).toThrow();
    h.service.decide(2, h.context.captureId, run.runId, run.steps[0].permission!.requestId, 'allow_once');
    await vi.waitFor(() => expect(h.service.busy).toBe(false)); expect(await readFile(join(h.directory, 'example.ts'), 'utf8')).toContain('2');
  });
  it.each(['forget', 'clear'] as const)('history %s cancels without saving or resurrecting removed conversations', async (operation) => {
    const h = await harness(); h.service.start(1, h.context.captureId, 'modify');
    await vi.waitFor(() => expect(h.latest().runs[0].steps[0]?.permission).toBeDefined());
    if (operation === 'forget') h.service.forget(h.context.conversationId); else h.service.clear();
    await vi.waitFor(() => expect(h.latest().runs[0].steps[0]?.state).not.toBe('tool_running'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(h.context.messages).toEqual([]); expect(await readFile(join(h.directory, 'example.ts'), 'utf8')).toContain('1');
    expect(h.service.snapshot(1, h.context).runs).toEqual([]);
  });
  it('closing the owning renderer aborts its task', async () => {
    const h = await harness(); h.service.start(1, h.context.captureId, 'modify');
    await vi.waitFor(() => expect(h.latest().runs[0].steps[0]?.permission).toBeDefined()); h.service.detach(1);
    await vi.waitFor(() => expect(h.service.busy).toBe(false)); expect(await readFile(join(h.directory, 'example.ts'), 'utf8')).toContain('1');
  });
});
