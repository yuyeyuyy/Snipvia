import type { EditingIntent } from '../../../shared/agent/editing';
import type { AgentChatResponse, AgentMessage, AgentToolCall } from '../../../shared/agent/message';
import type { WorkspaceGrant } from '../WorkspaceService';
import type { ToolResult } from './tool';
import type { PermissionSession } from '../PermissionManager';
import type { PermissionEvent } from '../../../shared/agent/permission';
import type { NoteChangeSummary } from '../../../shared/agent/note-writing';
import type { AgentTodo } from '../../../shared/agent/execution';

export interface AgentLimits {
  maxSteps: number;
  maxToolCalls: number;
  maxToolCallsPerStep: number;
  llmTimeoutMs: number;
  toolTimeoutMs: number;
  maxContextTokens: number;
  maxOutputTokens: number;
  contextReserveTokens: number;
  maxTotalTokens: number;
  maxToolResultBytes: number;
  maxResponseBytes: number;
}

export type AgentErrorCode = 'INVALID_REQUEST' | 'INVALID_HISTORY' | 'CANCELLED' | 'LLM_TIMEOUT' | 'LLM_ERROR'
  | 'LLM_INVALID_RESPONSE' | 'LLM_INCOMPLETE_STREAM' | 'LLM_BLOCKED' | 'MAX_STEPS' | 'MAX_TOOL_CALLS'
  | 'CONTEXT_LIMIT' | 'TOKEN_LIMIT' | 'OUTPUT_LIMIT' | 'INTERNAL_ERROR';

export interface AgentRunRequest {
  /** Main-owned permission ceiling; never accepted from Renderer or model output. */
  allowedToolPermissions?: readonly string[];
  proposalScope?: object;
  propose?: (scope: object | undefined, intent: EditingIntent, signal: AbortSignal) => Promise<unknown>;
  noteScope?: object;
  commandScope?: object;
  message: string;
  history?: AgentMessage[];
  workspace?: WorkspaceGrant;
  signal?: AbortSignal;
  systemPrompt?: string;
  streaming?: boolean;
  /** Trusted Main may share a capability across turns; otherwise one run is one session. */
  permissionSession?: PermissionSession;
}

export interface AgentRunResult {
  runId: string;
  status: 'completed' | 'cancelled' | 'failed' | 'limit_reached';
  message: string;
  finalAnswer?: string;
  error?: { code: AgentErrorCode; message: string };
  steps: number;
  toolCalls: number;
  tokens: { input: number; output: number; estimated: boolean };
  messages: AgentMessage[];
}

type EventPayload = PermissionEvent
  | { type: 'run_started' }
  | { type: 'step_started' }
  | { type: 'context_prepared'; inputTokens: number; removedMessages: number; prunedResults: number; maxOutputTokens: number }
  | { type: 'llm_started' }
  | { type: 'assistant_delta'; text: string }
  | { type: 'tool_call_delta'; index: number; id?: string; name?: string; argumentsDelta?: string }
  | { type: 'llm_completed'; response: AgentChatResponse }
  | { type: 'tool_started'; call: AgentToolCall; executionId: string }
  | { type: 'tool_running'; executionId: string }
  | { type: 'tool_completed'; callId: string; name: string; result: ToolResult; skipped: boolean; noteChanges?: NoteChangeSummary[] }
  | { type: 'todo_updated'; callId: string; todos: AgentTodo[] }
  | { type: 'context_compacting' }
  | { type: 'context_compacted'; summarizedMessages: number; success: boolean }
  | { type: 'step_completed' }
  | { type: 'run_finished'; status: AgentRunResult['status']; message: string; errorCode?: AgentErrorCode };

export type AgentEvent = EventPayload & { runId: string; sequence: number; timestamp: number; step: number };
export type AgentEventPayload = EventPayload;

/** Deliberately excludes prompts, arguments, text deltas, results, paths and provider exceptions. */
export interface AgentLogRecord {
  runId: string; sequence: number; timestamp: number; step: number; event: AgentEvent['type'];
  toolName?: string; errorCode?: string; status?: AgentRunResult['status'];
}
export interface AgentLogger { log(record: AgentLogRecord): void | Promise<void> }
