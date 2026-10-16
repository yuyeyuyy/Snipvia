import { useState } from 'react';
import type { NoteHeading } from '../../../shared/note-markdown';
import type { NoteBacklink } from '../../../shared/notes';
import { NoteIcon } from './NoteIcon';

export function NotesOutline({ headings, onJump, backlinks, onOpen, paneCollapsed, onCollapse }: { headings: NoteHeading[]; onJump(heading: NoteHeading): void; backlinks: NoteBacklink[]; onOpen(path: string): void; paneCollapsed: boolean; onCollapse(): void }) {
  const [collapsed, setCollapsed] = useState(new Set<number>()); let hiddenLevel = 7;
  return <aside id="notes-outline" className={`notes-outline${paneCollapsed ? ' pane-collapsed' : ''}`} aria-label="笔记大纲" aria-hidden={paneCollapsed} inert={paneCollapsed}><div className="notes-pane-content"><div className="notes-pane-heading"><strong>大纲</strong><span>
    <button className="note-icon-button" aria-label="展开或折叠大纲" onClick={() => setCollapsed(collapsed.size ? new Set() : new Set(headings.map((heading) => heading.line)))}><NoteIcon name="collapse" size={14} /></button>
    <button className="note-icon-button" aria-label="关闭大纲面板" title="收起标题目录" onClick={onCollapse}><NoteIcon name="back" size={14} /></button>
  </span></div><div className="notes-outline-body">
    {headings.map((heading, index) => {
      if (heading.level > hiddenLevel) return null; hiddenLevel = 7;
      if (collapsed.has(heading.line)) hiddenLevel = heading.level;
      const children = headings[index + 1]?.level > heading.level;
      return <div className="note-outline-row" style={{ paddingLeft: (heading.level - 1) * 12 }} key={heading.id}>
        <button className={`note-outline-chevron${collapsed.has(heading.line) ? ' collapsed' : ''}`} aria-label={`${collapsed.has(heading.line) ? '展开' : '折叠'} ${heading.text}`} disabled={!children} onClick={() => setCollapsed((previous) => { const next = new Set(previous); if (next.has(heading.line)) next.delete(heading.line); else next.add(heading.line); return next; })}>{children && <NoteIcon name="chevron" size={13} />}</button>
        <button className="note-outline-label" title={heading.text} onClick={() => onJump(heading)}>{heading.text}</button>
      </div>;
    })}
    {!headings.length && <p className="notes-muted">用 # 标题组织笔记<br />大纲会显示在这里</p>}
  </div><div className="notes-backlinks"><strong>反向链接 <small>{backlinks.length || ''}</small></strong>{backlinks.map((item) => <button key={item.path} onClick={() => onOpen(item.path)} title={item.excerpt}><NoteIcon name="link" size={13} /><span>{item.name}</span></button>)}{!backlinks.length && <p className="notes-muted">还没有笔记链接到这里</p>}</div></div></aside>;
}
