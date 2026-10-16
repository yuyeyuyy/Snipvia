import { z } from 'zod';
import { chatImageIdsSchema } from '../../shared/chat-images';
import type { AgentMessage } from '../../shared/agent/message';
import type { AgentChatContext, LLMProvider } from '../ai/llm/LLMProvider';
import { AgentError } from './AgentError';
import type { AgentLimits } from './types/agent';
import type { ToolDescriptor, ToolResult } from './types/tool';
import { utf8Prefix } from './web/operation';

const toolCallSchema = z.strictObject({ id: z.string().min(1).max(128), name: z.string().min(1).max(128), arguments: z.string().max(512 * 1024) });
const messageSchema = z.discriminatedUnion('role', [
  z.strictObject({ role: z.literal('user'), content: z.string().max(512 * 1024), imageIds: chatImageIdsSchema.optional() }),
  z.strictObject({ role: z.literal('assistant'), content: z.string().max(512 * 1024), toolCalls: z.array(toolCallSchema).max(32).optional(), providerState: z.string().max(64 * 1024).optional() }),
  z.strictObject({ role: z.literal('tool'), toolCallId: z.string().min(1).max(128), name: z.string().min(1).max(128), content: z.string().max(512 * 1024) })
]);

/**
 * Provider-neutral estimate used only when a vendor omits usage. Common tokenizers
 * average about 4 ASCII bytes or one CJK character (3 UTF-8 bytes) per token, so
 * bytes / 3 stays on the safe side without treating every byte as a token.
 */
export function conservativeTokens(value: unknown): number {
  return Math.ceil(Buffer.byteLength(JSON.stringify(value), 'utf8') / 3) + 64;
}

/** Replaces an old tool result in the model view only; the transcript keeps the original. */
export const prunedToolContent = JSON.stringify({ success: true, output: { pruned: true,
  note: '较早的工具结果已从上下文移除以节省空间；需要其中内容时重新调用工具读取，不要凭记忆补全。' } });
const keptRecentToolResults = 3;

export function checkedTokenCount(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new AgentError('LLM_INVALID_RESPONSE', 'Provider 返回了无效的 token 计数');
  return value;
}

export class ContextManager {
  validateHistory(history: AgentMessage[]): AgentMessage[] {
    if (!Array.isArray(history) || history.length > 2000) throw new AgentError('INVALID_HISTORY', 'Agent 历史格式无效或超过上限');
    const validated: AgentMessage[] = [];
    let bytes = 0;
    for (const raw of history) {
      const parsed = messageSchema.safeParse(raw);
      if (!parsed.success) throw new AgentError('INVALID_HISTORY', 'Agent 历史格式无效');
      bytes += Buffer.byteLength(JSON.stringify(parsed.data));
      if (bytes > 4 * 1024 * 1024) throw new AgentError('INVALID_HISTORY', 'Agent 历史超过大小上限');
      validated.push(parsed.data);
    }
    const pending = new Map<string, string>();
    const ids = new Set<string>();
    let hasUser = false;
    for (const message of validated) {
      if (message.role === 'tool') {
        if (pending.get(message.toolCallId) !== message.name) throw new AgentError('INVALID_HISTORY', '工具结果没有匹配的调用');
        pending.delete(message.toolCallId);
      } else {
        if (pending.size) throw new AgentError('INVALID_HISTORY', '工具调用缺少结果，不能继续上下文');
        if (message.role === 'user') hasUser = true;
        if (!hasUser) throw new AgentError('INVALID_HISTORY', '上下文必须从用户消息开始');
        if (message.role === 'assistant') for (const call of message.toolCalls ?? []) {
          if (ids.has(call.id)) throw new AgentError('INVALID_HISTORY', '历史中存在重复的工具调用 ID');
          ids.add(call.id);
          pending.set(call.id, call.name);
        }
      }
    }
    if (pending.size) throw new AgentError('INVALID_HISTORY', '历史存在未完成的工具调用');
    return validated;
  }

