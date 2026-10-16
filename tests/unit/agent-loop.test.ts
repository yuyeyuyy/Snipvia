import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AgentLoop } from '../../src/main/agent/AgentLoop';
import { AgentRuntime } from '../../src/main/agent/AgentRuntime';
import { ContextManager } from '../../src/main/agent/ContextManager';
import { createFileToolSystem } from '../../src/main/agent/createFileToolSystem';
import { defineTool, ToolRegistry } from '../../src/main/agent/ToolRegistry';
import { ToolExecutor } from '../../src/main/agent/ToolExecutor';
import { ToolError } from '../../src/main/agent/ToolError';
import { WorkspaceService, type WorkspaceGrant } from '../../src/main/agent/WorkspaceService';
import type { AgentChatRequest, LLMProvider } from '../../src/main/ai/llm/LLMProvider';
import type { AgentChatResponse, AgentProviderEvent, AgentToolCall } from '../../src/shared/agent/message';
import type { AgentEvent, AgentLimits, AgentLogRecord } from '../../src/main/agent/types/agent';

let root: string;
let registry: ToolRegistry;
let executor: ToolExecutor;
let workspace: WorkspaceGrant;
let execute: ReturnType<typeof vi.fn<(input: { value: string }) => Promise<{ success: true; output: string }>>>;
let nextId = 0;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'snipvia-agent-loop-'));
  const workspaces = new WorkspaceService();
  workspace = await workspaces.authorizeWorkspace(root);
  registry = new ToolRegistry();
  execute = vi.fn(async (input) => ({ success: true, output: input.value }));
  registry.register(defineTool({ name: 'echo', description: 'Echo a test value', permission: 'workspace:read',
    schema: z.strictObject({ value: z.string() }), execute }));
  executor = new ToolExecutor(registry, workspaces);
});

afterEach(async () => {
  executor.cancelAll();
  vi.useRealTimers();
  await rm(root, { recursive: true, force: true });
});

const final = (content = '完成'): AgentChatResponse => ({ content, finishReason: 'stop', usage: { inputTokens: 30, outputTokens: 10 } });
const tool = (name = 'echo', args = '{"value":"hello"}'): AgentToolCall => ({ id: `call_${++nextId}`, name, arguments: args });
const calls = (...toolCalls: AgentToolCall[]): AgentChatResponse => ({ content: '调用工具', toolCalls, finishReason: 'tool_calls', usage: { inputTokens: 30, outputTokens: 10 } });

function provider(responses: Array<AgentChatResponse | ((request: AgentChatRequest) => Promise<AgentChatResponse>)>) {
  const chat = vi.fn(async (request: AgentChatRequest) => {
    const response = responses.shift();
    if (!response) throw new Error('unexpected provider call');
    return typeof response === 'function' ? response(request) : structuredClone(response);
  });
  return { id: 'test-provider', chat } satisfies LLMProvider;
}
function loop(llm: LLMProvider, limits?: Partial<AgentLimits>) { return new AgentLoop({ provider: llm, registry, executor }, { limits }); }

