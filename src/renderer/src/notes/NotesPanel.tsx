import type { EditingContextRequest } from '../../../shared/agent/editing';
import { useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import type { Notebook, NoteEntry, NoteBacklink, NoteAsset, NoteCreationRequest, NoteOpenRequest } from '../../../shared/notes';
import { noteHeadings, resolveNoteLink, type NoteHeading } from '../../../shared/note-markdown';
import { WorkspaceHeader } from '../components/WorkspaceHeader';
import { Icon } from '../components/Icon';
import { Button, Select } from '../components/ui/Button';
import { Dialog } from '../components/ui/Dialog';
import { NotesEditor, type NoteEditorHandle } from './NotesEditor';
import { NotesTree } from './NotesTree';
import { NotesOutline } from './NotesOutline';
import { NotePreview } from './NotePreview';
import { NoteIcon } from './NoteIcon';
import { useNoteDocument } from './useNoteDocument';
import './notes.css';

function NoteDialog({ title, children, close }: { title: string; children: ReactNode; close(): void }) {
  return <Dialog label={title} className="notes-dialog" onClose={close}><div className="notes-dialog-heading"><strong>{title}</strong><Button variant="quiet" className="note-icon-button" aria-label="关闭弹窗" onClick={close}><Icon name="close" /></Button></div>{children}</Dialog>;
}
type FormState = { kind: 'book' | 'note' | 'folder' | 'rename' | 'move' | 'trash' | 'missing'; title: string; value: string; parent?: string; path?: string; token?: string; directory?: string; captureId?: string };

export function NotesPanel({ active, flushRef, creationRequest, onCreationHandled, onReturnToChat, openRequest, onOpenHandled, onDiscuss }: { onDiscuss?(context: EditingContextRequest): Promise<void>; active: boolean; flushRef: MutableRefObject<(() => Promise<boolean>) | null>; creationRequest: NoteCreationRequest | null; onCreationHandled(): void; onReturnToChat(): void; openRequest?: NoteOpenRequest | null; onOpenHandled?(): void }) {
  const [books, setBooks] = useState<Notebook[]>([]); const [book, setBook] = useState<Notebook | null>(null); const bookRef = useRef<Notebook | null>(null);
  const [entries, setEntries] = useState<NoteEntry[]>([]); const [selected, setSelected] = useState(''); const [backlinks, setBacklinks] = useState<NoteBacklink[]>([]);
  const [mode, setMode] = useState<'live' | 'source' | 'read'>('live'); const [manager, setManager] = useState(false); const [form, setForm] = useState<FormState | null>(null);
  // Presentation only: never change notebook metadata or remount the editor when panes change.
  const [filesCollapsed, setFilesCollapsed] = useState(false); const [outlineCollapsed, setOutlineCollapsed] = useState(true);
  const [unlinking, setUnlinking] = useState<Notebook | null>(null);
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false); const [loaded, setLoaded] = useState(false);
  const [asset, setAsset] = useState<{ path: string; image: string | null } | null>(null); const document = useNoteDocument(setError);
  const documentRef = useRef(document); documentRef.current = document;
  const editor = useRef<NoteEditorHandle | null>(null); const body = useRef<HTMLDivElement>(null); const refreshGeneration = useRef(0); const navigating = useRef(false);
  const [history, setHistory] = useState<string[]>([]);
  const paths = useMemo(() => entries.filter((item) => item.kind !== 'folder').map((item) => item.path), [entries]);
  const headings = useMemo(() => noteHeadings(document.draft?.content ?? ''), [document.draft?.content]);
  const activePath = document.draft?.path ?? asset?.path;
  const handledCreation = useRef<string | null>(null);
  const handledOpen = useRef<string | null>(null);
  flushRef.current = document.flush;
  useEffect(() => {
    if (book && activePath?.endsWith('.md')) try { localStorage.setItem(`snipvia:notes:last:${book.id}`, activePath); } catch { /* Storage is optional. */ }
  }, [book?.id, activePath]);

  async function refresh(reload = true) {
    const current = bookRef.current; if (!current) return;
    const generation = ++refreshGeneration.current;
    const result = await window.snipvia.notes.entries(current.id);
    if (generation !== refreshGeneration.current || bookRef.current?.id !== current.id) return;
    if (!result.ok) { setError(result.error); return; }
    setEntries(result.value);
    const draft = documentRef.current.get();
    if (draft && draft.notebookId === current.id) {
      const links = await window.snipvia.notes.backlinks(current.id, draft.path);
      if (bookRef.current?.id === current.id && documentRef.current.get()?.path === draft.path) setBacklinks(links.ok ? links.value : []);
      if (reload && draft.content === draft.saved && !documentRef.current.saving) {
        const updated = await window.snipvia.notes.read(current.id, draft.path);
        if (documentRef.current.get() !== draft || draft.content !== draft.saved || documentRef.current.saving) return;
        if (updated.ok && updated.value.version !== draft.version) documentRef.current.load(current.id, updated.value);
        else if (!updated.ok) setError('当前文件已被移动或删除。编辑内容仍保留，可另存一篇笔记。');
      }
    }
  }
  async function adopt(next: Notebook) {
    bookRef.current = next; setBook(next); document.clear(); setAsset(null); setSelected(''); setBacklinks([]); setHistory([]); setEntries([]);
    const state = await window.snipvia.notes.state(); if (state.ok) setBooks(state.value.notebooks);
    setManager(false); await refresh(false);
    let last: string | null = null;
    try { last = localStorage.getItem(`snipvia:notes:last:${next.id}`); } catch { /* An empty notebook remains usable without localStorage. */ }
    if (last && bookRef.current?.id === next.id) {
      const opened = await window.snipvia.notes.read(next.id, last);
      if (opened.ok && bookRef.current?.id === next.id) { document.load(next.id, opened.value); setSelected(last); await refresh(false); }
    }
  }
  useEffect(() => {
    void window.snipvia.notes.state().then(async (state) => {
      if (!state.ok) { setError(state.error); setLoaded(true); return; }
      setBooks(state.value.notebooks);
      if (state.value.activeId) { const current = await window.snipvia.notes.select(state.value.activeId); if (current.ok) await adopt(current.value); else setError(current.error); }
      setLoaded(true);
    });
    const unsubscribe = window.snipvia.notes.onChanged((id) => { if (bookRef.current?.id === id) void refresh(); });
    const onFocus = () => { void refresh(); };
    window.addEventListener('focus', onFocus);
    return () => { unsubscribe(); window.removeEventListener('focus', onFocus); flushRef.current = null; };
  }, []);
  useEffect(() => { if (!active) void document.flush(); else if (loaded) void refresh(); }, [active]);
  useEffect(() => {
    if (!active || !loaded || !creationRequest || handledCreation.current === creationRequest.id) return;
    handledCreation.current = creationRequest.id; onCreationHandled(); void createBook(creationRequest.captureId);
  }, [active, loaded, creationRequest]);
  useEffect(() => {
    if (!active || !loaded || !openRequest || handledOpen.current === openRequest.id) return;
    handledOpen.current = openRequest.id;
    void (async () => {
      if (!await documentRef.current.flush()) throw new Error('请先处理当前笔记的保存冲突');
      const selected = await window.snipvia.notes.select(openRequest.notebookId);
      if (!selected.ok) throw new Error(selected.error);
      await adopt(selected.value); await openPath(openRequest.path); onOpenHandled?.();
    })().catch(error => { setError(error instanceof Error ? error.message : '无法打开已编辑笔记'); onOpenHandled?.(); });
  }, [active, loaded, openRequest]);
  useEffect(() => {
    if (!active) return;
    const handler = (event: KeyboardEvent) => {
      if (event.isComposing || event.target instanceof HTMLElement && event.target.closest('dialog')) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'n') { event.preventDefault(); createEntry('note'); }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void documentRef.current.flush(); }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'e' && mode === 'read') { event.preventDefault(); setMode('live'); }
    };
    window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler);
  }, [active, book, selected, entries, mode]);
  async function action(work: () => Promise<void>) {
    if (navigating.current) return; navigating.current = true; setBusy(true); setError(''); setNotice('');
    try { await work(); } catch (error) { setError(error instanceof Error ? error.message : '操作失败'); }
    finally { navigating.current = false; setBusy(false); }
  }
  async function openPath(path: string, addHistory = true, anchor = '') {
    const current = bookRef.current; if (!current) return;
    await action(async () => {
      if (!await document.flush()) return;
      if (/\.md$/i.test(path)) {
        const result = await window.snipvia.notes.read(current.id, path); if (!result.ok) throw new Error(result.error);
        if (addHistory && activePath && activePath !== path) setHistory((previous) => [...previous.slice(-49), activePath]);
        document.load(current.id, result.value); setAsset(null); setSelected(path); setBacklinks([]);
        const links = await window.snipvia.notes.backlinks(current.id, path); if (links.ok) setBacklinks(links.value);
        if (anchor) requestAnimationFrame(() => jumpAnchor(anchor, result.value.content));
      } else {
        const result = await window.snipvia.notes.image(current.id, path); if (!result.ok) throw new Error(result.error);
        if (addHistory && activePath && activePath !== path) setHistory((previous) => [...previous.slice(-49), activePath]);
        document.clear(); setBacklinks([]); setAsset({ path, image: result.value }); setSelected(path);
      }
    });
  }
  function jump(heading: NoteHeading) {
    if (mode === 'read') body.current?.querySelector(`#${heading.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    else editor.current?.jump(heading.from);
  }
  function jumpAnchor(anchor: string, content = document.draft?.content ?? '') {
    const label = anchor.split('#').at(-1) ?? anchor;
    if (label.startsWith('^')) {
      const line = content.split('\n').find((line) => line.trimEnd().endsWith(label));
      if (line && mode !== 'read') editor.current?.jump(content.indexOf(line));
      else if (line) { const target = [...(body.current?.querySelectorAll('.note-paragraph, li, blockquote') ?? [])].find((node) => node.textContent?.includes(label)); target?.scrollIntoView({ block: 'start' }); }
      return;
    }
    const heading = noteHeadings(content).find((item) => item.text === label || item.text.toLowerCase().replace(/\s+/g, '-') === label.toLowerCase());
    if (heading) jump(heading); else setNotice('这篇笔记中没有找到对应标题');
  }
  function onLink(target: string, wiki: boolean) {
    if (/^https?:\/\//i.test(target)) { void window.snipvia.browser.openExternal(target).then((result) => { if (!result.ok) setError(result.error); }); return; }
    if (!document.draft) return;
    const resolved = resolveNoteLink(target, document.draft.path, paths, wiki);
    if (resolved.path === document.draft.path) { if (resolved.anchor) jumpAnchor(resolved.anchor); return; }
    if (resolved.path) { void openPath(resolved.path, true, resolved.anchor); return; }
    if (resolved.ambiguous) { setError(`存在同名笔记，请使用完整路径：${resolved.ambiguous.join('、')}`); return; }
    if (resolved.missing) setForm({ kind: 'missing', title: '创建链接的笔记', value: resolved.missing.split('/').at(-1)!.replace(/\.md$/i, ''), parent: resolved.missing.split('/').slice(0, -1).join('/') });
    else setError('找不到链接的文件，或链接不在笔记本中');
  }
  async function createBook(captureId?: string) {
    await action(async () => {
      if (!await document.flush()) return;
      const result = await window.snipvia.notes.chooseLocation(); if (!result.ok) throw new Error(result.error);
      if (result.value) { setManager(false); setForm({ kind: 'book', title: '创建笔记本', value: '我的笔记', captureId, ...result.value }); }
    });
  }
  async function unlinkBook() {
    if (!unlinking) return;
    const current = unlinking;
    await action(async () => {
      if (bookRef.current?.id === current.id && !await document.flush()) { setUnlinking(null); return; }
      const result = await window.snipvia.notes.unlink(current.id);
      if (!result.ok) throw new Error(result.error);
      setBooks(result.value.notebooks);
      if (bookRef.current?.id === current.id) {
        ++refreshGeneration.current;
        bookRef.current = null; setBook(null); document.clear(); setAsset(null);
        setSelected(''); setBacklinks([]); setHistory([]); setEntries([]);
      }
      setUnlinking(null);
      setNotice(`已移除「${current.name}」的链接，文件仍保存在原目录。可通过「打开已有笔记本」重新添加。`);
    });
  }
  const parent = () => { const entry = entries.find((item) => item.path === selected); const path = entry?.kind === 'folder' ? selected : selected.split('/').slice(0, -1).join('/'); return path === 'assets' || path.startsWith('assets/') ? '' : path; };
  function createEntry(kind: 'note' | 'folder') {
    if (!book || busy) return; const directory = parent(); const base = kind === 'note' ? '未命名' : '新文件夹'; let name = base; let count = 1;
    while (entries.some((item) => item.path === [directory, name + (kind === 'note' ? '.md' : '')].filter(Boolean).join('/'))) name = `${base} ${++count}`;
    setForm({ kind, title: kind === 'note' ? '新建笔记' : '新建文件夹', value: name, parent: directory });
  }
  async function movePath(path: string, destination: string) {
    if (!book || path === destination || !await document.flush()) return false;
    const result = await window.snipvia.notes.move(book.id, path, destination); if (!result.ok) throw new Error(result.error);
    const nextPath = activePath && (activePath === path || activePath.startsWith(`${path}/`)) ? destination + activePath.slice(path.length) : activePath;
    if (document.draft && nextPath) { const updated = await window.snipvia.notes.read(book.id, nextPath); if (updated.ok) document.load(book.id, updated.value); }
    else if (asset && nextPath) setAsset({ ...asset, path: nextPath });
    setSelected(destination); setHistory([]); await refresh(); return true;
  }
  async function submitForm() {
    if (!form) return; const current = form;
    await action(async () => {
      if (!await document.flush()) { setForm(null); return; }
      if (current.kind === 'book') {
        const result = await window.snipvia.notes.create(current.token!, current.value); if (!result.ok) throw new Error(result.error);
        setForm(null); await adopt(result.value);
        if (current.captureId) {
          const selected = await window.snipvia.agent.selectNotebook(current.captureId, result.value.id);
          if (selected.ok) onReturnToChat(); else setNotice(`笔记本已创建；对话未关联：${selected.error}`);
        }
        return;
      }
      if (!book) return;
      if (current.kind === 'trash') {
        const result = await window.snipvia.notes.trash(book.id, current.path!); if (!result.ok) throw new Error(result.error);
        if (activePath === current.path || activePath?.startsWith(`${current.path}/`)) { document.clear(); setAsset(null); setBacklinks([]); }
        setSelected(''); setHistory([]);
      } else if (current.kind === 'rename' || current.kind === 'move') {
        const destination = current.kind === 'rename' ? [current.path!.split('/').slice(0, -1).join('/'), current.value].filter(Boolean).join('/')
          : [current.value, current.path!.split('/').at(-1)].filter(Boolean).join('/');
        await movePath(current.path!, destination);
      } else {
        // Missing-link folders are created only after explicit user confirmation.
        if (current.kind === 'missing' && current.parent) {
          let folder = '';
          for (const part of current.parent.split('/')) {
            const path = [folder, part].filter(Boolean).join('/');
            if (!entries.some((entry) => entry.path === path && entry.kind === 'folder')) { const created = await window.snipvia.notes.createEntry(book.id, folder, part, 'folder'); if (!created.ok) throw new Error(created.error); }
            folder = path;
          }
        }
        const result = await window.snipvia.notes.createEntry(book.id, current.parent ?? '', current.value, current.kind === 'folder' ? 'folder' : 'note'); if (!result.ok) throw new Error(result.error);
        setSelected(result.value);
        if (current.kind !== 'folder') { const opened = await window.snipvia.notes.read(book.id, result.value); if (!opened.ok) throw new Error(opened.error); document.load(book.id, opened.value); setMode('live'); setAsset(null); setBacklinks([]); }
      }
      setForm(null); await refresh(false);
    });
  }
  const attachmentText = (files: NoteAsset[]) => files.length ? '\n' + files.map((file) => `${file.image ? '!' : ''}[[${file.path}]]`).join('\n') + '\n' : '';
  async function pastedFiles(files: File[]) {
    if (!book || !document.draft) return ''; const id = book.id;
    try {
      if (files.length > 20) throw new Error('每次最多添加 20 个附件');
      if (files.some((file) => file.size > 25 * 1024 * 1024)) throw new Error('每个附件最多 25 MB');
      const added: NoteAsset[] = [];
      for (const file of files) { const result = await window.snipvia.notes.addAsset(id, file.name || 'image.png', new Uint8Array(await file.arrayBuffer())); if (!result.ok) throw new Error(result.error); added.push(result.value); }
      await refresh(false); return attachmentText(added);
    } catch (error) { setError(error instanceof Error ? error.message : '附件添加失败'); return ''; }
  }
  async function saveCopy() {
    if (!book || !document.draft) return;
    const draft = document.draft; const name = `${draft.path.split('/').at(-1)!.replace(/\.md$/i, '')} - 冲突副本 ${Date.now()}`;
    const result = await window.snipvia.notes.createEntry(book.id, draft.path.split('/').slice(0, -1).join('/'), name, 'note');
    if (!result.ok) { setError(result.error); return; }
    const opened = await window.snipvia.notes.read(book.id, result.value); if (!opened.ok) { setError(opened.error); return; }
    const content = draft.content; document.load(book.id, opened.value); setMode('live'); document.edit(content); if (await document.flush()) await refresh(false);
  }
  return <section className="notes-panel workspace-panel" hidden={!active} aria-label="AI 笔记">
    <WorkspaceHeader title={<button className="notes-book-title" aria-label="切换笔记本" onClick={() => setManager(true)}><span>{book?.name ?? 'AI 笔记'}</span><NoteIcon name="switch" size={20} /></button>}>
      {book && <div className="notes-pane-toggles" role="group" aria-label="笔记侧栏显示">
        <button className={`note-icon-button${!filesCollapsed ? ' enabled' : ''}`} aria-label={filesCollapsed ? '展开文件列表' : '收起文件列表'} title={filesCollapsed ? '展开文件列表' : '收起文件列表'} aria-controls="notes-files" aria-expanded={!filesCollapsed} onClick={() => setFilesCollapsed(!filesCollapsed)}><NoteIcon name="files-panel" /></button>
        <button className={`note-icon-button${!outlineCollapsed ? ' enabled' : ''}`} aria-label={outlineCollapsed ? '展开标题目录' : '收起标题目录'} title={outlineCollapsed ? '展开标题目录' : '收起标题目录'} aria-controls="notes-outline" aria-expanded={!outlineCollapsed} onClick={() => setOutlineCollapsed(!outlineCollapsed)}><NoteIcon name="outline-panel" /></button>
      </div>}
      {book && onDiscuss && <Button className="workspace-action" disabled={busy} onClick={() => void action(async () => {
        if (!await document.flush()) return;
        const draft = documentRef.current.get();
        if (bookRef.current?.id !== book.id || draft && draft.notebookId !== book.id) throw new Error('笔记已经切换，请重新进入对话');
        await onDiscuss({ kind: 'note', notebookId: book.id, path: draft?.path ?? null, ...(draft ? { version: draft.version } : {}) });
      })}>与 AI 讨论</Button>}
      {book && <Button className="workspace-action" disabled={busy} onClick={() => void action(async () => { if (!await document.flush()) return; const result = await window.snipvia.notes.export(book.id); if (!result.ok) throw new Error(result.error); if (result.value) setNotice(`已导出到 ${result.value}`); })}><NoteIcon name="export" size={15} />打包导出</Button>}
    </WorkspaceHeader>
    {error && <div className="notes-notice error" role="alert"><span>{error}</span><button aria-label="关闭笔记错误" onClick={() => setError('')}>×</button></div>}
    {notice && <div className="notes-notice" role="status">{notice}<button aria-label="关闭笔记提示" onClick={() => setNotice('')}>×</button></div>}
    {!book ? <div className="notes-welcome"><Icon name="notebook" size={44} /><h2>{loaded ? '让想法有个落脚的地方' : '正在打开笔记…'}</h2><p>选择一个本地文件夹，创建或打开笔记本。</p><button className="primary" disabled={!loaded || busy} onClick={() => void createBook()}>创建笔记</button><button className="notes-text-button" disabled={busy} onClick={() => void action(async () => { const result = await window.snipvia.notes.open(); if (!result.ok) throw new Error(result.error); if (result.value) await adopt(result.value); })}>打开已有笔记本</button></div> : <div className={`notes-workspace${filesCollapsed ? ' files-collapsed' : ''}${outlineCollapsed ? ' outline-collapsed' : ''}`}>
      <NotesTree key={book.id} entries={entries} current={activePath} selected={selected} onSelect={setSelected} onOpen={(path) => void openPath(path)} onCreate={createEntry} disabled={busy} paneCollapsed={filesCollapsed} onCollapse={() => setFilesCollapsed(true)}
        onRefresh={() => void refresh()} onMove={async (path, parent) => { let moved = false; await action(async () => { moved = await movePath(path, [parent, path.split('/').at(-1)].filter(Boolean).join('/')); }); return moved; }}
        onAction={(kind, path) => { if (kind === 'reveal') { void window.snipvia.notes.reveal(book.id, path).then((result) => { if (!result.ok) setError(result.error); }); return; }
          setForm({ kind, path, title: kind === 'trash' ? '移到废纸篓' : kind === 'rename' ? '重命名' : '移动到文件夹', value: kind === 'rename' ? path.split('/').at(-1)! : '' }); }} />
      <div className="notes-center"><div className="notes-document-bar"><button className="note-icon-button" aria-label="返回上一篇笔记" disabled={!history.length || busy} onClick={() => { const path = history.at(-1)!; setHistory(history.slice(0, -1)); void openPath(path, false); }}><NoteIcon name="back" size={14} /></button><span title={activePath}>{activePath?.replace(/\.md$/i, '') ?? '笔记本'}</span>
        {document.draft && mode !== 'read' && <div className="notes-formatting" role="toolbar" aria-label="笔记格式工具栏"><button title="粗体 ⌘B" aria-label="粗体" onClick={() => editor.current?.format('**')}><b>B</b></button><button title="斜体 ⌘I" aria-label="斜体" onClick={() => editor.current?.format('*')}><i>I</i></button><button aria-label="插入标题" onClick={() => editor.current?.insert('\n## ')}>H₂</button><button aria-label="插入待办" onClick={() => editor.current?.insert('\n- [ ] ')}>☑</button><button aria-label="插入笔记链接" onClick={() => editor.current?.format('[[', ']]')}><NoteIcon name="link" size={15} /></button><button aria-label="插入代码块" onClick={() => editor.current?.format('\n```\n', '\n```\n')}><NoteIcon name="source" size={15} /></button><button aria-label="添加附件" disabled={busy} onClick={() => void action(async () => { const result = await window.snipvia.notes.importAssets(book.id); if (!result.ok) throw new Error(result.error); editor.current?.insert(attachmentText(result.value)); await refresh(false); })}><NoteIcon name="attach" size={16} /></button></div>}
        {document.draft && <label className="notes-mode"><Select aria-label="笔记编辑模式" value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}><option value="live">实时预览</option><option value="source">源码</option><option value="read">阅读</option></Select></label>}
      </div>
      {document.draft?.conflict && <div className="notes-conflict" role="alert"><strong>文件已被其他程序修改</strong><p>你的编辑已保留，请选择要保留的版本。</p><button onClick={() => document.acceptDisk()}>载入磁盘版本</button><button onClick={() => void action(saveCopy)}>我的编辑另存副本</button></div>}

      <div className={`notes-document-body${mode === 'read' ? ' reading' : ''}`} ref={body}>
        {document.draft ? mode === 'read' ? <NotePreview content={document.draft.content} notebookId={book.id} path={document.draft.path} paths={paths} onLink={onLink} />
          : <NotesEditor key={`${book.id}:${document.draft.path}`} notebookId={book.id} path={document.draft.path} value={document.draft.content} mode={mode} paths={paths} onChange={document.edit} onLink={onLink} onFiles={pastedFiles} onSave={() => void document.flush()} toggleReading={() => setMode('read')} editorRef={editor} />
          : asset ? <div className="notes-asset-preview">{asset.image ? <img src={asset.image} alt={asset.path} /> : <><NoteIcon name="attach" size={36} /><p>{asset.path}</p><button className="secondary" onClick={() => void window.snipvia.notes.reveal(book.id, asset.path)}>在文件管理器中查看</button></>}</div>
            : <div className="notes-blank"><NoteIcon name="new" size={33} /><h2>空白，也是一个开始。</h2><p>新建笔记，写下第一个想法。</p><button className="secondary" disabled={busy} onClick={() => createEntry('note')}>新建第一篇笔记</button></div>}
      </div>
      <div className="notes-status" role="status" aria-live="polite"><span>{document.draft ? document.draft.conflict ? '版本冲突 · 编辑已保留' : document.saving ? '保存中…' : document.draft.content !== document.draft.saved ? '未保存' : '已保存到本地' : '本地 Markdown 笔记本'}</span><span>{document.draft ? `${document.draft.content.replace(/\s/g, '').length} 字` : ''}</span></div>
      </div>
      <NotesOutline headings={headings} onJump={jump} backlinks={backlinks} onOpen={(path) => void openPath(path)} paneCollapsed={outlineCollapsed} onCollapse={() => setOutlineCollapsed(true)} />
    </div>}
    {manager && <NoteDialog title="选择笔记本" close={() => { if (!busy) setManager(false); }}><div className="notes-book-list">{books.map((item) => <div className="notes-book-row" key={item.id}>
      <button className="notes-book-select" disabled={busy} onClick={() => void action(async () => { if (!await document.flush()) { setManager(false); return; } const result = await window.snipvia.notes.select(item.id); if (!result.ok) throw new Error(result.error); await adopt(result.value); })}><Icon name="notebook" /><span><strong>{item.name}</strong><small>{item.directory}</small></span>{book?.id === item.id && <span aria-label="当前笔记本">✓</span>}</button>
      <button className="note-icon-button notes-book-unlink" disabled={busy} aria-label={`移除「${item.name}」的链接`} title="移除链接，保留本地文件" onClick={() => { setError(''); setManager(false); setUnlinking(item); }}><NoteIcon name="unlink" size={16} /></button>
    </div>)}{!books.length && <p className="notes-muted">还没有笔记本</p>}</div>{error && <p className="notes-dialog-error" role="alert">{error}</p>}<div className="notes-dialog-actions"><button className="secondary" disabled={busy} onClick={() => void action(async () => { if (!await document.flush()) { setManager(false); return; } const result = await window.snipvia.notes.open(); if (!result.ok) throw new Error(result.error); if (result.value) await adopt(result.value); })}>打开已有笔记本</button><button className="primary" disabled={busy} onClick={() => void createBook()}>创建笔记本</button></div></NoteDialog>}
    {unlinking && <NoteDialog title="移除笔记本链接" close={() => { if (!busy) setUnlinking(null); }}>
      <div className="notes-dialog-content"><p>将「{unlinking.name}」从笔记本列表中移除？</p><p>本地文件和附件会保留。以后可通过「打开已有笔记本」重新添加。</p><p className="notes-muted">{unlinking.directory}</p>{error && <p className="notes-dialog-error" role="alert">{error}</p>}</div>
      <div className="notes-dialog-actions"><button className="secondary" disabled={busy} data-initial-focus onClick={() => setUnlinking(null)}>取消</button><button className="notes-danger" disabled={busy} onClick={() => void unlinkBook()}>{busy ? '处理中…' : '移除链接'}</button></div>
    </NoteDialog>}
    {form && <NoteDialog title={form.title} close={() => { if (!busy) setForm(null); }}><form onSubmit={(event) => { event.preventDefault(); void submitForm(); }}>
      <div className="notes-dialog-content">{form.kind === 'trash' ? <p>将「{form.path}」移到系统废纸篓？文件夹内的内容也会一同移走。</p> : <label>{form.kind === 'book' ? '笔记本名称' : form.kind === 'move' ? '目标文件夹' : '名称'}{form.kind === 'move' ? <select aria-label="目标文件夹" value={form.value} onChange={(event) => setForm({ ...form, value: event.target.value })}><option value="">笔记本根目录</option>{entries.filter((entry) => entry.kind === 'folder' && entry.path !== 'assets' && !entry.path.startsWith('assets/') && entry.path !== form.path && !entry.path.startsWith(`${form.path}/`)).map((entry) => <option key={entry.path} value={entry.path}>{entry.path}</option>)}</select> : <input aria-label={form.kind === 'book' ? '笔记本名称' : '名称'} data-initial-focus required maxLength={100} value={form.value} onFocus={(event) => event.target.select()} onChange={(event) => setForm({ ...form, value: event.target.value })} />}</label>}
      {form.directory && <p className="notes-muted">位置：{form.directory}<br />将创建同名文件夹，附件保存在 assets 中。</p>}{form.parent && <p className="notes-muted">文件夹：{form.parent}</p>}{error && <p className="notes-dialog-error" role="alert">{error}</p>}</div>
      <div className="notes-dialog-actions"><button type="button" className="secondary" disabled={busy} data-initial-focus={form.kind === 'trash' || undefined} onClick={() => setForm(null)}>取消</button><button className={form.kind === 'trash' ? 'notes-danger' : 'primary'} disabled={busy}>{busy ? '处理中…' : form.kind === 'trash' ? '移到废纸篓' : form.kind === 'book' || form.kind === 'note' || form.kind === 'folder' || form.kind === 'missing' ? '创建' : '确定'}</button></div>
    </form></NoteDialog>}
  </section>;
}
