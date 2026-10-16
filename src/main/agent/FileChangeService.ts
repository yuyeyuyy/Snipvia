import { randomUUID } from 'node:crypto';
import type { FileChangePreview } from '../../shared/agent-file-change';
import { PermissionManager, type ApprovalReceipt, type PermissionCallOptions } from './PermissionManager';
import { ToolError, throwIfAborted } from './ToolError';
import { fileHash, WorkspaceService, type FileSnapshot, type WorkspaceGrant } from './WorkspaceService';
import type { FileChangeIntent } from './types/tool';
import { applySearchReplace, createFileDiff, newlineStyle, normalizeNewlines, validateText } from './fileChanges/textPatch';

export interface PreparedFileChange { readonly preview: Readonly<FileChangePreview> }
export interface FileChangeOutput { path: string; operation: FileChangePreview['operation']; beforeHash: string | null; afterHash: string | null; undoId: string }
type Plan = { grant: WorkspaceGrant; before: FileSnapshot; after: string | null; bom: boolean; toolName: string; undoOf?: string };
type UndoRecord = { grant: WorkspaceGrant; before: FileSnapshot; after: FileSnapshot };

export class FileChangeService {
  private readonly plans = new WeakMap<PreparedFileChange, Plan>();
  private readonly undoRecords = new Map<string, UndoRecord>();
  constructor(private readonly workspaces: WorkspaceService, readonly permissions: PermissionManager) {}

  async prepare(intent: FileChangeIntent, grant: WorkspaceGrant, toolCallId: string, signal: AbortSignal): Promise<PreparedFileChange> {
    const before = await this.workspaces.snapshot(grant, intent.path, signal);
    if (intent.kind === 'edit' && before.content === null) throw new ToolError('NOT_FOUND', 'edit_file 只能修改已存在的文件');
    const style = newlineStyle(before.content ?? (intent.kind === 'write' ? intent.content : ''));
    const bom = before.content !== null ? before.bom : intent.kind === 'write' && intent.content.startsWith('\ufeff');
    const after = intent.kind === 'edit' ? applySearchReplace(before.content!, intent.edits) :
      normalizeNewlines(intent.content.replace(/^\ufeff/, ''), style);
    validateText(after);
    if (after === before.content) throw new ToolError('NO_CHANGES', '文件内容没有变化');
    throwIfAborted(signal);
    return this.createPlan({ grant, before, after, bom, toolName: intent.kind === 'edit' ? 'edit_file' : 'write_file' }, toolCallId);
  }

  async prepareUndo(undoId: string, grant: WorkspaceGrant, toolCallId: string, signal: AbortSignal): Promise<PreparedFileChange> {
    const saved = this.undoRecords.get(undoId);
    if (!saved || saved.grant !== grant) throw new ToolError('UNDO_UNAVAILABLE', '撤销记录不存在、已过期或不属于当前 workspace');
    const current = await this.workspaces.snapshot(grant, saved.after.path, signal);
    if (current.version !== saved.after.version) throw new ToolError('FILE_CONFLICT', '文件已再次修改，不能撤销覆盖');
    return this.createPlan({ grant, before: current, after: saved.before.content, bom: saved.before.bom, toolName: 'undo_file_change', undoOf: undoId }, toolCallId);
  }

  approve(plan: PreparedFileChange, signal: AbortSignal, options: PermissionCallOptions & { toolName?: string } = {}): Promise<ApprovalReceipt> {
    const saved = this.plans.get(plan);
    if (!saved) throw new ToolError('APPROVAL_REQUIRED', '修改提案无效');
    return this.permissions.request(plan.preview, signal, { ...options, toolName: options.toolName ?? saved.toolName,
      workspaceIdentity: this.workspaces.permissionIdentity(saved.grant) });
  }

  async commit(plan: PreparedFileChange, receipt: ApprovalReceipt, signal: AbortSignal): Promise<FileChangeOutput> {
    const saved = this.plans.get(plan);
    if (!saved) throw new ToolError('APPROVAL_REQUIRED', '修改提案无效或已提交');
    this.plans.delete(plan);
    throwIfAborted(signal);
    this.permissions.consume(receipt, plan.preview);
    const after = await this.workspaces.commitSnapshot(saved.before, saved.after, saved.bom, signal);
    const undoId = randomUUID();
    if (saved.undoOf) this.undoRecords.delete(saved.undoOf);
    this.undoRecords.set(undoId, { grant: saved.grant, before: saved.before, after });
    // Process-local foundation: bounded snapshots, no hidden persistent copies of user files.
    while (this.undoRecords.size > 20) this.undoRecords.delete(this.undoRecords.keys().next().value!);
    return { path: plan.preview.path, operation: plan.preview.operation, beforeHash: saved.before.hash, afterHash: after.hash, undoId };
  }

  clearUndo(): void { this.undoRecords.clear(); }

  private createPlan(saved: Plan, toolCallId: string): PreparedFileChange {
    if (saved.after !== null && Buffer.byteLength(saved.after, 'utf8') + (saved.bom ? 3 : 0) > 256 * 1024) {
      throw new ToolError('FILE_TOO_LARGE', '文件预览与写入最多支持 256 KiB（含 BOM）');
    }
    const preview: FileChangePreview = Object.freeze({
      id: randomUUID(), toolCallId, workspaceId: saved.grant.id,
      workspacePath: this.workspaces.displayPath(saved.grant), path: saved.before.path,
      operation: saved.after === null ? 'delete' : saved.before.content === null ? 'create' : 'replace',
      before: saved.before.content, after: saved.after,
      beforeHash: saved.before.hash,
      afterHash: saved.after === null ? null : fileHash(Buffer.from(`${saved.bom ? '\ufeff' : ''}${saved.after}`)),
      diff: createFileDiff(saved.before.path, saved.before.content, saved.after),
      newline: newlineStyle(saved.after ?? saved.before.content ?? ''), utf8Bom: saved.bom
    });
    const plan = Object.freeze({ preview });
    this.plans.set(plan, saved);
    return plan;
  }
}
