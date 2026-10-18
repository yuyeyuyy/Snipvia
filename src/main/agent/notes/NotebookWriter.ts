import { randomUUID } from 'node:crypto';
import { agentNotePathSchema, type NoteChangeIntent, type NoteChangeSummary } from '../../../shared/agent/note-writing';
import type { Notebook } from '../../../shared/notes';
import type { AgentDiffView } from '../../../shared/agent/execution';
import { ToolError, throwIfAborted } from '../ToolError';
import { WorkspaceService, type WorkspaceGrant, type FileSnapshot } from '../WorkspaceService';
import { applySearchReplace, createFileDiff, newlineStyle, normalizeNewlines, validateText } from '../fileChanges/textPatch';
import { utf8Prefix } from '../web/operation';

interface Scope { notebook: Notebook; grant: WorkspaceGrant; active: boolean; readOnly: boolean; writtenPaths: Set<string>; changes: Map<string, RecordValue>; receipts: Map<string, NoteChangeSummary> }
type NoteVersion = Pick<FileSnapshot, 'path' | 'content' | 'bom' | 'version'>;
/** `restorable` is false when either side was too large or undecodable, so content is unknown (not absent). */
interface RecordValue { summary: NoteChangeSummary; before: NoteVersion; after: NoteVersion; diff: AgentDiffView; restorable: boolean }
/** Serializable per-run record used by NoteCheckpointStore for Undo. */
export interface CheckpointFile {
  summary: NoteChangeSummary;
  before: { path: string; content: string | null; bom: boolean };
  after: { path: string; content: string | null; bom: boolean };
  restorable: boolean;
  diff: AgentDiffView;
}
export type ExternalNoteVersion = { path: string; content: string | null; version: string; truncated?: boolean };

