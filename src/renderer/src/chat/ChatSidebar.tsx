import { useState } from 'react';
import { Temporal } from '@js-temporal/polyfill';
import type { ConversationSummary, Result } from '../../../shared/contracts';
import { Icon } from '../components/Icon';
import { Button, IconButton, Input } from '../components/ui/Button';
import { Dialog } from '../components/ui/Dialog';
import { groupConversations, filterConversations } from '../history/display';
import './sidebar.css';

export function ChatSidebar({ items, selected, blocked, activeId, onSelect, onDelete, onHistory, onSettings }: {
  items: ConversationSummary[]; selected: string | null; blocked: boolean; activeId: string | null;
  onSelect(id: string | null): void; onDelete(id: string): Promise<Result<void>>; onHistory(): void; onSettings(): void;
}) {
  const [action, setAction] = useState<{ kind: 'menu' | 'rename' | 'delete'; item: ConversationSummary } | null>(null);
  const [title, setTitle] = useState(''); const [error, setError] = useState(''); const [acting, setActing] = useState(false);
  const groups = groupConversations(filterConversations(items, '', 'all'), Temporal.Now.plainDateISO().toString());
  async function commit() {
    if (!action || acting) return;
    setActing(true); setError('');
    try {
      const result = action.kind === 'rename' ? await window.snipvia.history.rename(action.item.id, title) : await onDelete(action.item.id);
      if (!result.ok) throw new Error(result.error);
      setAction(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '操作失败，请重试。'); }
    finally { setActing(false); }
  }
  function open(kind: 'menu' | 'rename' | 'delete', item: ConversationSummary) { setAction({ kind, item }); setTitle(item.title); setError(''); }
  return <div className="chat-navigation-content">
    <Button className="chat-sidebar-new" disabled={blocked} onClick={() => onSelect(null)}><Icon name="edit" size={16} />新对话</Button>
    <div className="chat-sidebar-heading"><span>最近对话</span><IconButton icon="history" label="查看全部历史对话" onClick={onHistory} /></div>
    <div className="chat-sidebar-list" aria-label="最近对话">{groups.length ? groups.map(group => <section key={group.date} aria-label={group.label}><h2>{group.label}</h2>{group.items.map(item => <div className={`chat-sidebar-row${item.id === selected ? ' selected' : ''}`} key={item.id}>
      <button type="button" disabled={blocked} className="chat-sidebar-select" aria-current={selected === item.id ? 'true' : undefined} title={item.title} onClick={() => onSelect(item.id)}><span>{item.title}</span>{activeId === item.id && <span className="ui-spinner" aria-label="正在生成" />}</button>
      <IconButton icon="more" label={`对话操作：${item.title}`} className="chat-sidebar-more" disabled={acting || blocked} onClick={() => open('menu', item)} />
    </div>)}</section>) : <p className="chat-sidebar-empty">对话会保存在这里</p>}</div>
    <Button variant="quiet" className="chat-sidebar-settings" onClick={onSettings}><Icon name="settings" size={16} />设置</Button>
    {action && <Dialog label={action.kind === 'menu' ? '对话操作' : action.kind === 'rename' ? '重命名对话' : '删除对话'} className="chat-conversation-dialog" onClose={() => { if (!acting) setAction(null); }}>
      {action.kind === 'menu' ? <><h2 title={action.item.title}>{action.item.title}</h2><Button variant="quiet" onClick={() => open('rename', action.item)}><Icon name="edit" size={16} />重命名</Button><Button variant="quiet" onClick={() => open('delete', action.item)}><Icon name="close" size={16} />删除对话</Button><Button variant="quiet" onClick={() => setAction(null)}>关闭</Button></> : <form onSubmit={event => { event.preventDefault(); void commit(); }}>
        <h2>{action.kind === 'rename' ? '重命名对话' : '删除这条对话？'}</h2>
        {action.kind === 'rename' ? <label>对话名称<Input autoFocus aria-label="对话名称" value={title} disabled={acting} maxLength={120} onChange={event => setTitle(event.target.value)} /></label> : <p>“{action.item.title}”的本地消息与图片将被删除，无法恢复。</p>}
        {error && <p role="alert">{error}</p>}<footer><Button autoFocus={action.kind === 'delete'} disabled={acting} onClick={() => setAction(null)}>取消</Button><Button type="submit" variant="primary" disabled={acting || action.kind === 'rename' && !title.trim()}>{acting ? '处理中…' : action.kind === 'rename' ? '保存名称' : '删除对话'}</Button></footer>
      </form>}
    </Dialog>}
  </div>;
}
