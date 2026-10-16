import type { FileChangePreview } from '../agent-file-change';

export type PermissionRisk = 'SAFE' | 'REVIEW' | 'DANGEROUS';
export type PermissionDecision = 'allow_once' | 'allow_session' | 'always_allow' | 'deny';
export interface CommandRiskSummary {
  risk: PermissionRisk;
  reasons: string[];
  blocked: boolean;
  /** Only a literal, single command may later be passed as argv with shell:false. */
  argv?: string[];
}
export interface PermissionRequest {
  requestId: string;
  toolCallId: string;
  toolName: string;
  risk: PermissionRisk;
  reasons: string[];
  workspacePath: string;
  target: string;
  scopeDescription: string;
  expiresAt: number;
  allowedDecisions: PermissionDecision[];
  preview?: FileChangePreview;
  command?: CommandRiskSummary;
  argumentsText?: string;
}
export type PermissionEvent =
  | { type: 'permission_request'; request: PermissionRequest }
  | { type: 'permission_resolved'; requestId: string; toolCallId: string; outcome: PermissionDecision | 'cancelled' | 'expired' | 'failed' };
export interface AgentPermissionAPI {
  current(): Promise<PermissionRequest>;
  onRequest(callback: (request: PermissionRequest) => void): () => void;
  decide(requestId: string, decision: PermissionDecision): Promise<void>;
  /** Available only in the review window; clears persistent grants, never creates one. */
  clearRemembered(): Promise<void>;
}
