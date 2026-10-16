import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Temporal } from '@js-temporal/polyfill';
import type { WorkspaceConversation, ConversationSummary, Result } from '../../../shared/contracts';
import { providerFor } from '../../../shared/providers';
import { Icon } from '../components/Icon';
import { WorkspaceHeader } from '../components/WorkspaceHeader';
import { Button, IconButton, Input, Select } from '../components/ui/Button';
import { Dialog } from '../components/ui/Dialog';
import { EmptyState } from '../components/ui/EmptyState';
import { LoadingState } from '../components/ui/LoadingState';
import { SourceAnswer } from '../agent/SourceReferences';
import { ImageAttachments } from '../chat/ImageAttachments';
import { filterConversations, groupConversations, historyTime } from './display';
import './history.css';

type Preview = { id: string; updatedAt: string; value?: WorkspaceConversation; error?: string };

export function HistoryPanel({ items, loading = false, onOpen, onDelete, onClear }: {
  items: ConversationSummary[]; loading?: boolean;
  onOpen(id: string): Promise<Result<void>>;
  onDelete(id: string): Promise<Result<void>>;
  onClear(): Promise<Result<void>>;
}) {
  const [query, setQuery] = useState(''); const [provider, setProvider] = useState<ConversationSummary['profile']['provider'] | 'all'>('all');
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [retry, setRetry] = useState(0); const [actionError, setActionError] = useState('');
  const [confirming, setConfirming] = useState<{ id?: string; title: string } | null>(null);
  const [acting, setActing] = useState(false); const [showDetail, setShowDetail] = useState(false);
  const scroll = useRef<HTMLDivElement>(null); const scrollPositions = useRef(new Map<string, number>());
  const rows = useRef(new Map<string, HTMLButtonElement>());
  const providers = useMemo(() => {
    const ids = new Set(items.map(item => item.profile.provider));
    if (provider !== 'all') ids.add(provider);
    return [...ids];
  }, [items, provider]);
  const matches = useMemo(() => filterConversations(items, query, provider), [items, query, provider]);
  const groups = groupConversations(matches, Temporal.Now.plainDateISO().toString());
  const current = matches.find(item => item.id === selected) ?? matches[0];
  const ready = preview?.id === current?.id && preview?.updatedAt === current?.updatedAt ? preview : null;

  useEffect(() => {
    if (!current) { setPreview(null); return; }
    let active = true;
    const { id, updatedAt } = current;
    setPreview({ id, updatedAt }); setActionError('');
    void window.snipvia.history.read(id).then(result => {
      if (active) setPreview({ id, updatedAt, ...(result.ok ? { value: result.value } : { error: result.error }) });
    }).catch(() => { if (active) setPreview({ id, updatedAt, error: '无法读取这条对话，请重试。' }); });
    return () => { active = false; };
  }, [current?.id, current?.updatedAt, retry]);
  useLayoutEffect(() => {
    if (current && ready?.value && scroll.current) scroll.current.scrollTop = scrollPositions.current.get(current.id) ?? 0;
  }, [current?.id, ready?.value]);

  function choose(id: string) { setSelected(id); setShowDetail(true); setActionError(''); }
  function move(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = event.key === 'ArrowDown' ? Math.min(matches.length - 1, index + 1) : event.key === 'ArrowUp' ? Math.max(0, index - 1)
      : event.key === 'Home' ? 0 : event.key === 'End' ? matches.length - 1 : null;
    if (next === null) return;
    event.preventDefault(); const id = matches[next].id; choose(id); rows.current.get(id)?.focus();
    rows.current.get(id)?.scrollIntoView({ block: 'nearest' });
  }
  async function resume() {
    if (!current || acting) return;
    setActing(true); setActionError('');
    try { const result = await onOpen(current.id); if (!result.ok) setActionError(result.error); }
    catch { setActionError('无法继续这条对话，请重试。'); }
    finally { setActing(false); }
  }
  async function remove() {
    if (!confirming || acting) return;
    setActing(true); setActionError('');
    try {
      const result = confirming.id ? await onDelete(confirming.id) : await onClear();
      if (result.ok) { setConfirming(null); if (!confirming.id) scrollPositions.current.clear(); else scrollPositions.current.delete(confirming.id); }
      else setActionError(result.error);
    } catch { setActionError('删除未完成，请重试。'); }
    finally { setActing(false); }
  }
  function resetFilters() { setQuery(''); setProvider('all'); }
  const conversation = ready?.value;
  return <section className={`history-panel workspace-panel${showDetail ? ' showing-detail' : ''}`} aria-busy={loading}>
    <WorkspaceHeader title="历史对话"><span className="history-local-label">仅保存在本机</span>{items.length > 0 && <Button className="workspace-action" disabled={acting} onClick={() => { setActionError(''); setConfirming({ title: '清空全部历史对话' }); }}>清空全部</Button>}</WorkspaceHeader>
    <div className="history-toolbar" role="search" aria-label="历史搜索与筛选">
      <div className="history-search"><Icon name="search" size={16} /><Input aria-label="搜索历史对话" placeholder="搜索标题、模型或厂商…" value={query} onChange={event => setQuery(event.target.value)} />{query && <IconButton icon="close" label="清除历史搜索" onClick={() => setQuery('')} />}</div>
      <Select aria-label="筛选历史厂商" value={provider} onChange={event => setProvider(event.target.value as typeof provider)}><option value="all">全部厂商</option>{providers.map(id => <option key={id} value={id}>{providerFor(id).name}</option>)}</Select>
      <span className="history-result-count" aria-live="polite">{matches.length} 条</span>
    </div>
    {loading && !items.length ? <LoadingState>正在读取历史对话…</LoadingState> : !items.length ? <EmptyState icon="history" title="还没有历史对话" description="新建 AI 对话、截取或导入图片后，会在这里保存记录。" /> : !matches.length ? <EmptyState icon="search" title="没有匹配的对话" description="试试其他标题、模型或厂商名称。"><Button onClick={resetFilters}>清除筛选</Button></EmptyState> : <div className="history-content">
      <div className="history-list" aria-label="对话列表">{groups.map(group => <section className="history-group" key={group.date} aria-label={group.label}>
        <h2>{group.label}</h2>{group.items.map(item => <article className={`history-item${current?.id === item.id ? ' selected' : ''}`} key={item.id}>
          <button className="history-open" ref={node => { if (node) rows.current.set(item.id, node); else rows.current.delete(item.id); }} aria-current={current?.id === item.id ? 'true' : undefined}
            tabIndex={current?.id === item.id ? 0 : -1} onKeyDown={event => move(event, matches.indexOf(item))} onClick={() => choose(item.id)} title={item.title}>
            <span className="history-copy"><strong>{item.title}</strong><small>{providerFor(item.profile.provider).name} · {item.profile.model}</small></span><time dateTime={item.updatedAt}>{historyTime(item.updatedAt)}</time>
          </button>
          <IconButton icon="close" label={`删除历史对话：${item.title}`} className="history-delete" disabled={acting} onClick={() => { setActionError(''); setConfirming({ id: item.id, title: item.title }); }} />
        </article>)}
      </section>)}</div>
      <section className="history-preview" aria-label="对话详情" aria-busy={!ready?.value && !ready?.error}>
        <header className="history-preview-heading"><IconButton icon="chevron" label="返回对话列表" className="history-back" onClick={() => setShowDetail(false)} /><div><h2>{current.title}</h2><p>{providerFor(current.profile.provider).name} · {current.profile.model} · {Math.ceil(current.messageCount / 2)} 轮</p></div></header>
        <div className="history-preview-scroll" ref={scroll} onScroll={event => { if (current && ready?.value) scrollPositions.current.set(current.id, event.currentTarget.scrollTop); }}>
          {ready?.error ? <div className="history-read-error"><p role="alert">{ready.error}</p><Button onClick={() => setRetry(value => value + 1)}>重新读取</Button></div> : !conversation ? <LoadingState>正在读取对话…</LoadingState> : <div className="history-preview-body">
            {conversation.capture && <details className="history-capture"><summary><Icon name="image" size={16} /><span>查看来源截图</span><small>{conversation.capture.width} × {conversation.capture.height}</small></summary><img src={conversation.capture.dataUrl} alt="历史对话来源截图" /></details>}
            {!conversation.messages.length ? <EmptyState icon="image" title="还没有消息" description="继续对话，开始提问。" /> : conversation.messages.map((message, index) => <article className={`history-message ${message.role}`} key={index}>
              <div className="history-message-heading"><strong>{message.role === 'user' ? '你' : '截然'}</strong>{message.model && <span>{message.model}</span>}{message.createdAt && <time dateTime={message.createdAt}>{historyTime(message.createdAt)}</time>}</div>
              {message.role === 'user' ? <>{!!message.images?.length && <ImageAttachments images={message.images} conversationId={conversation.id} />}<p>{message.content}</p></> : <SourceAnswer content={message.content} sources={message.sources} onError={setActionError} />}
              {!!message.noteChanges?.length && <div className="history-note-summary"><strong>编辑了 {message.noteChanges.length} 个文件</strong>{message.noteChanges.map(change => <span key={change.id}>{change.path}</span>)}</div>}
            </article>)}
          </div>}
        </div>
        {!confirming && actionError && <p className="history-action-error" role="alert">{actionError}</p>}
        <footer className="history-preview-footer"><span>原始截图与消息保存在本机</span><Button variant="primary" disabled={acting || !conversation} onClick={() => void resume()}>{acting ? '正在打开…' : '继续对话'}<Icon name="arrow" size={14} /></Button></footer>
      </section>
    </div>}
    {confirming && <Dialog label={confirming.id ? '删除历史对话' : '清空历史对话'} className="history-confirmation" onClose={() => { if (!acting) setConfirming(null); }}>
      <h2>{confirming.id ? '删除这条对话？' : '清空全部历史对话？'}</h2><p>{confirming.id ? `“${confirming.title}”的截图与消息将从本机删除，无法恢复。` : `将删除全部 ${items.length} 条本地对话及其截图，无法恢复。`}</p>
      {actionError && <p role="alert">{actionError}</p>}<div><Button autoFocus disabled={acting} onClick={() => setConfirming(null)}>取消</Button><Button variant="primary" disabled={acting} onClick={() => void remove()}>{acting ? '正在删除…' : confirming.id ? '删除对话' : '清空全部历史'}</Button></div>
    </Dialog>}
  </section>;
}
