import { describe, expect, it, vi } from 'vitest';
import { ChatCompletionsAgentProvider } from '../../src/main/ai/llm/ChatCompletionsAgentProvider';
import type { AgentChatRequest } from '../../src/main/ai/llm/LLMProvider';
import { providerTurn } from '../../src/main/agent/ProviderTurn';
import { VisibleTextStream } from '../../src/main/ai/llm/VisibleTextStream';
import { providerFor } from '../../src/shared/providers';

const settings = { provider: 'custom' as const, endpoint: 'http://127.0.0.1:5555/v1', model: 'mock' };
const request = (): AgentChatRequest => ({ system: 'System', messages: [{ role: 'user', content: 'Task' }], tools: [], signal: new AbortController().signal, maxOutputTokens: 2048 });
function sse(events: unknown[], done = true) { return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') + (done ? 'data: [DONE]\n\n' : ''), { headers: { 'Content-Type': 'text/event-stream' } }); }
describe('configured Agent model adapter', () => {
  it('does not send an unauthenticated request when a hosted model has no configured key', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const provider = new ChatCompletionsAgentProvider({ provider: 'openai', endpoint: 'https://api.openai.com/v1', model: 'synthetic-model' }, '', undefined, fetcher);
    await expect(provider.chat(request())).rejects.toThrow('模型与设置');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('maps multiple current and historical pictures to their own turns, excludes summaries and releases buffers', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ choices: [{ message: { content: 'done' }, finish_reason: 'stop' }] }));
    const provider = new ChatCompletionsAgentProvider(settings, 'test-key', undefined, fetcher, { current: ['data:image/png;base64,CURRENT_A', 'data:image/png;base64,CURRENT_B'], history: new Map([['old-id', 'data:image/png;base64,OLD']]) });
    const task = request(); task.messages = [{ role: 'user', content: '以前', imageIds: ['old-id'] }, { role: 'assistant', content: '答复' }, { role: 'user', content: '这次比较' }];
    const multimodalCount = provider.countInputTokens(task); await provider.chat(task);
    const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body)); expect(body.messages[1].content[1].image_url.url).toContain('OLD'); expect(body.messages[3].content).toHaveLength(3);
    task.attachImage = false; await provider.chat(task); expect(String(fetcher.mock.calls[1][1]?.body)).not.toContain('data:image');
    task.attachImage = true; provider.dispose(); expect(provider.countInputTokens(task)).toBeLessThan(multimodalCount);
  });
  it.each([[401, 'authentication_error', '鉴权'], [402, 'insufficient_quota', '额度'], [429, 'rate_limit', '限流'], [400, 'unsupported image input', '明确拒绝'], [400, 'invalid parameter', '不能据此']])('classifies image HTTP %s without exposing reflected keys or payloads', async (status, diagnostic, expected) => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ error: `${diagnostic} PRIVATE_KEY data:image/png;base64,PRIVATE_IMAGE` }), { status: Number(status) }));
    const provider = new ChatCompletionsAgentProvider(settings, 'test-key', 'data:image/png;base64,synthetic', fetcher);
    await expect(provider.chat(request())).rejects.toThrow(String(expected));
    try { await provider.chat(request()); } catch (error) { expect(String(error)).not.toContain('PRIVATE'); }
  });
  it.each(['deepseek', 'kimi', 'zhipu', 'doubao', 'siliconflow', 'openrouter'] as const)('%s 支持图片与多轮工具调用，厂商鉴权不进入消息', async (id) => {
    const preset = providerFor(id);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(sse([{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-1', function: { name: 'read_file', arguments: '{"path":"note.md"}' } }] }, finish_reason: 'tool_calls' }] }]))
      .mockResolvedValueOnce(sse([{ choices: [{ delta: { content: '已读取笔记' }, finish_reason: 'stop' }] }]));
    const provider = new ChatCompletionsAgentProvider({ provider: id, endpoint: preset.endpoint, model: preset.models[0].id }, 'synthetic-agent-key', 'data:image/jpeg;base64,fixture', fetcher);
    const task = request(); task.tools = [{ name: 'read_file', description: 'read', permission: 'workspace:read', inputSchema: { type: 'object', properties: { path: { type: 'string' } } } }];
    const first = await provider.chat(task);
    task.messages.push({ role: 'assistant', content: '', toolCalls: first.toolCalls }, { role: 'tool', toolCallId: 'call-1', name: 'read_file', content: 'synthetic note content' });
    expect(await provider.chat(task)).toMatchObject({ content: '已读取笔记', finishReason: 'stop' });
    for (const [url, init] of fetcher.mock.calls) {
      const body = JSON.parse(String(init?.body));
      expect(url).toBe(preset.endpoint + '/chat/completions');
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer synthetic-agent-key');
      expect(body.messages[1].content[1].image_url.url).toBe('data:image/jpeg;base64,fixture');
      expect(body.tools[0].function.name).toBe('read_file'); expect(body.tool_choice).toBe('auto');
      expect(init?.body).not.toContain('synthetic-agent-key'); expect(body).not.toHaveProperty('extra_body');
      if (['deepseek', 'kimi', 'zhipu', 'doubao'].includes(id)) expect(body.thinking).toEqual({ type: 'disabled' });
      else expect(body).not.toHaveProperty('thinking');
    }
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body)).messages.at(-1)).toEqual({ role: 'tool', tool_call_id: 'call-1', content: 'synthetic note content' });
  });
  it('maps tool messages and schemas, preserves selected screenshot, and keeps keys out of message bodies', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'done', reasoning_content: 'SECRET' }, finish_reason: 'stop' }] })));
    const provider = new ChatCompletionsAgentProvider(settings, 'test-key', 'data:image/jpeg;base64,TEST', fetcher);
    const value = request(); value.tools = [{ name: 'read_file', description: 'read', permission: 'workspace:read', inputSchema: { type: 'object' } }];
    value.messages.push({ role: 'assistant', content: '', toolCalls: [{ id: 't1', name: 'read_file', arguments: '{}' }] }, { role: 'tool', toolCallId: 't1', name: 'read_file', content: '{"success":true}' });
    expect(await provider.chat(value)).toMatchObject({ content: 'done', finishReason: 'stop' });
    const init = fetcher.mock.calls[0][1]!; const body = JSON.parse(String(init.body));
    expect(body.messages[1].content[1].image_url.url).toBe('data:image/jpeg;base64,TEST'); expect(body.messages[3].tool_call_id).toBe('t1');
    expect(body.tools[0].function.name).toBe('read_file'); expect(String(init.body)).not.toContain('test-key'); expect(init.redirect).toBe('error');
  });
  it('assembles split parallel tool calls and never emits reasoning fields or tagged thinking', async () => {
    const provider = new ChatCompletionsAgentProvider(settings, '', undefined, async () => sse([
      { choices: [{ delta: { reasoning_content: 'PRIVATE', content: '<think>HIDDEN</think>回答', tool_calls: [{ index: 1, id: 'b', function: { name: 'read_file', arguments: '{' } }, { index: 0, id: 'a', function: { name: 'web_search', arguments: '{"query":' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"test"}' } }, { index: 1, function: { arguments: '"path":"package.json"}' } }] }, finish_reason: 'tool_calls' }] }
    ]));
    const events = []; for await (const event of provider.stream(request())) events.push(event);
    expect(JSON.stringify(events)).not.toMatch(/PRIVATE|HIDDEN/);
    expect(events.at(-1)).toMatchObject({ type: 'complete', response: { content: '回答', toolCalls: [{ id: 'a', name: 'web_search', arguments: '{"query":"test"}' }, { id: 'b', name: 'read_file', arguments: '{"path":"package.json"}' }] } });
  });
  it('rejects incomplete streams instead of executing a partial tool call', async () => {
    const provider = new ChatCompletionsAgentProvider(settings, '', undefined, async () => sse([{ choices: [{ delta: { tool_calls: [{ index: 0, id: 't1', function: { name: 'read_file', arguments: '{}' } }] }, finish_reason: 'tool_calls' }] }], false));
    await expect(provider.chat(request())).rejects.toMatchObject({ code: 'LLM_INCOMPLETE_STREAM' });
  });
  it('streams visible text before completion and filters reasoning tags across arbitrary chunks', async () => {
    const chunks = ['<thi', 'nk>PRIVATE', '</th', 'ink>你好', '，', '<analysis>', 'HIDDEN', '</analysis>世界'];
    const provider = new ChatCompletionsAgentProvider(settings, '', undefined, async () => sse([
      ...chunks.map((content) => ({ choices: [{ delta: { content, reasoning_content: 'SECRET' } }] })),
      { choices: [{ delta: {}, finish_reason: 'stop' }] }
    ]));
    const events = []; for await (const event of provider.stream(request())) events.push(event);
    expect(events.filter((event) => event.type === 'text_delta').map((event) => event.text)).toEqual(['你好', '，', '世界']);
    expect(events.at(-1)).toMatchObject({ type: 'complete', response: { content: '你好，世界' } });
    expect(JSON.stringify(events)).not.toMatch(/PRIVATE|HIDDEN|SECRET|think|analysis/);
  });
  it('never emits hidden text at any split, including nested, unfinished and mixed-case tags', () => {
    const text = '正文\n<ThInK>SECRET<analysis>HIDDEN</analysis>PRIVATE</ThInK> 结尾';
    for (let index = 0; index <= text.length; index++) {
      const stream = new VisibleTextStream();
      expect(stream.push(text.slice(0, index)) + stream.push(text.slice(index)) + stream.finish()).toBe('正文\n 结尾');
    }
    const unfinished = new VisibleTextStream();
    expect(unfinished.push('开头<think>SECRET') + unfinished.finish()).toBe('开头');
    const code = new VisibleTextStream();
    expect(code.push('a < b\n<div>内容</div>') + code.finish()).toBe('a < b\n<div>内容</div>');
  });
  it('bounds provider responses and refuses HTTP errors without forwarding error bodies', async () => {
    const failed = new ChatCompletionsAgentProvider(settings, '', undefined, async () => new Response('PRIVATE ERROR BODY', { status: 401 }));
    await expect(failed.chat(request())).rejects.toMatchObject({ code: 'LLM_ERROR' });
    const big = new ChatCompletionsAgentProvider(settings, '', undefined, async () => new Response('x'.repeat(2 * 1024 * 1024 + 1)));
    await expect(big.chat(request())).rejects.toMatchObject({ code: 'OUTPUT_LIMIT' });
  });
  it('rejects malformed tool arguments through the existing provider turn validation', async () => {
    const provider = new ChatCompletionsAgentProvider(settings, '', undefined, async () => new Response(JSON.stringify({ choices: [{ message: { content: null, tool_calls: [{ id: 'x', function: { name: 'read_file', arguments: { invalid: 'object' } } }] }, finish_reason: 'tool_calls' }] })));
    const value = request();
    await expect(providerTurn({ provider, context: value, signal: value.signal, streaming: true, maxOutputTokens: 2048, timeoutMs: 1000, maxResponseBytes: 512 * 1024, onDelta: () => {} })).rejects.toMatchObject({ code: 'LLM_INVALID_RESPONSE' });
  });
});
