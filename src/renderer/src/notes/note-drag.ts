import type { NoteEntry } from '../../../shared/notes';

export const noteDragType = 'application/x-snipvia-note';
export const isVisibleNoteEntry = (entry: NoteEntry) => entry.path !== 'assets' && !entry.path.startsWith('assets/');
export type NoteDropTarget = { parent: string; destination: string; reason: string | null };

/** UI feedback only; the main process independently validates and performs the move. */
export function noteDropTarget(source: NoteEntry, parent: string, entries: NoteEntry[]): NoteDropTarget {
  const destination = [parent, source.name].filter(Boolean).join('/');
  let reason: string | null = null;
  if (!isVisibleNoteEntry(source) || parent === 'assets' || parent.startsWith('assets/')) reason = '附件目录不支持拖拽移动';
  else if (parent === source.path || parent.startsWith(`${source.path}/`)) reason = '不能移入自身或子文件夹';
  else if (parent && !entries.some((entry) => entry.path === parent && entry.kind === 'folder')) reason = '目标文件夹已不存在';
  else if (destination === source.path) reason = '已在此目录中';
  else if (entries.some((entry) => entry.path === destination)) reason = '目标目录已有同名文件或文件夹';
  return { parent, destination, reason };
}
