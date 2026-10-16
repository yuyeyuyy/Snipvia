import { useEffect, useMemo, useRef, useState } from 'react';
import type { NoteChangeSummary } from '../../../shared/agent/note-writing';
import type { AgentDiffView } from '../../../shared/agent/execution';
import { Icon } from '../components/Icon';

export function NoteChanges({ changes, captureId, conversationId, onError }: { conversationId?: string; changes: NoteChangeSummary[]; captureId?: string; onError(message: string): void }) {
  const [expanded, setExpanded] = useState(false); const [busy, setBusy] = useState(false);
  const [diff, setDiff] = useState<AgentDiffView | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [undo, setUndo] = useState<{ available: boolean; reverted: boolean; reason?: string } | null>(null);
  const [confirming, setConfirming] = useState(false); const [undone, setUndone] = useState<number | null>(null);
  const target = useMemo(() => conversationId ? { conversationId } : captureId, [captureId, conversationId]);
  const anchor = changes[0]?.id;
  useEffect(() => { if (diff) dialog.current?.showModal(); }, [diff]);
  useEffect(() => {
    if (!target || !anchor) return;
    let current = true;
    void window.snipvia.agent.noteUndoState(target, anchor).then((result) => { if (current && result.ok) setUndo(result.value); }).catch(() => {});
    return () => { current = false; };
  }, [target, anchor]);
  if (!changes.length) return null;
  async function revert() {
    if (!target || busy || !anchor) return;
    if (!confirming) { setConfirming(true); return; }
    setBusy(true);
    try {
      const result = await window.snipvia.agent.undoNotes(target, anchor);
      if (!result.ok) { onError(result.error); return; }
      setUndone(result.value.restored); setUndo({ available: false, reverted: true });
    } catch { onError('撤销失败，请打开笔记检查'); }
    finally { setBusy(false); setConfirming(false); }
  }
  async function open(change: NoteChangeSummary) {
    if (!target || busy) return; setBusy(true);
    try { const result = await window.snipvia.agent.openNote(target, change.id); if (!result.ok) onError(result.error); }
    catch { onError('无法打开笔记，请检查笔记本链接'); }
    finally { setBusy(false); }
  }
  async function review() {
    if (!target || busy) return; setBusy(true);
    try {
      const values = await Promise.all(changes.map(change => window.snipvia.agent.noteDiff(target, change.id)));
      const failed = values.find(value => !value.ok); if (failed && !failed.ok) throw new Error(failed.error);
      const diffs = values.flatMap(value => value.ok ? [value.value] : []);
      setDiff({ path: changes.length === 1 ? changes[0].path : `${changes.length} 篇笔记`, diff: diffs.map(value => value.diff).join('\n\n'), truncated: diffs.some(value => value.truncated) });
    } catch (error) { onError(error instanceof Error ? error.message : '无法读取修改记录'); }
    finally { setBusy(false); }
  }
  const added = changes.reduce((count, value) => count + value.added, 0), removed = changes.reduce((count, value) => count + value.removed, 0);
  return <section className="agent-note-changes" aria-label="已编辑笔记">
    <header><Icon name="notebook" size={20} /><div><strong>已编辑 {changes.length} 篇笔记</strong><small><span className="added">+{added}</span> <span className="removed">−{removed}</span></small></div>
      <div className="agent-note-actions">
        {undo?.available && !confirming && <button type="button" disabled={!target || busy} onClick={() => void revert()}>撤销</button>}
        <button type="button" disabled={!target || busy} onClick={() => void review()}>查看变更</button>
      </div></header>
    {confirming && <div className="agent-note-undo-confirm" role="group" aria-label="确认撤销笔记修改">
      <p>将把这 {changes.length} 篇笔记恢复到本次修改之前；新建的笔记会被删除。之后又被修改过的笔记不会被覆盖。</p>
      <div><button type="button" disabled={busy} onClick={() => setConfirming(false)}>取消</button>
        <button type="button" className="danger" disabled={busy} onClick={() => void revert()}>{busy ? '正在撤销…' : '确认撤销'}</button></div>
    </div>}
    {undo?.reverted && <p className="agent-note-undo-status" role="status">{undone !== null ? `已撤销，恢复了 ${undone} 篇笔记` : '这次修改已撤销'}</p>}
    {undo && !undo.available && !undo.reverted && undo.reason && <p className="agent-note-undo-status">{undo.reason}</p>}
    <div className="agent-note-files">{(expanded ? changes : changes.slice(0, 3)).map(change => <button key={change.id} type="button" disabled={!target || busy || change.operation === 'delete'} aria-label={`打开笔记 ${change.path}`} title={`${change.notebookName} / ${change.path}`} onClick={() => void open(change)}>
      <span>{change.previousPath && <small className="agent-note-old-path">{change.previousPath} → </small>}{change.path}{change.operation === 'delete' ? ' · 已删除' : ''}</span><small><i className="added">+{change.added}</i> <i className="removed">−{change.removed}</i></small></button>)}</div>
    {changes.length > 3 && <button className="agent-note-expand" type="button" onClick={() => setExpanded(!expanded)}>{expanded ? '收起列表' : `再显示 ${changes.length - 3} 篇笔记`} <Icon name="chevron" size={12} /></button>}
    {diff && <dialog ref={dialog} className="agent-diff-dialog" aria-label="笔记修改记录" onCancel={() => setDiff(null)}>
      <header><div><strong>已编辑笔记</strong><code>{diff.path}</code></div><button type="button" aria-label="关闭笔记修改记录" onClick={() => setDiff(null)}>×</button></header>
      {diff.truncated && <p role="status">修改内容较长，预览只展示有界片段；可打开笔记查看当前内容。</p>}
      <pre tabIndex={0} aria-label="笔记修改 diff">{diff.diff.split('\n').length > 5000 ? diff.diff : diff.diff.split('\n').map((line, index) => <span key={index} className={line.startsWith('+') ? 'diff-added' : line.startsWith('-') ? 'diff-removed' : undefined}>{line}{'\n'}</span>)}</pre>
    </dialog>}
  </section>;
}
