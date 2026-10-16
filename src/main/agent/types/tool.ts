import type { EditingIntent } from '../../../shared/agent/editing';
import type { z } from 'zod';
import type { WorkspaceAccess } from '../WorkspaceService';
import type { NoteChangeIntent } from '../../../shared/agent/note-writing';
import type { CommandIntent } from '../commands/CommandRunner';

export type JSONSchema = z.core.JSONSchema.JSONSchema;
/** `agent:state` is the loop's own planning state (todo_write); it has no file, network or process access. */
export type ToolPermission = 'workspace:read' | 'workspace:write' | 'network:read' | 'external:execute' | 'notebook:write' | 'workspace:execute' | 'agent:state' | 'conversation:propose';

export type ToolErrorCode =
  | 'INVALID_INPUT' | 'TOOL_NOT_FOUND' | 'DUPLICATE_TOOL' | 'CALL_IN_PROGRESS'
  | 'WORKSPACE_REQUIRED' | 'PERMISSION_DENIED' | 'WORKSPACE_CHANGED'
  | 'PATH_OUTSIDE_WORKSPACE' | 'SYMLINK_NOT_ALLOWED' | 'PATH_CHANGED'
  | 'NOT_FOUND' | 'NOT_A_FILE' | 'NOT_A_DIRECTORY' | 'FILE_TOO_LARGE'
  | 'UNSUPPORTED_ENCODING' | 'IO_ERROR' | 'ABORTED' | 'TIMEOUT'
  | 'INVALID_RESULT' | 'INTERNAL_ERROR' | 'APPROVAL_REQUIRED' | 'APPROVAL_DENIED'
  | 'APPROVAL_EXPIRED' | 'PERMISSION_STORE_ERROR' | 'FILE_CONFLICT' | 'FILE_BUSY' | 'WRITE_FAILED'
  | 'NO_MATCH' | 'AMBIGUOUS_MATCH' | 'NO_CHANGES' | 'MIXED_NEWLINES' | 'UNDO_UNAVAILABLE'
  | 'URL_BLOCKED' | 'DNS_FAILED' | 'NETWORK_ERROR' | 'HTTP_ERROR' | 'REDIRECT_LIMIT'
  | 'RESPONSE_TOO_LARGE' | 'UNSUPPORTED_CONTENT_TYPE' | 'SEARCH_NOT_CONFIGURED' | 'SEARCH_FAILED' | 'CONTENT_UNAVAILABLE'
  | 'MCP_CONFIG_INVALID' | 'MCP_DISCONNECTED' | 'MCP_PROTOCOL_ERROR' | 'MCP_TOOL_ERROR' | 'COMMAND_FAILED' | 'SANDBOX_UNAVAILABLE';

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

export type ToolResult<T = unknown> = ({
  success: true;
  output: T;
  error?: never;
} | {
  success: false;
  /** A process may fail after producing output or committing files. */
  output?: T;
  error: { code: ToolErrorCode; message: string };
}) & {
  metadata?: { durationMs: number; toolCallId: string; toolName: string };
};

export interface ToolContext {
  readonly toolCallId: string;
  readonly signal: AbortSignal;
  /** Only the executor supplies this scoped, read-only capability. No raw root path. */
  readonly workspace: WorkspaceAccess;
}

export interface ToolDescriptor {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JSONSchema;
  readonly permission: ToolPermission;
}

export interface ToolDefinition<TInput = unknown, TOutput = unknown> extends ToolDescriptor {
  readonly permission: 'workspace:read';
  /** Generated together with inputSchema by defineTool; never trust model arguments. */
  parseInput(input: unknown): TInput;
  execute(input: TInput, context: ToolContext): Promise<ToolResult<TOutput>>;
}

export type FileChangeIntent = { path: string } & (
  { kind: 'write'; content: string } |
  { kind: 'edit'; edits: Array<{ search: string; replace: string }> }
);

export interface FileMutationToolDefinition<TInput = unknown> extends ToolDescriptor {
  readonly permission: 'workspace:write';
  parseInput(input: unknown): TInput;
  /** Produces data only. The executor owns preview, approval and commit. */
  prepare(input: TInput): FileChangeIntent;
}

export interface NotebookToolDefinition<TInput = unknown> extends ToolDescriptor {
  readonly permission: 'notebook:write';
  parseInput(input: unknown): TInput;
  prepare(input: TInput): NoteChangeIntent;
}
export interface EditingToolDefinition<TInput = unknown> extends ToolDescriptor {
  readonly permission: 'conversation:propose';
  parseInput(input: unknown): TInput;
  prepare(input: TInput): EditingIntent;
}

export interface CommandToolDefinition<TInput = unknown> extends ToolDescriptor {
  readonly permission: 'workspace:execute';
  parseInput(input: unknown): TInput;
  prepare(input: TInput): CommandIntent;
}

export type ToolLifecycleEvent = {
  toolCallId: string;
  toolName: string;
} & ({ type: 'started' } | {
  type: 'completed';
  success: boolean;
  errorCode?: ToolErrorCode;
  durationMs: number;
});

/** Network tools receive no filesystem capability. scope is created by Main, never by the model. */
export interface WebToolContext {
  readonly toolCallId: string;
  readonly signal: AbortSignal;
  readonly scope: object;
}
export interface WebToolDefinition<TInput = unknown, TOutput = unknown> extends ToolDescriptor {
  readonly permission: 'network:read';
  parseInput(input: unknown): TInput;
  execute(input: TInput, context: WebToolContext): Promise<ToolResult<TOutput>>;
}

/** Main-owned identity. Third-party annotations cannot choose a permission level. */
export interface ExternalToolIdentity {
  readonly server: string;
  readonly tool: string;
  readonly fingerprint: string;
}
export interface ExternalToolDefinition<TInput = unknown, TOutput = unknown> extends ToolDescriptor {
  readonly permission: 'external:execute';
  readonly external: ExternalToolIdentity;
  parseInput(input: unknown): TInput;
  execute(input: TInput, context: Pick<ToolContext, 'toolCallId' | 'signal'>): Promise<ToolResult<TOutput>>;
}