describe('AgentLoop core', () => {
  it('returns a normal answer without tools', async () => {
    const llm = provider([final('你好')]);
    const result = await loop(llm).run({ message: '打个招呼' });
    expect(result).toMatchObject({ status: 'completed', finalAnswer: '你好', steps: 1, toolCalls: 0, tokens: { input: 30, output: 10, estimated: false } });
    expect(result.messages.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(execute).not.toHaveBeenCalled();
  });

  it('executes one tool and adds its result before the next LLM turn', async () => {
    const call = tool();
    const llm = provider([calls(call), final()]);
    const result = await loop(llm).run({ message: '使用工具', workspace });
    expect(result).toMatchObject({ status: 'completed', steps: 2, toolCalls: 1 });
    expect(execute).toHaveBeenCalledOnce();
    expect(llm.chat.mock.calls[1][0].messages).toMatchObject([
      { role: 'user' }, { role: 'assistant', toolCalls: [call] }, { role: 'tool', toolCallId: call.id, name: 'echo' }
    ]);
    expect(JSON.parse(llm.chat.mock.calls[1][0].messages[2].content)).toMatchObject({ success: true, output: 'hello' });
  });

  it('supports multiple calls per response and consecutive tool turns, in sequence', async () => {
    const llm = provider([calls(tool('echo', '{"value":"one"}'), tool('echo', '{"value":"two"}')), calls(tool('echo', '{"value":"three"}')), final()]);
    const result = await loop(llm).run({ message: '连续执行', workspace });
    expect(result).toMatchObject({ status: 'completed', steps: 3, toolCalls: 3 });
    expect(execute.mock.calls.map(([input]) => input.value)).toEqual(['one', 'two', 'three']);
    expect(result.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'tool', 'tool', 'assistant', 'tool', 'assistant']);
    expect(() => new ContextManager().validateHistory(result.messages)).not.toThrow();
  });

  it('feeds a tool error back for model recovery', async () => {
    execute.mockRejectedValueOnce(new ToolError('IO_ERROR', '模拟读取失败'));
    const llm = provider([calls(tool()), calls(tool('echo', '{"value":"fixed"}')), final()]);
    const result = await loop(llm).run({ message: '错误恢复', workspace });
    expect(result.status).toBe('completed');
    expect(JSON.parse(llm.chat.mock.calls[1][0].messages[2].content)).toMatchObject({ success: false, error: { code: 'IO_ERROR' } });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('reports an unknown tool to the model without invoking another tool', async () => {
    const llm = provider([calls(tool('not_registered')), final('该工具不可用')]);
    const result = await loop(llm).run({ message: '未知工具', workspace });
    expect(result.status).toBe('completed');
    expect(JSON.parse(llm.chat.mock.calls[1][0].messages[2].content)).toMatchObject({ error: { code: 'TOOL_NOT_FOUND' } });
    expect(execute).not.toHaveBeenCalled();
  });

  it.each(['{broken', 'null', '[]', '{"value":1}', '{"value":"x","extra":true}'])('recovers from malformed args: %s', async (args) => {
    const llm = provider([calls(tool('echo', args)), final('请修正参数')]);
    expect((await loop(llm).run({ message: '参数错误', workspace })).status).toBe('completed');
    expect(JSON.parse(llm.chat.mock.calls[1][0].messages[2].content)).toMatchObject({ error: { code: 'INVALID_INPUT' } });
    expect(execute).not.toHaveBeenCalled();
  });

  it('stops at maxSteps with a user-facing reason and preserves matched tool results', async () => {
    const llm = provider([calls(tool()), calls(tool()), final('不应调用')]);
    const result = await loop(llm, { maxSteps: 2 }).run({ message: '达到上限', workspace });
    expect(result).toMatchObject({ status: 'limit_reached', error: { code: 'MAX_STEPS' }, steps: 2, toolCalls: 2 });
    expect(result.message).toContain('最大执行步骤（2）');
    expect(llm.chat).toHaveBeenCalledTimes(2);
    expect(() => new ContextManager().validateHistory(result.messages)).not.toThrow();
  });

  it('allows a final answer on the last permitted step', async () => {
    expect((await loop(provider([final()]), { maxSteps: 1 }).run({ message: 'hello' })).status).toBe('completed');
  });

  it('keeps going after consecutive tool failures and lets the model recover', async () => {
    const llm = provider([calls(tool('unknown'), tool('unknown'), tool('unknown'), tool()), calls(tool('unknown'), tool()), final('已改用其他方式完成')]);
    const result = await loop(llm).run({ message: '连续失败', workspace });
    expect(result).toMatchObject({ status: 'completed', finalAnswer: '已改用其他方式完成', toolCalls: 6 });
    expect(llm.chat).toHaveBeenCalledTimes(3);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(result.messages.filter((message) => message.role === 'tool')).toHaveLength(6);
    expect(() => new ContextManager().validateHistory(result.messages)).not.toThrow();
  });

  it.each([{ maxToolCalls: 1 }, { maxToolCallsPerStep: 1 }])('enforces tool call budgets before a batch: %o', async (limits) => {
    const result = await loop(provider([calls(tool(), tool())]), limits).run({ message: '限制', workspace });
    expect(result).toMatchObject({ status: 'limit_reached', error: { code: 'MAX_TOOL_CALLS' }, toolCalls: 0 });
    expect(execute).not.toHaveBeenCalled();
    expect(() => new ContextManager().validateHistory(result.messages)).not.toThrow();
  });

  it('blocks duplicate call IDs to avoid repeating writes', async () => {
    const repeated = tool();
    const result = await loop(provider([calls(repeated), calls(repeated)])).run({ message: '重复ID', workspace });
    expect(result).toMatchObject({ status: 'failed', error: { code: 'LLM_INVALID_RESPONSE' } });
    expect(execute).toHaveBeenCalledOnce();
  });

  it('rejects incomplete or duplicate tool-call history before calling the provider', async () => {
    const llm = provider([final()]);
    const result = await loop(llm).run({ message: '继续', history: [
      { role: 'user', content: 'previous' }, { role: 'assistant', content: '', toolCalls: [tool()] }
    ] });
    expect(result).toMatchObject({ error: { code: 'INVALID_HISTORY' } });
    expect(llm.chat).not.toHaveBeenCalled();
  });
});

describe('cancellation, timeout and streaming', () => {
  it('handles pre-abort without making a request', async () => {
    const llm = provider([final()]);
    expect(await loop(llm).run({ message: 'cancel', signal: AbortSignal.abort() })).toMatchObject({ status: 'cancelled', steps: 0 });
    expect(llm.chat).not.toHaveBeenCalled();
  });

  it('cancels an uncooperative LLM request and aborts its signal', async () => {
    const abort = new AbortController();
    let started: () => void = () => {};
    const ready = new Promise<void>((resolve) => { started = resolve; });
    const llm = provider([async () => { started(); return new Promise(() => {}); }]);
    const running = loop(llm).run({ message: 'cancel', signal: abort.signal });
    await ready;
    abort.abort();
    expect(await running).toMatchObject({ status: 'cancelled' });
    expect(llm.chat.mock.calls[0][0].signal.aborted).toBe(true);
  });

  it('enforces an LLM timeout and removes its timer', async () => {
    vi.useFakeTimers();
    const llm = provider([async () => new Promise(() => {})]);
    const running = loop(llm, { llmTimeoutMs: 50 }).run({ message: 'timeout' });
    await vi.advanceTimersByTimeAsync(50);
    expect(await running).toMatchObject({ status: 'failed', error: { code: 'LLM_TIMEOUT' }, tokens: { estimated: true } });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('feeds tool timeout back to the model for recovery', async () => {
    vi.useFakeTimers();
    execute.mockImplementationOnce(async () => new Promise(() => {}));
    const llm = provider([calls(tool()), final('工具超时')]);
    const running = loop(llm, { toolTimeoutMs: 20 }).run({ message: 'timeout', workspace });
    await vi.advanceTimersByTimeAsync(20);
    expect(await running).toMatchObject({ status: 'completed' });
    expect(JSON.parse(llm.chat.mock.calls[1][0].messages[2].content)).toMatchObject({ error: { code: 'TIMEOUT' } });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels a multi-call batch and pairs remaining calls with skipped results', async () => {
    const abort = new AbortController();
    const llm = provider([calls(tool(), tool()), final()]);
    const result = await loop(llm).run({ message: 'cancel batch', workspace, signal: abort.signal }, {
      onEvent: (event) => { if (event.type === 'tool_started') abort.abort(); }
    });
    expect(result.status).toBe('cancelled');
    expect(llm.chat).toHaveBeenCalledOnce();
    expect(execute).not.toHaveBeenCalled();
    expect(result.messages.filter((message) => message.role === 'tool')).toHaveLength(2);
    expect(() => new ContextManager().validateHistory(result.messages)).not.toThrow();
  });

  it('retains an actual committed tool outcome when cancellation arrives during execution', async () => {
    const abort = new AbortController();
    const dispatch = vi.spyOn(executor, 'execute').mockImplementationOnce(async () => {
      abort.abort();
      return { success: true, output: { committed: true, undoId: 'recorded' } };
    });
    const result = await loop(provider([calls(tool(), tool())])).run({ message: 'cancel after commit', workspace, signal: abort.signal });
    expect(result.status).toBe('cancelled');
    const outputs = result.messages.filter((message) => message.role === 'tool').map((message) => JSON.parse(message.content));
    expect(outputs[0]).toMatchObject({ success: true, output: { committed: true, undoId: 'recorded' } });
    expect(outputs[1]).toMatchObject({ success: false, error: { code: 'ABORTED' } });
    // Both read-only calls start together; the second observes the cancellation and does nothing.
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(execute).not.toHaveBeenCalled();
    dispatch.mockRestore();
  });

  it('runs adjacent read-only calls concurrently and keeps results in call order', async () => {
    let started = 0; let release!: () => void; const both = new Promise<void>((resolve) => { release = resolve; });
    execute.mockImplementation(async (input) => {
      if (++started === 2) release();
      await both; // Deadlocks (and times out) if the calls ran one after another.
      return { success: true, output: input.value };
    });
    const first = tool('echo', '{"value":"一"}'), second = tool('echo', '{"value":"二"}');
    const result = await loop(provider([calls(first, second), final()])).run({ message: 'parallel', workspace });
    expect(result.status).toBe('completed');
    const outputs = result.messages.filter((message) => message.role === 'tool');
    expect(outputs.map((message) => message.role === 'tool' && message.toolCallId)).toEqual([first.id, second.id]);
    expect(outputs.map((message) => JSON.parse(message.content).output)).toEqual(['一', '二']);
  });

  it('streams text and fragmented call args but only executes a completed turn', async () => {
    const call = tool();
    let turns = 0;
    const llm: LLMProvider = {
      id: 'stream-test', chat: vi.fn(),
      async *stream() {
        if (++turns === 1) {
          yield { type: 'text_delta', text: '准备调用' };
          yield { type: 'tool_call_delta', index: 0, id: call.id, name: call.name, argumentsDelta: '{"value":' };
          expect(execute).not.toHaveBeenCalled();
          yield { type: 'tool_call_delta', index: 0, argumentsDelta: '"hello"}' };
          expect(execute).not.toHaveBeenCalled();
          yield { type: 'complete', response: calls(call) };
        } else {
          yield { type: 'text_delta', text: '完' };
          yield { type: 'text_delta', text: '成' };
          yield { type: 'complete', response: final() };
        }
      }
    };
    const events: AgentEvent[] = [];
    expect(await loop(llm).run({ message: 'stream', workspace }, { onEvent: (event) => { events.push(event); } })).toMatchObject({ status: 'completed' });
    expect(llm.chat).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledOnce();
    expect(events.filter((event) => event.type === 'assistant_delta').map((event) => event.text)).toEqual(['准备调用', '完', '成']);
  });

  it.each(['eof', 'length', 'blocked', 'after_complete'] as const)('never executes partial or abnormal stream output: %s', async (scenario) => {
    const call = tool();
    const llm: LLMProvider = { id: 'bad-stream', chat: vi.fn(), async *stream() {
      yield { type: 'tool_call_delta', index: 0, id: call.id, name: call.name, argumentsDelta: call.arguments };
      if (scenario !== 'eof') yield { type: 'complete', response: { ...calls(call), finishReason: scenario === 'after_complete' ? 'tool_calls' : scenario } };
      if (scenario === 'after_complete') yield { type: 'text_delta', text: 'unexpected' };
    } };
    expect((await loop(llm).run({ message: 'bad stream', workspace })).status).not.toBe('completed');
    expect(execute).not.toHaveBeenCalled();
  });

  it('ignores late chunks and closes a stalled iterator after cancellation', async () => {
    const abort = new AbortController();
    let deliver: (value: IteratorResult<AgentProviderEvent>) => void = () => {};
    let started: () => void = () => {};
    const ready = new Promise<void>((resolve) => { started = resolve; });
    const close = vi.fn(async () => ({ done: true as const, value: undefined }));
    const llm: LLMProvider = { id: 'stalled', chat: vi.fn(), stream: () => ({ [Symbol.asyncIterator]: () => ({
      next: async () => { started(); return new Promise((resolve) => { deliver = resolve; }); }, return: close
    }) }) };
    const events: AgentEvent[] = [];
    const running = loop(llm).run({ message: 'cancel', signal: abort.signal }, { onEvent: (event) => { events.push(event); } });
    await ready;
    abort.abort();
    expect((await running).status).toBe('cancelled');
    const count = events.length;
    deliver({ done: false, value: { type: 'text_delta', text: 'late' } });
    await Promise.resolve();
    expect(events).toHaveLength(count);
    expect(close).toHaveBeenCalledOnce();
  });
});

describe('context, budgets, events and runtime', () => {
  it('summarizes older turns instead of dropping them, without resending the screenshot', async () => {
    const oldCall = tool();
    const history = [
      { role: 'user' as const, content: '整理二分查找' }, { role: 'assistant' as const, content: '', toolCalls: [oldCall] },
      { role: 'tool' as const, toolCallId: oldCall.id, name: oldCall.name, content: '{"success":true,"output":"old"}' },
      { role: 'assistant' as const, content: '已写入 算法/二分.md' }
    ];
    const llm = { ...provider([{ content: '用户在整理二分查找，已写入 算法/二分.md。', finishReason: 'stop' }, final()]),
      countInputTokens: (context: { messages: unknown[] }) => context.messages.length * 120 };
    const events: AgentEvent[] = [];
    const result = await loop(llm, { maxContextTokens: 512, maxOutputTokens: 64, contextReserveTokens: 32 }).run({ message: 'current', history }, { onEvent: (event) => { events.push(event); } });
    expect(result.status).toBe('completed');
    const [summaryRequest, mainRequest] = llm.chat.mock.calls.map((call) => call[0]);
    expect(summaryRequest).toMatchObject({ tools: [], attachImage: false });
    expect(summaryRequest.messages[0].content).toContain('整理二分查找');
    expect(mainRequest.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'user']);
    expect(mainRequest.messages[0].content).toContain('已写入 算法/二分.md');
    expect(events.filter((event) => event.type.startsWith('context_compact')).map((event) => event.type)).toEqual(['context_compacting', 'context_compacted']);
    // The compacted transcript is what the session keeps, so later runs do not re-summarize.
    expect(result.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(() => new ContextManager().validateHistory(result.messages)).not.toThrow();
  });

  it('falls back to evicting whole old turns when the summary request fails', async () => {
    const oldCall = tool();
    let calls = 0;
    const llm = { id: 'summary-fails', chat: vi.fn(async () => { if (++calls === 1) throw new Error('summary failed'); return final(); }),
      countInputTokens: (context: { messages: unknown[] }) => context.messages.length * 200 };
    const result = await loop(llm, { maxContextTokens: 512, maxOutputTokens: 64, contextReserveTokens: 32 }).run({ message: 'current', history: [
      { role: 'user', content: 'old' }, { role: 'assistant', content: '', toolCalls: [oldCall] },
      { role: 'tool', toolCallId: oldCall.id, name: oldCall.name, content: '{"success":true,"output":"old"}' },
      { role: 'assistant', content: 'old final' }
    ] });
    expect(result.status).toBe('completed');
    expect((llm.chat.mock.calls as unknown as Array<[{ messages: unknown[] }]>)[1][0].messages).toEqual([{ role: 'user', content: 'current' }]);
    expect(result.messages).toHaveLength(6); // Compaction does not destroy the transcript.
  });

  it('keeps a truncated final answer instead of discarding text the user already saw', async () => {
    const llm = provider([{ content: '很长的解释', finishReason: 'length', usage: { inputTokens: 10, outputTokens: 8192 } }]);
    const result = await loop(llm).run({ message: '解释' });
    expect(result).toMatchObject({ status: 'completed' });
    expect(result.finalAnswer).toMatch(/^很长的解释[\s\S]*输出长度上限/);
    expect(result.messages.at(-1)).toMatchObject({ role: 'assistant' });
  });

  it('never rejects a complete answer because of an estimated output count', async () => {
    const llm = provider([{ content: '解'.repeat(3000), finishReason: 'stop' }]);
    expect(await loop(llm).run({ message: '长回答' })).toMatchObject({ status: 'completed', tokens: { estimated: true } });
  });

  it('prunes old tool results before failing, keeping the latest three intact', async () => {
    const llm = { ...provider([calls(tool()), calls(tool()), calls(tool()), calls(tool()), calls(tool()), final()]),
      countInputTokens: (context: { messages: Array<{ role: string; content: string }> }) => context.messages.filter((message) => message.role === 'tool' && !message.content.includes('pruned')).length * 120 + 40 };
    const events: AgentEvent[] = [];
    const result = await loop(llm, { maxContextTokens: 512, maxOutputTokens: 64, contextReserveTokens: 0 }).run({ message: 'research', workspace }, { onEvent: (event) => { events.push(event); } });
    expect(result.status).toBe('completed');
    const last = llm.chat.mock.calls.at(-1)![0].messages.filter((message) => message.role === 'tool');
    expect(last).toHaveLength(5);
    expect(last.filter((message) => 'content' in message && message.content.includes('pruned'))).toHaveLength(2);
    expect(events.some((event) => event.type === 'context_prepared' && event.prunedResults > 0)).toBe(true);
    expect(result.messages.filter((message) => message.role === 'tool' && message.content.includes('pruned'))).toHaveLength(0);
  });

  it('runs todo_write inside the loop and reports the plan as an event', async () => {
    const plan = { id: 'plan-1', name: 'todo_write', arguments: JSON.stringify({ todos: [{ content: '搜索', status: 'in_progress' }, { content: '记录', status: 'pending' }] }) };
    const invalid = { id: 'plan-2', name: 'todo_write', arguments: JSON.stringify({ todos: [{ content: 'a', status: 'in_progress' }, { content: 'b', status: 'in_progress' }] }) };
    const llm = provider([calls(plan), calls(invalid), final()]);
    const events: AgentEvent[] = [];
    const result = await loop(llm).run({ message: 'plan' }, { onEvent: (event) => { events.push(event); } });
    expect(result.status).toBe('completed');
    expect(llm.chat.mock.calls[0][0].tools.map((tool) => tool.name)).toContain('todo_write');
    expect(events.filter((event) => event.type === 'todo_updated')).toEqual([expect.objectContaining({ callId: 'plan-1', todos: [{ content: '搜索', status: 'in_progress' }, { content: '记录', status: 'pending' }] })]);
    expect(JSON.parse(String(result.messages.find((message) => message.role === 'tool' && message.toolCallId === 'plan-2')!.content))).toMatchObject({ success: false, error: { code: 'INVALID_INPUT' } });
    expect(execute).not.toHaveBeenCalled();
  });

  it('stops before LLM when the active task alone exceeds context or total token budget', async () => {
    const llm = { ...provider([final()]), countInputTokens: () => 500 };
    expect(await loop(llm, { maxContextTokens: 512, maxOutputTokens: 64, contextReserveTokens: 0 }).run({ message: 'large' })).toMatchObject({ error: { code: 'CONTEXT_LIMIT' } });
    expect(await loop(llm, { maxTotalTokens: 512 }).run({ message: 'large' })).toMatchObject({ error: { code: 'TOKEN_LIMIT' } });
    expect(llm.chat).not.toHaveBeenCalled();
  });

  it('does not drop the current turn to continue after its tool context grows too large', async () => {
    const llm = { ...provider([calls(tool()), final()]), countInputTokens: (context: { messages: unknown[] }) => context.messages.length * 200 };
    const result = await loop(llm, { maxContextTokens: 512, maxOutputTokens: 64, contextReserveTokens: 32 })
      .run({ message: 'active task', workspace });
    expect(result).toMatchObject({ error: { code: 'CONTEXT_LIMIT' } });
    expect(llm.chat).toHaveBeenCalledOnce();
    expect(result.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'tool']);
  });

  it('stops before executing a call when reported tokens exceed the remaining run budget', async () => {
    const llm = { ...provider([{ ...calls(tool()), usage: { inputTokens: 100, outputTokens: 100 } }]), countInputTokens: () => 10 };
    expect(await loop(llm, { maxTotalTokens: 128 }).run({ message: 'budget', workspace })).toMatchObject({ error: { code: 'TOKEN_LIMIT' } });
    expect(execute).not.toHaveBeenCalled();
  });

  it('bounds large tool feedback and explicitly marks truncation', async () => {
    execute.mockResolvedValueOnce({ success: true, output: 'x'.repeat(30_000) });
    const llm = provider([calls(tool()), final()]);
    expect((await loop(llm, { maxToolResultBytes: 512 }).run({ message: 'large result', workspace })).status).toBe('completed');
    const feedback = llm.chat.mock.calls[1][0].messages[2].content;
    expect(Buffer.byteLength(feedback)).toBeLessThanOrEqual(512);
    expect(JSON.parse(feedback)).toMatchObject({ success: true, output: { truncated: true } });
  });

  it('emits ordered correlated events and keeps logs free of prompts and results', async () => {
    const logs: AgentLogRecord[] = [];
    const events: AgentEvent[] = [];
    const llm = provider([calls(tool('echo', '{"value":"PRIVATE_TOOL_TEXT"}')), final('PRIVATE_ANSWER')]);
    const agent = new AgentLoop({ provider: llm, registry, executor }, { logger: { log: (record) => { logs.push(record); } } });
    const result = await agent.run({ message: 'PRIVATE_USER_TEXT', workspace }, { onEvent: (event) => {
      events.push(event);
      if (event.type === 'llm_completed' && event.response.toolCalls) event.response.toolCalls[0].name = 'tampered_observer';
    } });
    expect(result.status).toBe('completed');
    expect(execute).toHaveBeenCalledOnce();
    expect(events.map((event) => event.sequence)).toEqual(events.map((_event, index) => index + 1));
    expect(new Set(events.map((event) => event.runId))).toEqual(new Set([result.runId]));
    expect(events.at(-1)?.type).toBe('run_finished');
    expect(JSON.stringify(logs)).not.toContain('PRIVATE_');
    expect(JSON.stringify(logs)).not.toContain('arguments');
  });

  it('isolates observer/logger errors and redacts provider exception details', async () => {
    const llm = provider([async () => { throw new Error('API_KEY=private /private/file'); }]);
    const result = await new AgentLoop({ provider: llm, registry, executor }, { logger: { log: async () => { throw new Error('logger'); } } })
      .run({ message: 'hello' }, { onEvent: () => { throw new Error('observer'); } });
    expect(result).toMatchObject({ status: 'failed', error: { code: 'LLM_ERROR' } });
    expect(JSON.stringify(result)).not.toContain('API_KEY');
  });

  it('marks fallback token estimates and rejects invalid limit configuration', async () => {
    const result = await loop(provider([{ content: 'answer', finishReason: 'stop' }])).run({ message: 'hello' });
    expect(result.tokens.estimated).toBe(true);
    expect(result.tokens.input).toBeGreaterThan(0);
    expect(() => loop(provider([]), { maxSteps: 0 })).toThrow();
    expect(() => loop(provider([]), { toolTimeoutMs: 20_000 })).toThrow();
  });

  it('keeps independent runtime runs and cancellation isolated', async () => {
    const llm: LLMProvider = { id: 'runtime', chat: async (request) => request.messages.at(-1)?.content === 'wait' ? new Promise(() => {}) : final('fast') };
    const runtime = new AgentRuntime(loop(llm));
    const slow = runtime.start({ message: 'wait' });
    const fast = runtime.start({ message: 'fast' });
    expect((await fast.result).status).toBe('completed');
    slow.cancel();
    expect((await slow.result).status).toBe('cancelled');
    expect(runtime.getSnapshot(fast.runId)).toMatchObject({ status: 'completed', result: { finalAnswer: 'fast' } });
    const snapshot = runtime.getSnapshot(fast.runId)!;
    snapshot.status = 'failed';
    expect(runtime.getSnapshot(fast.runId)?.status).toBe('completed');
  });

  it('preserves the existing write approval path and feeds rejection back to the model', async () => {
    const file = path.join(root, 'note.txt');
    await writeFile(file, 'original');
    const approve = vi.fn(async () => 'reject' as const);
    const files = createFileToolSystem(approve);
    const grant = await files.workspaces.authorizeWorkspace(root);
    const llm = provider([calls(tool('write_file', '{"path":"note.txt","content":"new"}')), final('已取消修改')]);
    const result = await new AgentLoop({ provider: llm, registry: files.registry, executor: files.executor }).run({ message: '修改文件', workspace: grant });
    expect(result.status).toBe('completed');
    expect(approve).toHaveBeenCalledOnce();
    expect(await readFile(file, 'utf8')).toBe('original');
    expect(JSON.parse(llm.chat.mock.calls[1][0].messages[2].content)).toMatchObject({ error: { code: 'APPROVAL_DENIED' } });
  });
});

describe('Agent permission events', () => {
  it('pauses before write, emits a correlated request, and resumes the model only after approval', async () => {
    await writeFile(path.join(root, 'permission.txt'), 'before');
    let decide!: (decision: 'allow_once') => void;
    const prompt = vi.fn(async () => new Promise<'allow_once'>((resolve) => { decide = resolve; }));
    const files = createFileToolSystem({ prompt });
    const grant = await files.workspaces.authorizeWorkspace(root);
    const llm = provider([calls(tool('write_file', '{"path":"permission.txt","content":"after"}')), async (request) => {
      expect(await readFile(path.join(root, 'permission.txt'), 'utf8')).toBe('after');
      expect(request.messages.at(-1)).toMatchObject({ role: 'tool' });
      return final();
    }]);
    const events: AgentEvent[] = [];
    const running = new AgentLoop({ provider: llm, registry: files.registry, executor: files.executor }).run({ message: 'write', workspace: grant }, {
      runId: 'permission_run', onEvent: (event) => { events.push(event); }
    });
    await vi.waitFor(() => expect(prompt).toHaveBeenCalled());
    expect(llm.chat).toHaveBeenCalledTimes(1);
    expect(await readFile(path.join(root, 'permission.txt'), 'utf8')).toBe('before');
    const requested = events.find((event) => event.type === 'permission_request');
    expect(requested).toMatchObject({ runId: 'permission_run', step: 1, request: { toolCallId: 'permission_run:1:0', risk: 'REVIEW', allowedDecisions: ['allow_once', 'allow_session', 'deny'] } });
    decide('allow_once');
    expect(await running).toMatchObject({ status: 'completed' });
    expect(events.find((event) => event.type === 'permission_resolved')).toMatchObject({ runId: 'permission_run', outcome: 'allow_once' });
  });

  it('runtime cancellation while awaiting permission never writes or makes another LLM request', async () => {
    await writeFile(path.join(root, 'permission.txt'), 'before');
    const prompt = vi.fn(async () => new Promise<'allow_once'>(() => {}));
    const files = createFileToolSystem({ prompt }); const grant = await files.workspaces.authorizeWorkspace(root);
    const llm = provider([calls(tool('write_file', '{"path":"permission.txt","content":"after"}'))]);
    const runtime = new AgentRuntime(new AgentLoop({ provider: llm, registry: files.registry, executor: files.executor }));
    const running = runtime.start({ message: 'write', workspace: grant });
    await vi.waitFor(() => expect(prompt).toHaveBeenCalled()); running.cancel();
    expect(await running.result).toMatchObject({ status: 'cancelled' });
    expect(llm.chat).toHaveBeenCalledTimes(1);
    expect(await readFile(path.join(root, 'permission.txt'), 'utf8')).toBe('before');
  });
});
