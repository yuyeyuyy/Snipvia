/** Provider-neutral tool call. Adapters retain JSON text, including malformed arguments. */
export interface AgentToolCall {
  id: string;
  name: string;
  arguments: string;
}

export type AgentMessage =
  | { role: 'user'; content: string; imageIds?: string[] }
  | { role: 'assistant'; content: string; toolCalls?: AgentToolCall[]; providerState?: string }
  | { role: 'tool'; toolCallId: string; name: string; content: string };

export interface AgentUsage { inputTokens: number; outputTokens: number }

export interface AgentChatResponse {
  content: string;
  toolCalls?: AgentToolCall[];
  finishReason: 'stop' | 'tool_calls' | 'length' | 'blocked';
  usage?: AgentUsage;
  /** Opaque, serialized continuation state owned by the provider adapter. */
  providerState?: string;
}

export type AgentProviderEvent =
  // User-visible response text only. Adapters must filter structured/tagged reasoning first.
  | { type: 'text_delta'; text: string }
  | { type: 'tool_call_delta'; index: number; id?: string; name?: string; argumentsDelta?: string }
  | { type: 'complete'; response: AgentChatResponse };
