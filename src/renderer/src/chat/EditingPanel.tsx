import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Message, PublicSettings } from '../../../shared/contracts';
import { agentNotePathSchema } from '../../../shared/agent/note-writing';
import type { EditingContextRequest, EditingSnapshot, ProposalPreview, ProposalSummary } from '../../../shared/agent/editing';
import type { NotebookReference, NoteEntry } from '../../../shared/notes';
import { Button, IconButton, Select } from '../components/ui/Button';
import { Dialog } from '../components/ui/Dialog';
import { Icon } from '../components/Icon';
import './editing.css';

export interface EditingPresentation {
  context: ReactNode; contextSelected: boolean; error: ReactNode;
  proposals(ids: string[]): ReactNode; pendingProposals: ReactNode;
}

export function EditingPanel({ conversationId, messages, settings, busy, ensureConversation, onError, onBlockingChange, children }: {
  children(presentation: EditingPresentation): ReactNode;
  conversationId: string | null; messages: Message[]; settings: PublicSettings | null; busy: boolean;
  ensureConversation(): Promise<string>; onError(message: string): void; onBlockingChange(value: boolean): void;
}) {
  const [snapshot, setSnapshot] = useState<EditingSnapshot | null>(null); const [picker, setPicker] = useState(false);
  const [kind, setKind] = useState<'note' | 'branches'>('note'); const [books, setBooks] = useState<NotebookReference[]>([]);
  const [book, setBook] = useState(''); const [entries, setEntries] = useState<NoteEntry[]>([]); const [path, setPath] = useState('');
  const [branchIds, setBranchIds] = useState<string[]>([]); const [acting, setActing] = useState(false); const [error, setError] = useState('');
  const [preview, setPreview] = useState<ProposalPreview | null>(null); const [tab, setTab] = useState<'diff' | 'before' | 'after'>('diff');
  const id = useRef(conversationId); id.current = conversationId; const revisions = useRef(new Map<string, number>());
  function accept(target: string, value: EditingSnapshot) {
    if (target !== id.current || value.revision < (revisions.current.get(target) ?? -1)) return;
    revisions.current.set(target, value.revision); setSnapshot(value);
  }
  useEffect(() => {
    setSnapshot(null); setPicker(false); setPreview(null); setError('');
    if (!conversationId) return;
    let active = true;
    const stop = window.snipvia.editing.onChanged(value => { if (active) accept(value.conversationId, value.snapshot); });
    void window.snipvia.editing.state(conversationId).then(result => { if (active && result.ok) accept(conversationId, result.value); }).catch(() => { if (active) onError('无法读取编辑上下文'); });
    return () => { active = false; stop(); };
  }, [conversationId]);
  useEffect(() => {
    if (!picker) return; let active = true; setError('');
    void window.snipvia.notes.state().then(result => {
      if (!active) return; if (!result.ok) { setError(result.error); return; }
      setBooks(result.value.notebooks.map(({ id, name }) => ({ id, name }))); setBook(snapshot?.context?.request.kind === 'note' ? snapshot.context.request.notebookId : result.value.activeId ?? result.value.notebooks[0]?.id ?? '');
    }).catch(() => { if (active) setError('无法读取笔记本列表'); });
    setBranchIds(snapshot?.context?.request.kind === 'branches' ? [...snapshot.context.request.branchIds] : settings?.predictionBranches.map(branch => branch.id) ?? []);
    return () => { active = false; };
  }, [picker]);
  useEffect(() => {
    if (!picker || !book) { setEntries([]); return; } let active = true; setEntries([]);
    setPath(snapshot?.context?.request.kind === 'note' && snapshot.context.request.notebookId === book ? snapshot.context.request.path ?? '' : '');
    void window.snipvia.notes.entries(book).then(result => { if (active) { if (result.ok) setEntries(result.value.filter(entry => entry.kind === 'note' && agentNotePathSchema.safeParse(entry.path).success)); else setError(result.error); } }).catch(() => { if (active) setError('无法读取笔记列表'); });
    return () => { active = false; };
  }, [picker, book]);
  async function action(work: () => Promise<void>) {
    if (acting) return; setActing(true); onBlockingChange(true); setError('');
    try { await work(); } catch (cause) { setError(cause instanceof Error ? cause.message : '操作失败，请重试'); }
    finally { setActing(false); onBlockingChange(false); }
  }
  async function select(request: EditingContextRequest | null) {
    const target = conversationId ?? await ensureConversation();
    const result = await window.snipvia.editing.select(target, request); if (!result.ok) throw new Error(result.error);
    accept(target, result.value); setPicker(false); setPreview(null);
  }
  const stored = messages.flatMap(message => message.editProposals ?? []);
  const proposals = [...(snapshot?.proposals ?? []), ...stored.filter(proposal => !snapshot?.proposals.some(current => current.id === proposal.id)).map(proposal => proposal.status === 'applied' ? proposal : { ...proposal, status: 'expired' as const, message: '提案已失效，请重新生成' })];
  const unique = proposals.filter((proposal, index) => proposals.findIndex(item => item.id === proposal.id) === index);
  const currentPreview = preview && unique.find(proposal => proposal.id === preview.id);
  const diffLines = preview?.diff.split('\n') ?? [];
  async function review(proposal: ProposalSummary) {
    if (!conversationId) return;
    const result = await window.snipvia.editing.preview(conversationId, proposal.id); if (!result.ok) throw new Error(result.error);
    setPreview(result.value); setTab('diff');
  }
  async function apply() {
    if (!conversationId || !preview) return;
    const result = await window.snipvia.editing.apply(conversationId, preview.id, preview.digest); if (!result.ok) throw new Error(result.error);
    const state = await window.snipvia.editing.state(conversationId); if (state.ok) accept(conversationId, state.value);
    setPreview(null);
  }
  async function cancel(proposal: ProposalSummary) {
    if (!conversationId) return;
    const result = await window.snipvia.editing.cancel(conversationId, proposal.id); if (!result.ok) throw new Error(result.error);
    const state = await window.snipvia.editing.state(conversationId); if (state.ok) accept(conversationId, state.value);
    setPreview(null);
  }
  const context = <div className={`editing-context-bar${snapshot?.context ? ' selected' : ''}`}>
    <Button variant="quiet" aria-label={snapshot?.context?.label ?? '选择笔记或预测分支'} title={snapshot?.context?.label ?? '选择笔记或预测分支'} disabled={busy || acting} onClick={() => { setPicker(true); setKind(snapshot?.context?.kind ?? 'note'); }}><Icon name={snapshot?.context?.kind === 'branches' ? 'capture' : 'notebook'} size={15} /><span>{snapshot?.context ? `${snapshot.context.kind === 'note' ? '笔记' : '分支'} · ${snapshot.context.label}` : '添加上下文'}</span></Button>
    {snapshot?.context && <IconButton icon="close" label="清除编辑上下文" disabled={busy || acting} onClick={() => void action(() => select(null))} />}
  </div>;
  function renderProposals(ids: string[]) {
    const visible = unique.filter(proposal => ids.includes(proposal.id));
    return visible.length ? <div className="editing-proposals">{visible.map(proposal => <div className="editing-proposal" key={proposal.id} data-status={proposal.status}>
      <div><strong>{proposal.title}</strong><small>{proposal.status === 'generating' ? '正在生成修改建议，尚未保存' : proposal.status === 'pending' ? `待确认 · +${proposal.added} −${proposal.removed} · 尚未保存` : proposal.status === 'applying' ? '正在保存…' : proposal.message ?? (proposal.status === 'applied' ? '修改已保存' : '提案已失效，请重新生成')}</small></div>
      <div>{['generating', 'pending'].includes(proposal.status) && <><Button disabled={acting} onClick={() => void action(() => review(proposal))}>查看修改</Button><Button variant="quiet" disabled={acting} onClick={() => void action(() => cancel(proposal))}>取消建议</Button></>}{proposal.status === 'applied' && proposal.note && <Button disabled={acting} onClick={() => void action(async () => { if (!conversationId) return; const result = await window.snipvia.editing.openNote(conversationId, proposal.id); if (!result.ok) throw new Error(result.error); })}>查看笔记</Button>}</div>
    </div>)}</div> : null;
  }
  const recorded = new Set(stored.map(proposal => proposal.id));
  return <>{children({ context, contextSelected: !!snapshot?.context, proposals: renderProposals,
    pendingProposals: renderProposals(unique.filter(proposal => !recorded.has(proposal.id)).map(proposal => proposal.id)),
    error: error && !picker && !preview ? <p role="alert" className="editing-error">{error}<Button variant="quiet" onClick={() => setError('')}>关闭</Button></p> : null
  })}
    {picker && <Dialog label="选择编辑上下文" className="editing-picker" onClose={() => { if (!acting) setPicker(false); }}>
      <h2>选择编辑上下文</h2><p>仅将所选笔记内容或分支规则发送给你配置的模型。AI 的修改必须经你确认才会保存。</p>
      <div className="editing-tabs" role="group" aria-label="上下文类型"><Button aria-pressed={kind === 'note'} onClick={() => setKind('note')}>笔记</Button><Button aria-pressed={kind === 'branches'} onClick={() => setKind('branches')}>预测分支</Button></div>
      {kind === 'note' ? <><label>笔记本<Select disabled={acting} aria-label="编辑上下文笔记本" value={book} onChange={event => setBook(event.target.value)}>{!books.length && <option value="">尚无笔记本</option>}{books.map(book => <option key={book.id} value={book.id}>{book.name}</option>)}</Select></label><label>笔记<Select disabled={acting} aria-label="编辑上下文笔记" value={path} onChange={event => setPath(event.target.value)}><option value="">创建新笔记</option>{entries.map(entry => <option value={entry.path} key={entry.path}>{entry.path}</option>)}</Select></label></> : <div className="editing-branch-selection"><Button variant="quiet" onClick={() => setBranchIds(settings?.predictionBranches.map(branch => branch.id) ?? [])}>选择全部规则</Button>{settings?.predictionBranches.map(branch => <label key={branch.id}><input disabled={acting} type="checkbox" checked={branchIds.includes(branch.id)} onChange={event => setBranchIds(values => event.target.checked ? [...values, branch.id] : values.filter(id => id !== branch.id))} /><span>{branch.label}</span><small>{branch.builtin ? '内置' : '自定义'}</small></label>)}</div>}
      {error && <p role="alert">{error}</p>}<footer><Button disabled={acting} onClick={() => setPicker(false)}>取消</Button><Button variant="primary" disabled={acting || kind === 'note' && !book} onClick={() => void action(() => select(kind === 'note' ? { kind, notebookId: book, path: path || null } : { kind, branchIds: branchIds as Extract<EditingContextRequest, { kind: 'branches' }>['branchIds'] }))}>{acting ? '读取中…' : '使用此上下文'}</Button></footer>
    </Dialog>}
    {preview && <Dialog label="修改预览" className="editing-preview" onClose={() => { if (!acting) setPreview(null); }}>
      <div className="editing-preview-title"><h2>{preview.title}</h2><IconButton icon="close" label="关闭修改预览" disabled={acting} onClick={() => setPreview(null)} /></div>
      <p>{currentPreview?.status === 'pending' ? '请核对完整修改，确认后才会保存。' : currentPreview?.message ?? '正在生成提案，暂时不能保存。'}</p>
      <div className="editing-tabs" role="group" aria-label="修改预览方式">{(['diff', 'before', 'after'] as const).map(value => <Button key={value} aria-pressed={tab === value} onClick={() => setTab(value)}>{value === 'diff' ? '差异' : value === 'before' ? '修改前' : '修改后'}</Button>)}</div>
      <pre tabIndex={0} aria-label={tab === 'diff' ? '修改差异' : tab === 'before' ? '修改前内容' : '修改后内容'}>{tab === 'diff' ? diffLines.length > 5000 ? preview.diff : diffLines.map((line, index) => <span className={line.startsWith('+') ? 'editing-added' : line.startsWith('-') ? 'editing-removed' : ''} key={index}>{line}{'\n'}</span>) : preview[tab]}</pre>
      {error && <p role="alert">{error}</p>}<footer><Button disabled={acting} onClick={() => void action(() => cancel(preview))}>取消修改</Button><Button variant="primary" disabled={busy || acting || currentPreview?.status !== 'pending'} onClick={() => void action(apply)}>{acting ? '保存中…' : '确认并保存'}</Button></footer>
    </Dialog>}
  </>;
}
