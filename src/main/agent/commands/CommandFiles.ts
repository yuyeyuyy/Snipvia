import { constants } from 'node:fs';
import { lstat, open, opendir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { agentNotePathSchema, type NoteChangeSummary } from '../../../shared/agent/note-writing';
import { ToolError, throwIfAborted } from '../ToolError';
import type { NotebookWriter, ExternalNoteVersion } from '../notes/NotebookWriter';

interface Entry extends ExternalNoteVersion { identity: string; hash: string }
export interface CommandFiles { notes: Map<string, Entry>; directories: Set<string>; rootIdentity: string }
const identity = (stat: Awaited<ReturnType<typeof lstat>>) => `${stat.dev}:${stat.ino}`;

/** Bounded, host-owned inventory. Never follows symlinks or reads hidden files / attachments. */
export async function inspectCommandFiles(root: string, signal: AbortSignal, rejectHardlinks: boolean): Promise<CommandFiles> {
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || await realpath(root) !== root) throw new ToolError('WORKSPACE_CHANGED', '笔记本目录已改变');
  const notes = new Map<string, Entry>(), directories = new Set<string>(), pending = ['']; let entries = 0, remainingText = 8 * 1024 * 1024;
  while (pending.length) {
    throwIfAborted(signal);
    const parent = pending.pop()!;
    for await (const entry of await opendir(path.join(root, parent))) {
      throwIfAborted(signal);
      if (++entries > 10_000) throw new ToolError('FILE_TOO_LARGE', '笔记本超过 10000 个条目，请缩小命令范围');
      if (entry.name.startsWith('.')) continue;
      const relative = parent ? `${parent}/${entry.name}` : entry.name, full = path.join(root, relative), stat = await lstat(full);
      if (stat.isSymbolicLink()) continue;
      if (await realpath(full) !== full) throw new ToolError('PATH_CHANGED', '采集期间笔记路径被替换');
      if (stat.isDirectory()) { if (relative.split('/').length > 40) throw new ToolError('FILE_TOO_LARGE', '笔记本目录深度超过 40 层，无法完整核对命令变更'); directories.add(relative); pending.push(relative); continue; }
      if (!stat.isFile()) continue;
      if (stat.nlink > 1) { if (rejectHardlinks) throw new ToolError('SYMLINK_NOT_ALLOWED', '笔记本含硬链接，无法安全执行命令；请先移除链接'); else continue; }
      if (!agentNotePathSchema.safeParse(relative).success) continue;
      let content: string | null = null, hash = `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`, truncated = true;
      if (stat.size <= 256 * 1024 && stat.size <= remainingText) {
        const file = await open(full, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
        try {
          const opened = await file.stat();
          if (!opened.isFile() || opened.nlink > 1 || identity(opened) !== identity(stat) || await realpath(full) !== full) throw new ToolError('PATH_CHANGED', '采集笔记变更时文件被替换');
          const bytes = Buffer.alloc(stat.size + 1); let total = 0;
          while (total < bytes.length) { const read = await file.read(bytes, total, bytes.length - total, total); if (!read.bytesRead) break; total += read.bytesRead; }
          const final = await file.stat();
          if (total !== stat.size || final.size !== stat.size || final.mtimeMs !== stat.mtimeMs || identity(await lstat(full)) !== identity(stat) || await realpath(full) !== full) throw new ToolError('FILE_CONFLICT', '采集笔记变更时文件仍在写入');
          const data = bytes.subarray(0, total); hash = createHash('sha256').update(data).digest('hex');
          try { content = new TextDecoder('utf-8', { fatal: true }).decode(data); truncated = false; remainingText -= total; } catch { /* Keep metadata for binary/non-UTF8 Markdown, without decoding it. */ }
        } finally { await file.close(); }
      }
      notes.set(relative, { path: relative, identity: identity(stat), hash, content, version: hash, truncated });
    }
  }
  if (identity(await lstat(root)) !== identity(rootStat)) throw new ToolError('WORKSPACE_CHANGED', '采集期间笔记本目录被替换');
  return { notes, directories, rootIdentity: identity(rootStat) };
}

export function commandNoteChanges(writer: NotebookWriter, scope: object, before: CommandFiles, after: CommandFiles) {
  if (before.rootIdentity !== after.rootIdentity) throw new ToolError('WORKSPACE_CHANGED', '执行期间笔记本目录被替换');
  const changes: NoteChangeSummary[] = [], matched = new Set<string>(); let truncated = false;
  const missing = [...before.notes.values()].filter(note => !after.notes.has(note.path));
  for (const note of after.notes.values()) {
    const previous = before.notes.get(note.path) ?? missing.find(value => !matched.has(value.path) && value.identity === note.identity);
    if (previous) matched.add(previous.path);
    if (previous?.path === note.path && previous.hash === note.hash) continue;
    const change = writer.recordCommandChange(scope, previous, note);
    if (change) changes.push(change); else truncated = true;
  }
  for (const note of missing) {
    if (matched.has(note.path)) continue;
    const change = writer.recordCommandChange(scope, note, undefined);
    if (change) changes.push(change); else truncated = true;
  }
  return { noteChanges: changes, changesTruncated: truncated,
    createdDirectories: [...after.directories].filter(value => !before.directories.has(value)).slice(0, 100),
    removedDirectories: [...before.directories].filter(value => !after.directories.has(value)).slice(0, 100) };
}
