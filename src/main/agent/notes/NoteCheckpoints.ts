import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { noteChangeSchema } from '../../../shared/agent/note-writing';
import type { Notebook } from '../../../shared/notes';
import type { AgentDiffView } from '../../../shared/agent/execution';
import { ToolError, throwIfAborted } from '../ToolError';
import type { FileSnapshot, WorkspaceService } from '../WorkspaceService';
import type { CheckpointFile } from './NotebookWriter';

const side = z.strictObject({ path: z.string().min(1).max(4096), content: z.string().max(512 * 1024).nullable(), bom: z.boolean() });
const checkpointSchema = z.strictObject({
  version: z.literal(1),
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  notebookId: z.string().uuid(),
  notebookDirectory: z.string().min(1).max(4096),
  createdAt: z.string().max(64),
  revertedAt: z.string().max(64).optional(),
  files: z.array(z.strictObject({
    summary: noteChangeSchema, before: side, after: side, restorable: z.boolean(),
    diff: z.strictObject({ path: z.string().max(4096), diff: z.string().max(1024 * 1024), truncated: z.boolean() })
  })).min(1).max(100)
});
export type NoteCheckpoint = z.infer<typeof checkpointSchema>;
export interface UndoState { available: boolean; reverted: boolean; reason?: string }

const maxCheckpoints = 100;
const maxBytes = 64 * 1024 * 1024;

/**
 * Per-run snapshots of notes the Agent changed, like OpenCode's per-turn checkpoints but
 * limited to the selected notebook's Markdown. Stored under userData (same sensitivity as
 * local chat history) and deleted together with the conversation.
 */
export class NoteCheckpointStore {
  private index: Map<string, string> | undefined; // changeId → checkpointId
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly directory: string) {}

  save(input: { id: string; conversationId: string; notebookId: string; notebookDirectory: string; files: CheckpointFile[] }): Promise<void> {
    return this.serial(async () => {
      const parsed = checkpointSchema.safeParse({ version: 1, createdAt: new Date().toISOString(), ...input });
      if (!parsed.success) throw new Error('笔记检查点格式无效');
      await this.write(parsed.data);
      const index = await this.loadIndex();
      for (const file of parsed.data.files) index.set(file.summary.id, parsed.data.id);
      await this.prune();
    });
  }
  async findByChange(changeId: string): Promise<NoteCheckpoint | undefined> {
    const id = (await this.loadIndex()).get(changeId);
    return id ? this.read(id) : undefined;
  }
  markReverted(id: string): Promise<void> {
    return this.serial(async () => {
      const checkpoint = await this.read(id);
      if (checkpoint) await this.write({ ...checkpoint, revertedAt: new Date().toISOString() });
    });
  }
  /** Deleting a conversation deletes the note contents kept for its Undo. */
  deleteConversation(conversationId: string): Promise<void> {
    return this.serial(async () => {
      for (const checkpoint of await this.all()) if (checkpoint.conversationId === conversationId) await rm(this.file(checkpoint.id), { force: true });
      this.index = undefined;
    });
  }
  clear(): Promise<void> {
    return this.serial(async () => { await rm(this.directory, { recursive: true, force: true }); this.index = undefined; });
  }

  private file(id: string): string { return path.join(this.directory, `${z.string().uuid().parse(id)}.json`); }
  private async write(checkpoint: NoteCheckpoint): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const temporary = path.join(this.directory, `.${randomUUID()}.tmp`);
    await writeFile(temporary, JSON.stringify(checkpoint), { mode: 0o600 });
    await rename(temporary, this.file(checkpoint.id));
  }
  private async read(id: string): Promise<NoteCheckpoint | undefined> {
    try {
      const parsed = checkpointSchema.safeParse(JSON.parse(await readFile(this.file(id), 'utf8')));
      return parsed.success ? parsed.data : undefined;
    } catch { return undefined; }
  }
  private async names(): Promise<string[]> {
    try { return (await readdir(this.directory)).filter((name) => /^[0-9a-f-]{36}\.json$/.test(name)); }
    catch { return []; }
  }
  private async all(): Promise<NoteCheckpoint[]> {
    const values = await Promise.all((await this.names()).map((name) => this.read(name.slice(0, -5))));
    return values.filter((value): value is NoteCheckpoint => !!value);
  }
  private async loadIndex(): Promise<Map<string, string>> {
    if (!this.index) {
      this.index = new Map();
      for (const checkpoint of await this.all()) for (const file of checkpoint.files) this.index.set(file.summary.id, checkpoint.id);
    }
    return this.index;
  }
  private async prune(): Promise<void> {
    const entries = await Promise.all((await this.names()).map(async (name) => {
      const info = await stat(path.join(this.directory, name)).catch(() => undefined);
      return { name, size: info?.size ?? 0, time: info?.mtimeMs ?? 0 };
    }));
    entries.sort((a, b) => b.time - a.time);
    let total = 0, removed = false;
    for (const [position, entry] of entries.entries()) {
      total += entry.size;
      if (position >= maxCheckpoints || total > maxBytes) { await rm(path.join(this.directory, entry.name), { force: true }); removed = true; }
    }
    if (removed) this.index = undefined;
  }
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation);
    this.queue = next.catch(() => {});
    return next;
  }
}

