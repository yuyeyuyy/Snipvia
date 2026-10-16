import { z } from 'zod';
import { chatImageIdsSchema, type ChatImage } from '../chat-images';
import type { Result } from '../contracts';
import type { PermissionDecision, PermissionRisk } from './permission';
import type { WebSource } from './sources';
import type { NotebookReference } from '../notes';
import type { NoteChangeSummary } from './note-writing';

/** OpenCode-style plan entries maintained by the model through todo_write. */
export const agentTodoSchema = z.strictObject({
  content: z.string().trim().min(1).max(200),
  status: z.enum(['pending', 'in_progress', 'completed', 'cancelled'])
});
export const agentTodoListSchema = z.array(agentTodoSchema).max(20);
export type AgentTodo = z.infer<typeof agentTodoSchema>;
export type AgentExecutionState = 'thinking' | 'tool_pending' | 'permission_required' | 'tool_running' | 'tool_success' | 'tool_error' | 'cancelled' | 'completed';
export interface AgentInlinePermission {
  requestId: string;
  risk: PermissionRisk;
  target: string;
  workspacePath: string;
  description: string;
  argumentsText?: string;
  expiresAt: number;
  allowedDecisions: Array<'allow_once' | 'allow_session' | 'deny'>;
  command?: string;
}
export interface AgentStepView {
  id: string;
  executionId?: string;
  toolName: string;
  title: string;
  detail: string;
  /** Only a hostname/query, never raw tool arguments or page content. */
  webTarget?: string;
  state: AgentExecutionState;
  summary?: string;
  durationMs?: number;
  diff?: { path: string; added: number; removed: number };
  permission?: AgentInlinePermission;
}
export interface AgentRunView {
  images?: ChatImage[];
  noteChanges?: NoteChangeSummary[];
  runId: string;
  captureId?: string;
  conversationId?: string;
  question: string;
  messageIndex: number;
  saved: boolean;
  sequence: number;
  state: AgentExecutionState;
  finished: boolean;
  steps: AgentStepView[];
  todos?: AgentTodo[];
  /** True while older turns are being summarized to fit the context window. */
  compacting?: boolean;
  sources?: WebSource[];
  answer?: string;
  answerStreaming?: boolean;
  notice?: string;
}
export interface AgentExecutionSnapshot {
  /** Read-only presentation of the existing single-task limit. */
  activeConversationId?: string | null;
  revision: number;
  captureId?: string;
  conversationId?: string;
  workspacePath: string | null;
  notebook: NotebookReference | null;
  notebookNotice?: string;
  busy: boolean;
  canControl: boolean;
  runs: AgentRunView[];
}
export interface AgentDiffView { path: string; diff: string; truncated: boolean }
export type AgentTarget = string | { conversationId: string };
export const agentWorkspaceSchema = z.strictObject({ conversationId: z.string().uuid() });
export const agentWorkspaceStartSchema = agentWorkspaceSchema.extend({ question: z.string().trim().min(1).max(16_000), regenerate: z.boolean().default(false), imageIds: chatImageIdsSchema.default([]) }).refine(value => !value.regenerate || !value.imageIds.length, '重新生成只能使用原消息的图片');
export const agentWorkspaceStopSchema = agentWorkspaceSchema.extend({ runId: z.string().uuid() });
export const agentCaptureSchema = z.strictObject({ captureId: z.string().uuid() });
export const agentStartSchema = agentCaptureSchema.extend({ question: z.string().trim().min(1).max(16_000) });
export const agentNotebookSchema = agentCaptureSchema.extend({ notebookId: z.string().uuid().nullable() });
export const agentRunSchema = agentCaptureSchema.extend({ runId: z.string().uuid() });
export const agentDecisionSchema = agentRunSchema.extend({ requestId: z.string().uuid(), decision: z.enum(['allow_once', 'allow_session', 'deny']) });
export const agentDiffSchema = agentRunSchema.extend({ stepId: z.string().min(1).max(128) });
export const agentSourceIconSchema = agentCaptureSchema.extend({ url: z.string().min(1).max(2048) });
export const agentNoteChangeSchema = z.union([agentCaptureSchema.extend({ changeId: z.string().uuid() }), agentWorkspaceSchema.extend({ changeId: z.string().uuid() })]);
export interface AgentExecutionAPI {
  workspaceState(conversationId: string): Promise<Result<AgentExecutionSnapshot>>;
  workspaceStart(conversationId: string, question: string, regenerate?: boolean, imageIds?: string[]): Promise<Result<AgentExecutionSnapshot>>;
  workspaceStop(conversationId: string, runId: string): Promise<Result<void>>;
  openNote(captureId: AgentTarget, changeId: string): Promise<Result<void>>;
  noteDiff(captureId: AgentTarget, changeId: string): Promise<Result<AgentDiffView>>;
  noteUndoState(captureId: AgentTarget, changeId: string): Promise<Result<{ available: boolean; reverted: boolean; reason?: string }>>;
  /** Restores every note changed in that run, only if none changed afterwards. */
  undoNotes(captureId: AgentTarget, changeId: string): Promise<Result<{ restored: number }>>;
  state(captureId: string): Promise<Result<AgentExecutionSnapshot>>;
  notebooks(captureId: string): Promise<Result<NotebookReference[]>>;
  selectNotebook(captureId: string, notebookId: string | null): Promise<Result<AgentExecutionSnapshot>>;
  start(captureId: string, question: string): Promise<Result<AgentExecutionSnapshot>>;
  stop(captureId: string, runId: string): Promise<Result<void>>;
  decide(captureId: string, runId: string, requestId: string, decision: Exclude<PermissionDecision, 'always_allow'>): Promise<Result<void>>;
  diff(captureId: string, runId: string, stepId: string): Promise<Result<AgentDiffView>>;
  sourceIcon(captureId: string, url: string): Promise<Result<string | null>>;
  onChanged(callback: (snapshot: AgentExecutionSnapshot) => void): () => void;
}
