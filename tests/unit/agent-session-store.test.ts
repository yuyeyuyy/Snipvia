import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AgentSessionStore } from '../../src/main/agent/AgentSessionStore';
import { AgentExecutionService, type AgentUIContext } from '../../src/main/agent/ui/AgentExecutionService';
import { createFileToolSystem } from '../../src/main/agent/createFileToolSystem';
import type { AgentChatRequest, LLMProvider } from '../../src/main/ai/llm/LLMProvider';
import type { AgentChatResponse } from '../../src/shared/agent/message';

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
async function temporary() { const directory = await mkdtemp(join(tmpdir(), 'snipvia-agent-session-')); directories.push(directory); return directory; }

/** One app lifetime: a fresh service and tool system over the same userData session directory. */
async function launch(directory: string, context: AgentUIContext & { captureId: string }, responses: AgentChatResponse[]) {
  const system = createFileToolSystem({ prompt: async () => 'deny' });
  const requests: AgentChatRequest[] = [];
  const llm: LLMProvider = { id: 'mock', chat: vi.fn(async (request: AgentChatRequest) => { requests.push(structuredClone(request)); return responses.shift()!; }) };
  const store = new AgentSessionStore(join(directory, 'agent-sessions'));
  const service = new AgentExecutionService({ ...system, sessions: store, context: () => structuredClone(context), provider: () => llm, beforeStart: () => {},
    save: (_context, question, answer) => { context.messages.push({ role: 'user', content: question }, { role: 'assistant', content: answer }); } });
  const run = async (question: string) => {
    const snapshot = service.start(1, context.captureId, question);
    await vi.waitFor(() => { expect(service.snapshot(1, context).runs.at(-1)?.finished).toBe(true); });
    return snapshot;
  };
  return { service, store, requests, run };
}

describe('Agent 会话持久化', () => {
  it('重启后继续使用完整的工具调用历史；换成其他笔记本才清空', async () => {
    const directory = await temporary(); await writeFile(join(directory, '二分.md'), '# 二分\nleft = mid + 1\n');
    const notebook = { id: randomUUID(), name: '算法', directory };
    const context: AgentUIContext & { captureId: string } = { captureId: randomUUID(), conversationId: randomUUID(), image: 'data:image/jpeg;base64,test', messages: [], profile: { provider: 'custom', endpoint: 'https://example.com', model: 'test' } };
    const first = await launch(directory, context, [
      { content: '', finishReason: 'tool_calls', toolCalls: [{ id: 'read-1', name: 'read_file', arguments: JSON.stringify({ path: '二分.md' }) }] },
      { content: '笔记里写的是 left = mid + 1。', finishReason: 'stop' }
    ]);
    await first.service.selectNotebook(1, context.captureId, notebook);
    await first.run('我的二分笔记怎么写的？');

    const second = await launch(directory, context, [{ content: '上次读到的是 left = mid + 1。', finishReason: 'stop' }]);
    await second.service.selectNotebook(1, context.captureId, notebook);
    await second.run('刚才那条结论是什么？');
    const roles = second.requests[0].messages.map((message) => message.role);
    expect(roles).toEqual(['user', 'assistant', 'tool', 'assistant', 'user']);
    expect(JSON.stringify(second.requests[0].messages)).toContain('left = mid + 1');

    const third = await launch(directory, context, [{ content: '新的笔记本。', finishReason: 'stop' }]);
    await third.service.selectNotebook(1, context.captureId, { id: randomUUID(), name: '其他', directory });
    await third.run('换个笔记本');
    expect(third.requests[0].messages.map((message) => message.role)).not.toContain('tool');
  });

  it('删除对话时删除会话文件；损坏或不配对的历史被忽略', async () => {
    const directory = await temporary(); const store = new AgentSessionStore(join(directory, 'agent-sessions'));
    const id = randomUUID();
    store.save(id, { history: [{ role: 'user', content: '你好' }, { role: 'assistant', content: '你好！' }], syncedMessages: 2 });
    expect(store.load(id)).toMatchObject({ syncedMessages: 2, history: [{ role: 'user' }, { role: 'assistant' }] });
    store.save(id, { history: [{ role: 'user', content: 'x' }, { role: 'assistant', content: '', toolCalls: [{ id: 'orphan', name: 'read_file', arguments: '{}' }] }], syncedMessages: 1 });
    expect(store.load(id)).toBeUndefined(); // A tool call without its result cannot be replayed.
    await writeFile(join(directory, 'agent-sessions', `${id}.json`), '{broken');
    expect(store.load(id)).toBeUndefined();
    store.delete(id);
    expect(await readdir(join(directory, 'agent-sessions'))).toEqual([]);
    expect(() => store.load('../escape')).not.toThrow();
  });
});