export interface NoteUndoDeps {
  workspaces: WorkspaceService;
  notebook(id: string): Promise<Notebook>;
  /** Flush unsaved editor drafts first, so the conflict check sees what the user typed. */
  flush(signal: AbortSignal): Promise<void>;
  changed(notebookId: string): void;
}

function conflict(file: string): ToolError {
  return new ToolError('FILE_CONFLICT', `「${file}」在这次修改之后又发生了变化（手动编辑或更晚的 Agent 修改），为避免覆盖，未撤销任何笔记。请先撤销更晚的修改或手动处理。`);
}

/** Restores every note in a checkpoint only if each file is still exactly what the Agent left. */
export async function undoCheckpoint(checkpoint: NoteCheckpoint, deps: NoteUndoDeps, signal: AbortSignal): Promise<{ restored: number }> {
  if (checkpoint.revertedAt) throw new ToolError('NO_CHANGES', '这次修改已经撤销');
  if (checkpoint.files.some((file) => !file.restorable)) throw new ToolError('UNDO_UNAVAILABLE', '部分笔记过大或无法按文本读取，不能自动撤销；请查看差异后手动恢复');
  const notebook = await deps.notebook(checkpoint.notebookId).catch(() => { throw new ToolError('WORKSPACE_CHANGED', '笔记本链接已失效，无法撤销'); });
  if (notebook.directory !== checkpoint.notebookDirectory) throw new ToolError('WORKSPACE_CHANGED', '笔记本目录已改变，无法撤销');
  await deps.flush(signal);
  throwIfAborted(signal);
  const grant = await deps.workspaces.authorizeWorkspace(notebook.directory);
  try {
    // 1. Verify everything before touching any file.
    const plans: Array<{ file: CheckpointFile; after: FileSnapshot | null; target: FileSnapshot | null }> = [];
    for (const file of checkpoint.files) {
      const after = file.after.content === null ? null : await deps.workspaces.snapshot(grant, file.after.path, signal);
      if (after && (after.content !== file.after.content)) throw conflict(file.after.path);
      let target: FileSnapshot | null = null;
      if (file.before.content !== null && (file.after.content === null || file.before.path !== file.after.path)) {
        target = await deps.workspaces.snapshot(grant, file.before.path, signal).catch((error) => {
          if (error instanceof ToolError && error.code === 'NOT_A_DIRECTORY') throw new ToolError('UNDO_UNAVAILABLE', `「${file.before.path}」原来所在的目录已不存在，无法恢复`);
          throw error;
        });
        if (target.content !== null) throw conflict(file.before.path);
      }
      plans.push({ file, after, target });
    }
    // 2. Apply. commitSnapshot re-checks each file's version right before its syscall.
    let restored = 0;
    try {
      for (const { file, after, target } of plans) {
        if (file.before.content !== null) {
          if (target) await deps.workspaces.commitSnapshot(target, file.before.content, file.before.bom, signal);
          else await deps.workspaces.commitSnapshot(after!, file.before.content, file.before.bom, signal);
        }
        if (after && (file.before.content === null || file.before.path !== file.after.path)) {
          await deps.workspaces.commitSnapshot(await deps.workspaces.snapshot(grant, file.after.path, signal), null, false, signal);
        }
        restored++;
      }
    } catch (error) {
      if (!restored) throw error;
      try { deps.changed(notebook.id); } catch { /* Report the partial result below. */ }
      throw new ToolError('WRITE_FAILED', `已恢复 ${restored} 篇笔记，其余 ${plans.length - restored} 篇未能恢复：${error instanceof Error ? error.message : '写入失败'}`);
    }
    try { deps.changed(notebook.id); } catch { /* Files are already restored. */ }
    return { restored };
  } finally { deps.workspaces.revoke(grant); }
}

export function undoState(checkpoint: NoteCheckpoint | undefined): UndoState {
  if (!checkpoint) return { available: false, reverted: false, reason: '这次修改没有可用的检查点' };
  if (checkpoint.revertedAt) return { available: false, reverted: true };
  if (checkpoint.files.some((file) => !file.restorable)) return { available: false, reverted: false, reason: '部分笔记过大，不能自动撤销' };
  return { available: true, reverted: false };
}

export function checkpointDiff(checkpoint: NoteCheckpoint, changeId: string): AgentDiffView | undefined {
  return checkpoint.files.find((file) => file.summary.id === changeId)?.diff;
}