  build(system: string, messages: AgentMessage[], tools: ToolDescriptor[], provider: LLMProvider, limits: AgentLimits, spentTokens: number) {
    const context: AgentChatContext = { system, messages: structuredClone(messages), tools: structuredClone(tools) };
    const count = () => checkedTokenCount(provider.countInputTokens?.(structuredClone(context)) ?? conservativeTokens(context));
    let inputTokens = count();
    let removedMessages = 0;
    let prunedResults = 0;
    const inputLimit = limits.maxContextTokens - limits.maxOutputTokens - limits.contextReserveTokens;
    // 1. Like OpenCode's prune: clear old tool outputs first, keeping the most recent
    //    results intact. Messages stay in place, so tool_calls/results never split.
    const prunable = () => {
      const tools = context.messages.flatMap((message, index) => message.role === 'tool' && message.content !== prunedToolContent ? [index] : []);
      return tools.slice(0, Math.max(0, tools.length - keptRecentToolResults));
    };
    for (const index of inputTokens > inputLimit ? prunable() : []) {
      const message = context.messages[index];
      if (message.role !== 'tool') continue;
      context.messages[index] = { ...message, content: prunedToolContent };
      prunedResults++;
      inputTokens = count();
      if (inputTokens <= inputLimit) break;
    }
    // 2. Evict whole historical user turns. Never split assistant tool_calls and their results.
    while (inputTokens > inputLimit) {
      const nextUser = context.messages.findIndex((message, index) => index > 0 && message.role === 'user');
      if (nextUser < 0) throw new AgentError('CONTEXT_LIMIT', '当前任务上下文已达上限，请缩小任务或开始新的对话');
      context.messages.splice(0, nextUser);
      removedMessages += nextUser;
      inputTokens = count();
    }
    const maxOutputTokens = Math.min(limits.maxOutputTokens, limits.maxTotalTokens - spentTokens - inputTokens);
    if (maxOutputTokens < 32) throw new AgentError('TOKEN_LIMIT', 'Agent 已达到本次任务的 token 预算，已停止');
    return { context, inputTokens, maxOutputTokens, removedMessages, prunedResults };
  }

  /** Feedback remains valid JSON after truncation; never send an unmarked partial file. */
  toolFeedback(result: ToolResult, maxBytes: number): { result: ToolResult; content: string } {
    let serialized: string;
    try {
      serialized = JSON.stringify(result);
      const parsed: ToolResult = JSON.parse(serialized);
      if (parsed.success && !('output' in parsed)) throw new Error('non-JSON output');
    }
    catch { result = { success: false, error: { code: 'INVALID_RESULT', message: '工具结果无法序列化' } }; serialized = JSON.stringify(result); }
    if (Buffer.byteLength(serialized) > maxBytes) {
      const output = result.output && typeof result.output === 'object' ? result.output as Record<string, unknown> : {};
      if ('exitCode' in output && typeof output.stdout === 'string' && typeof output.stderr === 'string') {
        const budget = Math.max(0, Math.floor((maxBytes - 700) / 12));
        result = { ...result, output: { exitCode: output.exitCode, signal: output.signal, stdout: utf8Prefix(output.stdout, budget),
          stderr: utf8Prefix(output.stderr, budget), timedOut: output.timedOut, cancelled: output.cancelled,
          truncated: true, originalBytes: Buffer.byteLength(serialized), note: '命令输出已截断；实际文件变更另行展示，可再次读取需要的文件。' } };
        serialized = JSON.stringify(result);
        if (Buffer.byteLength(serialized) <= maxBytes) return { result: JSON.parse(serialized) as ToolResult, content: serialized };
      }
      const preview = Buffer.from(serialized).subarray(0, Math.floor((maxBytes - 256) / 6)).toString('utf8');
      result = result.success ? {
        success: true, output: { truncated: true, originalBytes: Buffer.byteLength(serialized), preview, note: '结果已截断；不要把截断内容当作完整文件。' }
      } : { success: false, error: { code: result.error.code, message: `${result.error.message.slice(0, Math.floor((maxBytes - 256) / 6))}（错误信息已截断）` } };
      serialized = JSON.stringify(result);
    }
    return { result: JSON.parse(serialized) as ToolResult, content: serialized };
  }
}
