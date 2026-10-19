import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AppTitleBar } from './AppTitleBar';
import { FeedbackDialog } from './FeedbackDialog';
import { Icon, type IconName } from './Icon';
import { Dialog } from './ui/Dialog';
import { IconButton, Input } from './ui/Button';

export type AppPage = 'chat' | 'history' | 'schedule' | 'settings' | 'notes';
const destinations: { page: AppPage; title: string; icon: IconName }[] = [
  { page: 'chat', title: 'AI 对话', icon: 'chat' },
  { page: 'notes', title: 'AI 笔记', icon: 'notebook' },
  { page: 'schedule', title: '截图日程', icon: 'calendar' },
  { page: 'history', title: '历史对话', icon: 'history' }
];
const commands = [...destinations, { page: 'settings' as const, title: '设置', icon: 'settings' as const }];

function CommandPalette({ onNavigate, onClose }: { onNavigate: (page: AppPage) => void; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const results = commands.filter((item) => item.title.toLowerCase().includes(query.toLowerCase()));
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  function choose(page: AppPage) { onClose(); onNavigate(page); }
  return <Dialog label="快捷导航" className="command-palette" onClose={onClose}>
    <div className="command-search"><Icon name="search" /><Input autoFocus aria-label="搜索页面与操作" placeholder="搜索页面与操作…" value={query} onChange={(event) => { setQuery(event.target.value); setSelected(0); }} onKeyDown={(event) => {
      if (event.nativeEvent.isComposing) return;
      if (event.key === 'Enter' && results[selected]) { event.preventDefault(); choose(results[selected].page); }
      if (['ArrowDown', 'ArrowUp'].includes(event.key) && results.length) {
        event.preventDefault(); const next = (selected + (event.key === 'ArrowDown' ? 1 : results.length - 1)) % results.length;
        setSelected(next); items.current[next]?.scrollIntoView({ block: 'nearest' });
      }
    }} /><IconButton icon="close" label="关闭快捷导航" onClick={onClose} /></div>
    <div className="command-results" role="group" aria-label="导航结果">{results.map((item, index) => <button ref={(node) => { items.current[index] = node; }} type="button" key={item.page} className={selected === index ? 'selected' : ''} onFocus={() => setSelected(index)} onClick={() => choose(item.page)}><Icon name={item.icon} /><span>{item.title}</span>{selected === index && <kbd>↵</kbd>}</button>)}
      {!results.length && <p className="ui-empty-state">没有匹配的页面</p>}
    </div><div className="command-footer"><span>↑ ↓ 选择</span><span>Return 打开</span><span>Esc 关闭</span></div>
  </Dialog>;
}

export function AppShell({ children, sidebarContent, page, sidebarCollapsed, unreadScheduleCount, onToggleSidebar, onNavigate }: {
  sidebarContent?: ReactNode;
  children: ReactNode; page: AppPage; sidebarCollapsed: boolean; unreadScheduleCount: number;
  onToggleSidebar: () => void; onNavigate: (page: AppPage) => void;
}) {
  const [commandsOpen, setCommandsOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [compact, setCompact] = useState(() => matchMedia('(max-width: 1050px)').matches);
  const [compactExpanded, setCompactExpanded] = useState(false);
  const collapsed = sidebarCollapsed || (compact && !compactExpanded);
  useEffect(() => {
    const media = matchMedia('(max-width: 1050px)');
    const update = () => { setCompact(media.matches); setCompactExpanded(false); };
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (event.isComposing || !(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      // Do not navigate away while an existing permission/settings modal owns focus.
      if ([...document.querySelectorAll('[aria-modal="true"], dialog[open]')].some((dialog) => !dialog.classList.contains('command-palette') && dialog.checkVisibility())) return;
      if (event.key.toLowerCase() === 'k') { event.preventDefault(); setCommandsOpen((value) => !value); }
      if (event.key === ',') { event.preventDefault(); setCommandsOpen(false); onNavigate('settings'); }
    }
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [commandsOpen, onNavigate]);
  function toggle() {
    if (compact && !sidebarCollapsed) setCompactExpanded((value) => !value);
    else { onToggleSidebar(); if (compact) setCompactExpanded(true); }
  }
  return <div className={`app-shell${page === 'chat' ? ' chat-active' : ''}${collapsed ? ' sidebar-collapsed' : ''}`}>
    <AppTitleBar settingsActive={page === 'settings'} sidebarCollapsed={collapsed} onSettings={() => onNavigate('settings')} onToggleSidebar={toggle} onSearch={() => setCommandsOpen(true)} onFeedback={() => setFeedbackOpen(true)} />
    <aside className="sidebar" id="app-sidebar" aria-label="菜单栏"><nav aria-label="主导航">{destinations.map((item) => <button type="button" key={item.page} className={page === item.page ? 'nav active' : 'nav'} aria-label={item.title} title={item.page === 'schedule' && unreadScheduleCount > 0 ? `${item.title} · ${unreadScheduleCount} 条未查看日程` : item.title} aria-current={page === item.page ? 'page' : undefined} onClick={() => onNavigate(item.page)}><Icon name={item.icon} /><span>{item.title}</span>{item.page === 'schedule' && unreadScheduleCount > 0 && <b aria-label={`${unreadScheduleCount} 条未查看日程`}>{unreadScheduleCount > 99 ? '99+' : unreadScheduleCount}</b>}</button>)}</nav>{page === 'chat' && sidebarContent}</aside>
    <main>{children}</main>
    {feedbackOpen && <FeedbackDialog onClose={() => setFeedbackOpen(false)} />}
    {commandsOpen && <CommandPalette onClose={() => setCommandsOpen(false)} onNavigate={onNavigate} />}
  </div>;
}
