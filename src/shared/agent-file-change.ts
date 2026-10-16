export interface FileChangePreview {
  id: string;
  toolCallId: string;
  workspaceId: string;
  workspacePath: string;
  path: string;
  operation: 'create' | 'replace' | 'delete';
  before: string | null;
  after: string | null;
  beforeHash: string | null;
  afterHash: string | null;
  diff: string;
  newline: 'LF' | 'CRLF';
  utf8Bom: boolean;
}

export interface FileApprovalRequest {
  approvalId: string;
  expiresAt: number;
  preview: FileChangePreview;
}
