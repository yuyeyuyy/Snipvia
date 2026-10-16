import { setImmediate } from 'node:timers/promises';
import { z } from 'zod';
import type { AgentChatResponse, AgentProviderEvent } from '../../shared/agent/message';
import type { AgentChatContext, AgentChatRequest, LLMProvider } from '../ai/llm/LLMProvider';
import { AgentError, checkAgentAbort } from './AgentError';

const responseSchema = z.strictObject({
  content: z.string().max(1024 * 1024),
  toolCalls: z.array(z.strictObject({
    id: z.string().min(1).max(128), name: z.string().min(1).max(128), arguments: z.string().max(512 * 1024)
  })).max(32).optional(),
  finishReason: z.enum(['stop', 'tool_calls', 'length', 'blocked']),
  usage: z.strictObject({ inputTokens: z.number().int().nonnegative().max(10_000_000), outputTokens: z.number().int().nonnegative().max(10_000_000) }).optional(),
  providerState: z.string().max(64 * 1024).optional()
});
const deltaSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('text_delta'), text: z.string().max(1024 * 1024) }),
  z.strictObject({ type: z.literal('tool_call_delta'), index: z.number().int().min(0).max(31),
    id: z.string().max(128).optional(), name: z.string().max(128).optional(), argumentsDelta: z.string().max(512 * 1024).optional() })
]);

function parseResponse(value: unknown, maxBytes: number): AgentChatResponse {
  const parsed = responseSchema.safeParse(value);
  if (!parsed.success) throw new AgentError('LLM_INVALID_RESPONSE', '模型返回了不支持的 Agent 响应格式');
  if (Buffer.byteLength(JSON.stringify(parsed.data)) > maxBytes) throw new AgentError('OUTPUT_LIMIT', '模型返回内容超过大小上限');
  const calls = parsed.data.toolCalls ?? [];
  if (new Set(calls.map((call) => call.id)).size !== calls.length ||
      (parsed.data.finishReason === 'stop' && (calls.length > 0 || !parsed.data.content.trim())) ||
      (parsed.data.finishReason === 'tool_calls' && calls.length === 0)) {
    throw new AgentError('LLM_INVALID_RESPONSE', '模型响应的结束原因或工具调用 ID 无效');
  }
  return parsed.data;
}

export async function providerTurn(options: {
  provider: LLMProvider; context: AgentChatContext; maxOutputTokens: number; timeoutMs: number;
  maxResponseBytes: number; signal: AbortSignal; streaming: boolean;
  onDelta(event: Exclude<AgentProviderEvent, { type: 'complete' }>): void;
}): Promise<AgentChatResponse> {
  checkAgentAbort(options.signal);
  const controller = new AbortController();
  const forward = () => controller.abort(new AgentError('CANCELLED', 'Agent 已由用户取消'));
  options.signal.addEventListener('abort', forward, { once: true });
  const timer = setTimeout(() => controller.abort(new AgentError('LLM_TIMEOUT', '模型请求超时，Agent 已停止')), options.timeoutMs);
  let onAbort: () => void = () => {};
  let closeStream: (() => void) | undefined;
  let accepting = true;
  try {
    const interrupted = new Promise<never>((_resolve, reject) => {
      onAbort = () => { try { checkAgentAbort(controller.signal); } catch (error) { reject(error); } closeStream?.(); };
      controller.signal.addEventListener('abort', onAbort, { once: true });
    });
    const request: AgentChatRequest = { ...structuredClone(options.context), maxOutputTokens: options.maxOutputTokens, signal: controller.signal };
    const operation = async (): Promise<AgentChatResponse> => {
      checkAgentAbort(controller.signal);
      if (!options.streaming || !options.provider.stream) return parseResponse(await options.provider.chat(request), options.maxResponseBytes);
      const iterator = options.provider.stream(request)[Symbol.asyncIterator]();
      let closed = false;
      closeStream = () => {
        if (closed) return;
        closed = true;
        try { void Promise.resolve(iterator.return?.()).catch(() => {}); } catch { /* A faulty adapter cannot prevent cancellation. */ }
      };
      let complete: AgentChatResponse | undefined;
      let receivedBytes = 0;
      let count = 0;
      while (true) {
        const next = await iterator.next();
        checkAgentAbort(controller.signal);
        if (!accepting) throw new AgentError('CANCELLED', '模型请求已结束');
        if (next.done) break;
        if (++count > 10_000) throw new AgentError('OUTPUT_LIMIT', '模型流事件超过上限');
        if (complete) throw new AgentError('LLM_INVALID_RESPONSE', '模型在完成事件之后继续返回内容');
        const event = next.value;
        if (event && event.type === 'complete') complete = parseResponse(event.response, options.maxResponseBytes);
        else {
          const parsed = deltaSchema.safeParse(event);
          if (!parsed.success) throw new AgentError('LLM_INVALID_RESPONSE', '模型返回了无效的流事件');
          receivedBytes += Buffer.byteLength(JSON.stringify(parsed.data));
          if (receivedBytes > options.maxResponseBytes) throw new AgentError('OUTPUT_LIMIT', '模型流内容超过大小上限');
          options.onDelta(parsed.data);
        }
        if (count % 32 === 0) await setImmediate();
      }
      if (!complete) throw new AgentError('LLM_INCOMPLETE_STREAM', '模型流意外中断，未执行未完成的工具调用');
      return complete;
    };
    const result = await Promise.race([Promise.resolve().then(operation), interrupted]);
    checkAgentAbort(controller.signal);
    return result;
  } catch (error) {
    if (controller.signal.aborted) checkAgentAbort(controller.signal);
    if (error instanceof AgentError) throw error;
    // Provider exceptions can contain request bodies or credentials; never pass them to UI/logs.
    throw new AgentError('LLM_ERROR', '模型请求失败，Agent 已停止；请检查模型配置或稍后重试');
  } finally {
    accepting = false;
    clearTimeout(timer);
    options.signal.removeEventListener('abort', forward);
    controller.signal.removeEventListener('abort', onAbort);
    closeStream?.();
    if (!controller.signal.aborted) controller.abort(new AgentError('CANCELLED', '模型请求已结束'));
  }
}
