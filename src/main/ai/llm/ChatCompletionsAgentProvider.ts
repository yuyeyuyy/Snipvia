import type { Settings } from '../../../shared/contracts';
import type { AgentChatResponse, AgentProviderEvent, AgentToolCall } from '../../../shared/agent/message';
import { assertApiKeyFormat } from '../../../shared/api-key';
import { AgentError, checkAgentAbort } from '../../agent/AgentError';
import { conservativeTokens } from '../../agent/ContextManager';
import type { AgentChatContext, AgentChatRequest, LLMProvider } from './LLMProvider';
import { VisibleTextStream } from './VisibleTextStream';
import { chatCompletionOptions } from '../chat-completion-options';
import { ModelAPIError } from '../models/http';
import { visionFailure } from '../models/vision-test';

export type AgentImages = { current: string[]; history: ReadonlyMap<string, string> };
async function imageFailure(response: Response) {
  const reader = response.body?.getReader(); const chunks: Uint8Array[] = []; let length = 0;
  if (reader) try { while (length < 8000) { const next = await reader.read(); if (next.done) break; const piece = next.value.subarray(0, 8000 - length); chunks.push(piece); length += piece.byteLength; } }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const result = visionFailure(new ModelAPIError('http', response.status, Buffer.concat(chunks).toString('utf8')), 'chat-completions', new Date().toISOString());
  return new AgentError('LLM_ERROR', `图片请求失败（HTTP ${response.status}）：${result.message.replace('测试请求', '请求')}`);
}

function object(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function finalText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'string') throw new AgentError('LLM_INVALID_RESPONSE', '模型返回不支持的文本格式');
  // Structured reasoning fields are never read. Some compatible local models also use these tags.
  const stream = new VisibleTextStream();
  return (stream.push(value) + stream.finish()).trim();
}
function finish(value: unknown): AgentChatResponse['finishReason'] {
  if (value === 'stop' || value === 'tool_calls' || value === 'length') return value;
  if (value === 'content_filter') return 'blocked';
  throw new AgentError('LLM_INVALID_RESPONSE', '模型未返回有效的结束原因');
}
function usage(value: unknown): AgentChatResponse['usage'] {
  const item = object(value);
  return typeof item.prompt_tokens === 'number' && typeof item.completion_tokens === 'number'
    ? { inputTokens: item.prompt_tokens, outputTokens: item.completion_tokens } : undefined;
}
function parseJSON(text: string): Record<string, unknown> {
  try { return object(JSON.parse(text)); } catch { throw new AgentError('LLM_INVALID_RESPONSE', '模型返回无效 JSON'); }
}

