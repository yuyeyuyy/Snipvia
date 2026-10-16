import type { AgentChatResponse, AgentMessage, AgentProviderEvent } from '../../../shared/agent/message';
import type { ToolDescriptor } from '../../agent/types/tool';

export interface AgentChatContext {
  system: string;
  messages: AgentMessage[];
  tools: ToolDescriptor[];
  /** False for internal requests (context summaries) that must not resend the screenshot. */
  attachImage?: boolean;
}

export interface AgentChatRequest extends AgentChatContext {
  signal: AbortSignal;
  maxOutputTokens: number;
}

/** No endpoints, API keys, vendor messages or HTTP code in AgentLoop. */
export interface LLMProvider {
  /** Release per-run image buffers after completion/cancellation; no stateful provider reuse. */
  dispose?(): void;
  readonly id: string;
  chat(request: AgentChatRequest): Promise<AgentChatResponse>;
  /** Optional. Must emit one complete event and then end normally; deltas never authorize tools. */
  stream?(request: AgentChatRequest): AsyncIterable<AgentProviderEvent>;
  /** Optional model-specific counters; fallback is deliberately conservative, not a billing count. */
  countInputTokens?(context: AgentChatContext): number;
  countOutputTokens?(response: AgentChatResponse): number;
}