/** Automatic note edits have a separate, Main-owned capability. General file tools stay read-only. */
export class NotebookWriter {
  private readonly scopes = new WeakMap<object, Scope>();
  private readonly records = new Map<string, AgentDiffView>();
  constructor(private readonly deps: {
    workspaces: WorkspaceService;
    notebook(id: string): Promise<Notebook>;
    beforeWrite(notebookId: string, signal: AbortSignal): Promise<void>;
    changed(notebookId: string): void;
  }) {}
  createScope(notebook: Notebook, grant: WorkspaceGrant, readOnly = false): object {
    if (this.deps.workspaces.displayPath(grant) !== notebook.directory) throw new ToolError('WORKSPACE_CHANGED', '笔记本授权范围不一致');
    const capability = Object.freeze({});
    this.scopes.set(capability, { notebook: { ...notebook }, grant, active: true, readOnly, writtenPaths: new Set(), changes: new Map(), receipts: new Map() });
    return capability;
  }
  closeScope(capability?: object) { if (capability) { const scope = this.scopes.get(capability); if (scope) scope.active = false; } }
  diff(id: string): AgentDiffView {
    const value = this.records.get(id);
    if (!value) throw new ToolError('NOT_FOUND', '修改预览已过期，可打开笔记查看当前内容');
    return structuredClone(value);
  }
  async apply(capability: object | undefined, intent: NoteChangeIntent, signal: AbortSignal): Promise<NoteChangeSummary> {
    const scope = capability && this.scopes.get(capability);
    if (!scope?.active) throw new ToolError('WORKSPACE_REQUIRED', '请先选择当前对话的笔记本');
    if (scope.readOnly) throw new ToolError('PERMISSION_DENIED', '本轮笔记本只读');
    const path = agentNotePathSchema.safeParse(intent.path);
    if (!path.success) throw new ToolError('PERMISSION_DENIED', '只允许所选笔记本中的 Markdown，不能写附件或隐藏目录');
    throwIfAborted(signal);
    let notebook: Notebook;
    try { notebook = await this.deps.notebook(scope.notebook.id); }
    catch { throw new ToolError('WORKSPACE_CHANGED', '笔记本链接或目录已失效，请重新选择'); }
    if (notebook.directory !== scope.notebook.directory) throw new ToolError('WORKSPACE_CHANGED', '笔记本目录已经改变');
    await this.deps.beforeWrite(notebook.id, signal);
    throwIfAborted(signal);
    if (!scope.active) throw new ToolError('WORKSPACE_CHANGED', '笔记写入授权已结束');
    const fingerprint = JSON.stringify(intent);
    const previous = scope.receipts.get(fingerprint);
    if (previous) {
      const saved = scope.changes.get(previous.path)!;
      const current = await this.deps.workspaces.snapshot(scope.grant, previous.path, signal);
      if (current.version !== saved.after.version) throw new ToolError('FILE_CONFLICT', '笔记已再次改变，请重新读取');
      return structuredClone(saved.summary);
    }
    if ((!scope.writtenPaths.has(path.data) && scope.writtenPaths.size >= 8) || scope.receipts.size >= 16 || (!scope.changes.has(path.data) && scope.changes.size >= 100)) throw new ToolError('FILE_TOO_LARGE', '笔记工具每次任务最多写入 8 篇、提交 16 次');
    const before = await this.deps.workspaces.snapshot(scope.grant, path.data, signal);
    if (intent.kind === 'create' && before.content !== null) throw new ToolError('FILE_CONFLICT', '目标笔记已存在，请读取后编辑，不能覆盖');
    if (intent.kind !== 'create' && before.content === null) throw new ToolError('NOT_FOUND', '目标笔记不存在，请先创建');
    let after: string;
    const bom = before.content === null ? intent.kind !== 'edit' && intent.content.startsWith('\ufeff') : before.bom;
    if (intent.kind === 'edit') after = applySearchReplace(before.content!, intent.edits);
    else {
      const incoming = normalizeNewlines(intent.content.replace(/^\ufeff/, ''), newlineStyle(before.content ?? intent.content));
      after = intent.kind === 'create' ? incoming : before.content! + (before.content!.endsWith('\n') || !before.content ? '' : normalizeNewlines('\n', newlineStyle(before.content!))) + incoming;
    }
    validateText(after);
    if (after === before.content) throw new ToolError('NO_CHANGES', '笔记内容没有变化');
    const previewDiff = createFileDiff(path.data, before.content, after);
    if (Buffer.byteLength(previewDiff) > 512 * 1024) throw new ToolError('FILE_TOO_LARGE', '差异过长，请拆分修改');
    throwIfAborted(signal);
    if (!scope.active || (await this.deps.notebook(notebook.id)).directory !== notebook.directory) throw new ToolError('WORKSPACE_CHANGED', '写入前笔记本授权已变化');
    await this.deps.beforeWrite(notebook.id, signal);
    // Wait for the atomic syscall's actual result, even if Stop arrives during commit.
    const committed = await this.deps.workspaces.commitSnapshot(before, after, bom, signal);
    const original = scope.changes.get(path.data)?.before ?? before;
    const diff = createFileDiff(path.data, original.content, committed.content);
    const lines = diff.split('\n');
    const summary: NoteChangeSummary = {
      id: scope.changes.get(path.data)?.summary.id ?? randomUUID(), notebookId: notebook.id, notebookName: notebook.name,
      path: path.data, operation: original.path !== path.data ? 'move' : original.content === null ? 'create' : 'edit',
      ...(original.path !== path.data ? { previousPath: original.path } : {}),
      added: lines.filter(line => line.startsWith('+') && !line.startsWith('+++')).length,
      removed: lines.filter(line => line.startsWith('-') && !line.startsWith('---')).length
    };
    const bounded = utf8Prefix(diff, 512 * 1024);
    const value: RecordValue = { summary, before: original, after: committed, diff: { path: path.data, diff: bounded, truncated: bounded !== diff },
      restorable: scope.changes.get(path.data)?.restorable ?? true };
    scope.writtenPaths.add(path.data); scope.changes.set(path.data, value); scope.receipts.set(fingerprint, summary); this.remember(summary.id, value.diff);
    try { this.deps.changed(notebook.id); } catch { /* A notification cannot roll back committed content. */ }
    return structuredClone(summary);
  }
  /** Internal capability shared with the sandboxed command runner, never an IPC argument. */
  async prepareCommand(capability: object | undefined, signal: AbortSignal) {
    const scope = capability && this.scopes.get(capability);
    if (!scope?.active) throw new ToolError('WORKSPACE_REQUIRED', '请先选择当前对话的笔记本');
    throwIfAborted(signal);
    const notebook = await this.deps.notebook(scope.notebook.id).catch(() => { throw new ToolError('WORKSPACE_CHANGED', '笔记本链接已失效'); });
    if (notebook.directory !== scope.notebook.directory) throw new ToolError('WORKSPACE_CHANGED', '笔记本目录已改变');
    await this.deps.beforeWrite(notebook.id, signal); throwIfAborted(signal);
    if (!scope.active) throw new ToolError('WORKSPACE_CHANGED', '本轮命令能力已结束');
    return { notebook, grant: scope.grant, readOnly: scope.readOnly };
  }
  /** Record host-observed changes even after Stop; output text from a child cannot forge this list. */
  recordCommandChange(capability: object, before: ExternalNoteVersion | undefined, after: ExternalNoteVersion | undefined): NoteChangeSummary | null {
    const scope = this.scopes.get(capability);
    if (!scope?.active) throw new ToolError('WORKSPACE_REQUIRED', '笔记运行范围已结束');
    const path = after?.path ?? before?.path;
    if (!path || !agentNotePathSchema.safeParse(path).success) return null;
    const previous = scope.changes.get(before?.path ?? path) ?? scope.changes.get(path);
    if (!previous && scope.changes.size >= 100) return null;
    const original: NoteVersion = previous?.before ?? { path: before?.path ?? path, content: before?.content ?? null, bom: false, version: before?.version ?? '' };
    const final: NoteVersion = { path, content: after?.content ?? null, bom: false, version: after?.version ?? '' };
    const moved = original.path !== path;
    const diff = `${moved ? `rename from ${original.path}\nrename to ${path}\n` : ''}${createFileDiff(path, original.content, final.content)}`;
    const lines = diff.split('\n'), bounded = utf8Prefix(diff, 512 * 1024);
    const summary: NoteChangeSummary = { id: previous?.summary.id ?? randomUUID(), notebookId: scope.notebook.id, notebookName: scope.notebook.name,
      path, operation: !after ? 'delete' : moved ? 'move' : previous?.summary.operation === 'create' || !before && !previous ? 'create' : 'edit', ...(moved ? { previousPath: original.path } : {}),
      added: lines.filter(line => line.startsWith('+') && !line.startsWith('+++')).length, removed: lines.filter(line => line.startsWith('-') && !line.startsWith('---')).length };
    const value: RecordValue = { summary, before: original, after: final, diff: { path, diff: bounded || '文件已改变，暂无文本差异。', truncated: bounded !== diff || !!before?.truncated || !!after?.truncated },
      // A truncated side has unknown content; Undo must never treat it as "absent" and delete a file.
      restorable: (previous ? previous.restorable : !before?.truncated) && !after?.truncated };
    if (before && before.path !== path) scope.changes.delete(before.path);
    scope.changes.set(path, value); scope.receipts.clear(); this.remember(summary.id, value.diff);
    return structuredClone(summary);
  }
  /** Final before/after state of every note changed through this scope, for a persistent checkpoint. */
  checkpointFiles(capability: object | undefined): CheckpointFile[] {
    const scope = capability && this.scopes.get(capability);
    if (!scope) return [];
    return [...scope.changes.values()].map((value) => structuredClone({ summary: value.summary, restorable: value.restorable, diff: value.diff,
      before: { path: value.before.path, content: value.before.content, bom: value.before.bom },
      after: { path: value.after.path, content: value.after.content, bom: value.after.bom } }));
  }
  notifyCommand(capability: object) { const scope = this.scopes.get(capability); if (scope) { try { this.deps.changed(scope.notebook.id); } catch { /* Physical changes remain committed. */ } } }
  private remember(id: string, diff: AgentDiffView) {
    this.records.set(id, diff);
    while (this.records.size > 100 || [...this.records.values()].reduce((total, item) => total + Buffer.byteLength(item.diff), 0) > 4 * 1024 * 1024) this.records.delete(this.records.keys().next().value!);
  }
}
