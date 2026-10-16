import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { NotebookReference } from '../../../shared/notes';
import type { AgentExecutionController } from './useAgentExecution';
import { Icon } from '../components/Icon';

function NotebookDialog({ title, close, children }: { title: string; close(): void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  return <dialog ref={dialog} className="agent-diff-dialog agent-notebook-dialog" aria-label={title} onCancel={close}>
    <header><strong>{title}</strong><button type="button" aria-label="关闭笔记弹窗" onClick={close}>×</button></header>{children}
  </dialog>;
}

export function AgentNotebookButton({ controller, disabled }: { controller: AgentExecutionController; disabled: boolean }) {
  const [books, setBooks] = useState<NotebookReference[] | null>(null); const [loading, setLoading] = useState(false); const [error, setError] = useState('');
  const notebook = controller.snapshot?.notebook;
  useEffect(() => { setBooks(null); setError(''); }, [controller.captureId]);
  async function create() {
    if (!controller.captureId) return;
    const result = await window.snipvia.notes.requestCreation(controller.captureId);
    if (!result.ok) throw new Error(result.error); setBooks(null);
  }
  async function open() {
    if (!controller.captureId || loading) return;
    setLoading(true); setError('');
    try {
      const result = await window.snipvia.agent.notebooks(controller.captureId);
      if (!result.ok) throw new Error(result.error);
      if (!result.value.length) await create(); else setBooks(result.value);
    } catch (error) { setError(error instanceof Error ? error.message : '无法读取笔记本'); }
    finally { setLoading(false); }
  }
  async function choose(id: string | null) { if (await controller.selectNotebook(id)) setBooks(null); }
  return <><button type="button" className="agent-workspace" aria-label="选择笔记" aria-haspopup="dialog" title={notebook ? `当前笔记本：${notebook.name}` : '选择笔记本，供 Agent 检索并提出 Markdown 修改建议'}
    disabled={disabled || controller.busy || controller.selecting || loading} onClick={() => void open()}><Icon name="notebook" size={13} /><span className="agent-workspace-name">{loading || controller.selecting ? '正在选择…' : notebook?.name ?? '选择笔记'}</span><span aria-hidden="true">⌄</span></button>
    {(error || controller.snapshot?.notebookNotice) && <span className="agent-notebook-notice" role="status">{error || controller.snapshot?.notebookNotice}</span>}
    {books && <NotebookDialog title="选择笔记" close={() => setBooks(null)}><div className="agent-notebook-list">
      <p>选择一个笔记本；AI 可检索内容，并提出 Markdown 修改建议。每次写入都须先查看差异并确认；取消或拒绝后不会保存。</p>
      <button disabled={controller.selecting || controller.busy} onClick={() => void choose(null)}><span>不选择笔记</span>{!notebook && <span>✓</span>}</button>
      {books.map((book) => <button key={book.id} disabled={controller.selecting || controller.busy} onClick={() => void choose(book.id)}><span>{book.name}</span>{notebook?.id === book.id && <span>✓</span>}</button>)}
    </div><footer><button type="button" disabled={controller.selecting || controller.busy} onClick={() => { void create().catch((error) => setError(error instanceof Error ? error.message : '无法创建笔记')); }}>＋ 创建笔记本</button></footer></NotebookDialog>}
  </>;
}