/** Uses the existing configured Chat Completions endpoint; no model/vendor code enters AgentLoop. */
export class ChatCompletionsAgentProvider implements LLMProvider {
  readonly id = 'chat-completions';
  constructor(private readonly settings: Pick<Settings, 'provider' | 'endpoint' | 'model'>, private readonly key: string,
    private image?: string, private readonly fetcher: typeof fetch = fetch, private images?: AgentImages) {}
  dispose() { this.image = undefined; this.images = undefined; }
  countInputTokens(context: AgentChatContext): number {
    const count = context.attachImage === false ? 0 : Number(!!this.image) + (this.images?.current.length ?? 0) + context.messages.reduce((sum, message) => sum + (message.role === 'user' ? message.imageIds?.filter(id => this.images?.history.has(id)).length ?? 0 : 0), 0);
    return conservativeTokens(context) + count * 4096;
  }
  async chat(request: AgentChatRequest): Promise<AgentChatResponse> {
    for await (const event of this.stream(request)) if (event.type === 'complete') return event.response;
    throw new AgentError('LLM_INCOMPLETE_STREAM', '模型流未完成');
  }
  async *stream(request: AgentChatRequest): AsyncIterable<AgentProviderEvent> {
    assertApiKeyFormat(this.key); checkAgentAbort(request.signal);
    let lastUser = -1;
    request.messages.forEach((message, index) => { if (message.role === 'user') lastUser = index; });
    const messages = request.messages.map((message, index) => {
      if (message.role === 'tool') return { role: 'tool', tool_call_id: message.toolCallId, content: message.content };
      if (message.role === 'assistant') return { role: 'assistant', content: message.content || null,
        ...(message.toolCalls?.length ? { tool_calls: message.toolCalls.map((call) => ({ id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments } })) } : {}) };
      const pictures = request.attachImage === false ? [] : [...(message.imageIds?.flatMap(id => this.images?.history.get(id) ? [this.images.history.get(id)!] : []) ?? []), ...(index === lastUser ? [...(this.image ? [this.image] : []), ...(this.images?.current ?? [])] : [])];
      const content = message.content + (message.imageIds?.some(id => !this.images?.history.has(id)) ? '\n[这条历史消息的部分图片未附带本次请求；不可假设已看到图片。]' : '');
      return { role: 'user', content: pictures.length ? [{ type: 'text', text: content }, ...pictures.map(url => ({ type: 'image_url', image_url: { url } }))] : content };
    });
    const response = await this.fetcher(`${this.settings.endpoint.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST', redirect: 'error', signal: request.signal,
      headers: { 'Content-Type': 'application/json', ...(this.key ? { Authorization: `Bearer ${this.key}` } : {}) },
      // include_usage lets AgentLoop budget with vendor counts instead of estimates.
      body: JSON.stringify({ model: this.settings.model, stream: true, stream_options: { include_usage: true }, max_tokens: request.maxOutputTokens,
        ...chatCompletionOptions(this.settings),
        messages: [{ role: 'system', content: request.system }, ...messages],
        ...(request.tools.length ? { tools: request.tools.map((tool) => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.inputSchema } })), tool_choice: 'auto' } : {}) })
    });
    if (!response.ok || !response.body) {
      if (!response.ok && request.attachImage !== false && (this.image || this.images?.current.length || this.images?.history.size)) throw await imageFailure(response);
      await response.body?.cancel(); throw new AgentError('LLM_ERROR', `Agent 模型请求失败（HTTP ${response.status}）；请确认模型支持 Tool Calling`);
    }
    const reader = response.body.getReader(); const decoder = new TextDecoder();
    let bytes = 0; let buffer = ''; let content = ''; let done = false; let reason: AgentChatResponse['finishReason'] | undefined;
    let tokens: AgentChatResponse['usage']; const calls = new Map<number, AgentToolCall>();
    const visibleText = new VisibleTextStream();
    const isSSE = response.headers.get('content-type')?.includes('text/event-stream');
    const consume = (payload: string): AgentProviderEvent[] => {
      if (payload === '[DONE]') { done = true; return []; }
      if (done) throw new AgentError('LLM_INVALID_RESPONSE', '模型在完成标记后继续输出');
      const json = parseJSON(payload); if (json.error) throw new AgentError('LLM_ERROR', '模型流返回错误');
      const choice = object(Array.isArray(json.choices) ? json.choices[0] : undefined);
      const delta = object(choice.delta);
      if (choice.finish_reason !== null && choice.finish_reason !== undefined) reason = finish(choice.finish_reason);
      tokens = usage(json.usage) ?? tokens;
      const events: AgentProviderEvent[] = [];
      for (const [position, raw] of (Array.isArray(delta.tool_calls) ? delta.tool_calls : []).entries()) {
        // Some compatible gateways omit index when every call arrives whole in one chunk.
        const item = object(raw); const fn = object(item.function); const index = item.index ?? position;
        if (!Number.isInteger(index) || (index as number) < 0 || (index as number) >= 32) throw new AgentError('LLM_INVALID_RESPONSE', '工具调用序号无效');
        const call = calls.get(index as number) ?? { id: '', name: '', arguments: '' };
        // IDs and names are never fragmented in practice, but some gateways repeat them in every chunk.
        if (typeof item.id === 'string' && item.id && !call.id) call.id = item.id;
        if (typeof fn.name === 'string' && fn.name && !call.name) call.name = fn.name;
        if (typeof fn.arguments === 'string') call.arguments += fn.arguments;
        if (call.id.length > 128 || call.name.length > 128 || call.arguments.length > 512 * 1024) throw new AgentError('OUTPUT_LIMIT', '工具调用内容超过上限');
        calls.set(index as number, call);
        events.push({ type: 'tool_call_delta', index: index as number, id: call.id, name: call.name });
      }
      if (typeof delta.content === 'string') {
        content += delta.content;
        const text = visibleText.push(delta.content);
        // Tool turns expose operation status, not their accompanying model commentary.
        if (text && !calls.size) events.push({ type: 'text_delta', text });
      }
      return events;
    };
    try {
      while (true) {
        const next = await reader.read(); checkAgentAbort(request.signal);
        bytes += next.value?.byteLength ?? 0;
        if (bytes > 2 * 1024 * 1024) throw new AgentError('OUTPUT_LIMIT', '模型响应超过大小上限');
        buffer += decoder.decode(next.value, { stream: !next.done });
        if (isSSE) {
          let match: RegExpExecArray | null;
          while ((match = /\r?\n\r?\n/.exec(buffer))) {
            const event = buffer.slice(0, match.index); buffer = buffer.slice(match.index + match[0].length);
            const data = event.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
            if (data) for (const delta of consume(data)) yield delta;
          }
        }
        if (next.done) break;
      }
      if (!isSSE) {
        const json = parseJSON(buffer); const choice = object(Array.isArray(json.choices) ? json.choices[0] : undefined); const message = object(choice.message);
        const toolCalls = (Array.isArray(message.tool_calls) ? message.tool_calls : []).map((raw) => {
          const item = object(raw); const fn = object(item.function);
          return { id: item.id, name: fn.name, arguments: fn.arguments } as AgentToolCall;
        });
        const reason = finish(choice.finish_reason);
        yield { type: 'complete', response: { content: finalText(message.content), finishReason: toolCalls.length && reason === 'stop' ? 'tool_calls' : reason, toolCalls, usage: usage(json.usage) } };
      } else {
        if (buffer.trim()) {
          const data = buffer.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
          if (data) for (const delta of consume(data)) yield delta;
        }
        if (!done || !reason) throw new AgentError('LLM_INCOMPLETE_STREAM', '模型流中断；未执行不完整工具调用');
        const trailing = visibleText.finish();
        if (trailing && !calls.size) yield { type: 'text_delta', text: trailing };
        // Several gateways report "stop" together with complete tool calls.
        yield { type: 'complete', response: { content: finalText(content), finishReason: calls.size && reason === 'stop' ? 'tool_calls' : reason, toolCalls: [...calls.entries()].sort(([a], [b]) => a - b).map(([, call]) => call), usage: tokens } };
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
}
