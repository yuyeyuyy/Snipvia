import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { AgentExecutionService, type AgentUIContext } from '../../src/main/agent/ui/AgentExecutionService';
import { createFileToolSystem } from '../../src/main/agent/createFileToolSystem';
import type { AgentChatRequest, LLMProvider } from '../../src/main/ai/llm/LLMProvider';
import { agentWorkspaceSchema, agentWorkspaceStartSchema, agentNoteChangeSchema } from '../../src/shared/agent/execution';

const services: AgentExecutionService[] = [];
afterEach(() => { for (const service of services.splice(0)) service.clear(); });
function workspace(provider?: LLMProvider) {
  const contexts: AgentUIContext[] = [0, 1].map(() => ({ conversationId: randomUUID(), readOnly: true, messages: [], profile: { provider: 'custom', endpoint: 'https://example.test', model: 'test' } }));
  const requests: AgentChatRequest[] = []; const save = vi.fn((context: AgentUIContext, question: string, answer: string) => {
    const target = contexts.find(item => item.conversationId === context.conversationId)!;
    target.messages = [...(context.regenerate ? target.messages.slice(0, -2) : target.messages), { role: 'user', content: question }, { role: 'assistant', content: answer }];
  });
  const system = createFileToolSystem({ readOnly: true, prompt: async () => 'deny' });
  const service = new AgentExecutionService({ ...system, context: target => {
    if (typeof target === 'string') throw new Error('no active screenshot');
    const context = contexts.find(context => context.conversationId === target.conversationId);
    if (!context) throw new Error('deleted'); return structuredClone(context);
  }, provider: () => provider ?? { id: 'mock', chat: async request => { requests.push(request); return { content: '回答', finishReason: 'stop' }; } }, beforeStart: () => {}, save });
  services.push(service);
  const target = { conversationId: contexts[0].conversationId };
  return { service, contexts, target, requests, save, done: () => vi.waitFor(() => expect(service.busy).toBe(false)) };
}

describe('AI workspace conversation orchestration', () => {
  it('validates Main-only request shapes without accepting capabilities from Renderer', () => {
    expect(agentNoteChangeSchema.safeParse({ conversationId: randomUUID(), captureId: randomUUID(), changeId: randomUUID() }).success).toBe(false);
    expect(agentWorkspaceSchema.safeParse({ conversationId: randomUUID(), captureId: randomUUID() }).success).toBe(false);
    expect(agentWorkspaceStartSchema.safeParse({ conversationId: randomUUID(), question: 'question', readOnly: false }).success).toBe(false);
    expect(agentWorkspaceStartSchema.safeParse({ conversationId: 'invalid', question: 'question' }).success).toBe(false);
  });
  it('starts a text conversation without a capture, key store or second runtime', async () => {
    const h = workspace(); const value = h.service.start(1, h.target, '你好'); await h.done();
    expect(value.conversationId).toBe(h.target.conversationId); expect(value.captureId).toBeUndefined();
    expect(h.requests[0].messages).toEqual([{ role: 'user', content: '你好' }]);
    expect(h.requests[0].tools.map(tool => tool.permission)).not.toContain('workspace:execute');
    expect(h.requests[0].tools.map(tool => tool.permission)).not.toContain('notebook:write');
    expect(h.requests[0].tools.map(tool => tool.name)).not.toContain('read_file');
    expect(h.contexts[0].messages).toHaveLength(2);
  });
  it('keeps older text turns available without replaying legacy notebook tool results', async () => {
    const h = workspace();
    h.contexts[0].messages = Array.from({ length: 10 }, (_, index) => [{ role: 'user' as const, content: `问题 ${index}` }, { role: 'assistant' as const, content: `回答 ${index}` }]).flat();
    h.service.start(1, h.target, '继续'); await h.done();
    expect(h.requests[0].messages[0].content).toBe('问题 0'); expect(h.requests[0].messages).toHaveLength(21);
  });
  it('never executes a model-requested file operation in a workspace answer', async () => {
    let call = 0; const requests: AgentChatRequest[] = [];
    const h = workspace({ id: 'malicious', chat: async request => {
      requests.push(request); return call++ ? { content: '工具不可用', finishReason: 'stop' } : { content: '', finishReason: 'tool_calls', toolCalls: [{ id: 'write', name: 'write_note', arguments: '{"path":"secret.md","content":"overwrite"}' }] };
    } });
    h.service.start(1, h.target, '写入'); await h.done();
    expect(requests[1].messages.at(-1)).toMatchObject({ role: 'tool', content: expect.stringContaining('TOOL_NOT_FOUND') });
    expect(h.service.snapshot(1, h.contexts[0]).runs[0].noteChanges).toBeUndefined();
  });
  it('switching the subscriber preserves the running conversation and keeps transcripts isolated', async () => {
    let resolve!: () => void; const gate = new Promise<void>(done => { resolve = done; });
    const h = workspace({ id: 'slow', chat: async () => { await gate; return { content: '第一条回答', finishReason: 'stop' }; } });
    h.service.subscribe(1, h.target, () => {}); h.service.start(1, h.target, '第一条问题');
    const other = h.service.subscribe(1, { conversationId: h.contexts[1].conversationId }, () => {});
    expect(other.runs).toEqual([]); expect(h.service.busy).toBe(true);
    resolve(); await h.done();
    expect(h.contexts[1].messages).toEqual([]); expect(h.contexts[0].messages.at(-1)?.content).toBe('第一条回答');
    expect(h.service.subscribe(1, h.target, () => {}).runs[0].finished).toBe(true);
  });
  it('regeneration excludes the previous pair from input and refuses another question', async () => {
    const h = workspace(); h.contexts[0].messages = [{ role: 'user', content: '原问题' }, { role: 'assistant', content: '原回答' }];
    expect(() => h.service.start(1, h.target, '其他问题', '其他问题', true)).toThrow('只能重新生成');
    h.service.start(1, h.target, '原问题', '原问题', true); await h.done();
    expect(h.requests[0].messages).toEqual([{ role: 'user', content: '原问题' }]);
    expect(h.contexts[0].messages).toHaveLength(2); expect(h.save.mock.calls[0][0].originalMessages?.at(-1)?.content).toBe('原回答');
  });
  it('failed regeneration preserves the original answer; stopping a stream saves visible partial text', async () => {
    const failed = workspace({ id: 'bad', chat: async () => { throw new Error('network failure'); } });
    failed.contexts[0].messages = [{ role: 'user', content: '问题' }, { role: 'assistant', content: '原回答' }];
    failed.service.start(1, failed.target, '问题', '问题', true); await failed.done();
    expect(failed.save).not.toHaveBeenCalled(); expect(failed.contexts[0].messages.at(-1)?.content).toBe('原回答');
    const h = workspace({ id: 'stream', chat: async () => { throw new Error('use stream'); }, async *stream() {
      yield { type: 'text_delta', text: '已生成部分' }; await new Promise(() => {});
    } });
    const first = h.service.start(1, h.target, '慢请求');
    await vi.waitFor(() => expect(h.service.snapshot(1, h.contexts[0]).runs[0].answer).toBe('已生成部分'));
    expect(() => h.service.stop(2, h.target, first.runs[0].runId)).toThrow();
    h.service.stop(1, h.target, first.runs[0].runId); await h.done();
    expect(h.contexts[0].messages.at(-1)?.content).toContain('已生成部分');
    expect(h.contexts[0].messages.at(-1)?.content).toMatch(/已停止|用户取消/);
  });
});
