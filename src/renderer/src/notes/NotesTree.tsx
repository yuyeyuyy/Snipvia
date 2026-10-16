import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { createPortal } from 'react-dom';
import type { NoteEntry } from '../../../shared/notes';
import { NoteIcon } from './NoteIcon';
import { isVisibleNoteEntry, noteDragType, noteDropTarget, type NoteDropTarget } from './note-drag';

type TreeDrag = { entry: NoteEntry; x: number; y: number; target: NoteDropTarget | null };

export function NotesTree({ entries, current, selected, onSelect, onOpen, onCreate, onAction, onMove, onRefresh, disabled, paneCollapsed, onCollapse }: {
  entries: NoteEntry[]; current?: string; selected: string; onSelect(path: string): void; onOpen(path: string): void;
  onCreate(kind: 'note' | 'folder'): void; onAction(action: 'rename' | 'move' | 'trash' | 'reveal', path: string): void;
  onMove(path: string, parent: string): Promise<boolean>; onRefresh(): void; disabled: boolean; paneCollapsed: boolean; onCollapse(): void;
}) {
  const [expanded, setExpanded] = useState(new Set<string>()); const [sort, setSort] = useState('name-asc'); const [autoReveal, setAutoReveal] = useState(true);
  const [menu, setMenu] = useState<string | null>(null); const [sortMenu, setSortMenu] = useState(false); const root = useRef<HTMLDivElement>(null);
  const visibleEntries = useMemo(() => entries.filter(isVisibleNoteEntry), [entries]);
  const entriesRef = useRef(visibleEntries); entriesRef.current = visibleEntries;
  const [drag, setDrag] = useState<TreeDrag | null>(null); const dragRef = useRef<TreeDrag | null>(null);
  const tree = useRef<HTMLDivElement>(null); const ghost = useRef<HTMLCanvasElement>(null);
  const hover = useRef<string | null>(null); const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const scrollFrame = useRef<number | undefined>(undefined); const expandedRef = useRef(expanded); expandedRef.current = expanded;
  function clearHover() { clearTimeout(hoverTimer.current); hover.current = null; }
  function finishDrag() {
    dragRef.current = null; setDrag(null); clearHover();
    if (scrollFrame.current !== undefined) cancelAnimationFrame(scrollFrame.current);
    scrollFrame.current = undefined;
  }
  function updateDrag(next: TreeDrag) {
    const previous = dragRef.current; dragRef.current = next; setDrag(next);
    if (previous?.target?.parent === next.target?.parent && previous?.target?.reason === next.target?.reason) return;
    clearHover();
    const target = next.target;
    if (!target?.parent || target.reason || expandedRef.current.has(target.parent)) return;
    hover.current = target.parent;
    hoverTimer.current = setTimeout(() => {
      if (dragRef.current?.target?.parent !== hover.current || dragRef.current?.target?.reason) return;
      setExpanded((previous) => new Set([...previous, target.parent]));
    }, 650);
  }
  function targetAt(element: EventTarget | null, entry: NoteEntry) {
    const node = element instanceof Element ? element.closest('[data-drop-parent]') : null;
    return node && tree.current?.contains(node) ? noteDropTarget(entry, node.getAttribute('data-drop-parent') ?? '', entriesRef.current) : null;
  }
  function scrollWhileDragging() {
    const session = dragRef.current; const container = tree.current;
    if (!session || !container) { scrollFrame.current = undefined; return; }
    const bounds = container.getBoundingClientRect();
    if (session.target && session.x >= bounds.left && session.x <= bounds.right && session.y >= bounds.top && session.y <= bounds.bottom) {
      const edge = 32;
      const speed = session.y < bounds.top + edge ? -Math.ceil((bounds.top + edge - session.y) / 4)
        : session.y > bounds.bottom - edge ? Math.ceil((session.y - bounds.bottom + edge) / 4) : 0;
      const before = container.scrollTop; container.scrollTop += speed;
      if (container.scrollTop !== before) {
        const target = targetAt(document.elementFromPoint(session.x, session.y), session.entry);
        if (target?.parent !== session.target?.parent || target?.reason !== session.target?.reason) updateDrag({ ...session, target });
      }
    }
    scrollFrame.current = requestAnimationFrame(scrollWhileDragging);
  }
  useEffect(() => {
    const outside = (event: globalThis.DragEvent) => {
      const session = dragRef.current;
      if (session && !(event.target instanceof Node && root.current?.contains(event.target))) updateDrag({ ...session, x: event.clientX, y: event.clientY, target: null });
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') finishDrag(); };
    window.addEventListener('dragover', outside); window.addEventListener('dragend', finishDrag);
    window.addEventListener('drop', finishDrag); window.addEventListener('blur', finishDrag); window.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('dragover', outside); window.removeEventListener('dragend', finishDrag);
      window.removeEventListener('drop', finishDrag); window.removeEventListener('blur', finishDrag); window.removeEventListener('keydown', escape);
      clearHover(); if (scrollFrame.current !== undefined) cancelAnimationFrame(scrollFrame.current);
    };
  }, []);
  useEffect(() => { if (disabled || paneCollapsed) finishDrag(); }, [disabled, paneCollapsed]);
  function startDrag(event: DragEvent, entry: NoteEntry) {
    if (disabled || paneCollapsed) { event.preventDefault(); return; }
    event.dataTransfer.setData(noteDragType, entry.path); event.dataTransfer.effectAllowed = 'copyMove';
    if (ghost.current) event.dataTransfer.setDragImage(ghost.current, 0, 0);
    onSelect(entry.path); setMenu(null); setSortMenu(false);
    updateDrag({ entry, x: event.clientX, y: event.clientY, target: null });
    if (scrollFrame.current === undefined) scrollFrame.current = requestAnimationFrame(scrollWhileDragging);
  }
  function dragOver(event: DragEvent) {
    event.preventDefault(); event.stopPropagation();
    const session = dragRef.current;
    if (!session || disabled || paneCollapsed) { event.dataTransfer.dropEffect = 'none'; return; }
    const target = targetAt(event.target, session.entry);
    event.dataTransfer.dropEffect = target && !target.reason ? 'move' : 'none';
    updateDrag({ ...session, x: event.clientX, y: event.clientY, target });
  }
  function drop(event: DragEvent) {
    event.preventDefault(); event.stopPropagation();
    const session = dragRef.current; const path = event.dataTransfer.getData(noteDragType);
    const target = session && targetAt(event.target, session.entry);
    finishDrag();
    if (!session || path !== session.entry.path || !target || target.reason || disabled || paneCollapsed) return;
    void onMove(path, target.parent).then((moved) => {
      if (!moved) return;
      setExpanded((previous) => new Set([...previous].map((item) => item === path || item.startsWith(`${path}/`) ? target.destination + item.slice(path.length) : item).concat(target.parent ? [target.parent] : [])));
    });
  }
  useEffect(() => {
    if (!current || !autoReveal) return;
    const parts = current.split('/'); parts.pop();
    setExpanded((previous) => new Set([...previous, ...parts.map((_, i) => parts.slice(0, i + 1).join('/'))]));
    requestAnimationFrame(() => root.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest' }));
  }, [current, autoReveal]);
  useEffect(() => { const close = (event: KeyboardEvent) => { if (event.key === 'Escape') { setMenu(null); setSortMenu(false); } }; document.addEventListener('keydown', close); return () => document.removeEventListener('keydown', close); }, []);
  function rows(parent = '', level = 0): React.ReactNode {
    const children = visibleEntries.filter((entry) => entry.path.split('/').slice(0, -1).join('/') === parent).sort((a, b) => {
      if ((a.kind === 'folder') !== (b.kind === 'folder')) return a.kind === 'folder' ? -1 : 1;
      const order = sort.endsWith('desc') ? -1 : 1;
      return order * (sort.startsWith('name') ? a.name.localeCompare(b.name, 'zh-CN', { numeric: true }) : sort.startsWith('modified') ? a.modifiedAt - b.modifiedAt : a.createdAt - b.createdAt);
    });
    return children.map((entry) => <div key={entry.path} role="none" data-drop-parent={entry.kind === 'folder' ? entry.path : undefined} className={`note-tree-branch${entry.kind === 'folder' && drag?.target?.parent === entry.path && !drag.target.reason ? ' drop-target' : ''}`}>
      <div role="treeitem" aria-label={entry.name} aria-expanded={entry.kind === 'folder' ? expanded.has(entry.path) : undefined} aria-selected={selected === entry.path}
        data-note-path={entry.path} data-drop-parent={entry.kind === 'folder' ? entry.path : parent}
        className={`note-tree-row${current === entry.path ? ' current' : ''}${selected === entry.path ? ' selected' : ''}${drag?.entry.path === entry.path ? ' drag-source' : ''}`} style={{ paddingLeft: 8 + level * 13 }}
        onContextMenu={(event) => { event.preventDefault(); onSelect(entry.path); setMenu(entry.path); }}>
        <button className="note-tree-item" disabled={disabled} aria-current={current === entry.path ? 'page' : undefined} draggable={!disabled && entry.path !== 'assets'}
          onDragStart={(event) => startDrag(event, entry)} onDragEnd={finishDrag}
          onClick={() => { onSelect(entry.path); setMenu(null); if (entry.kind === 'folder') setExpanded((previous) => { const next = new Set(previous); if (next.has(entry.path)) next.delete(entry.path); else next.add(entry.path); return next; }); else onOpen(entry.path); }}>
          <span className={`note-tree-chevron${expanded.has(entry.path) ? ' expanded' : ''}`}>{entry.kind === 'folder' && <NoteIcon name="chevron" size={14} />}</span><span className="note-tree-name">{entry.kind === 'note' ? entry.name.replace(/\.md$/i, '') : entry.name}</span>
          {entry.kind === 'asset' && <small>{entry.name.split('.').at(-1)?.toUpperCase()}</small>}
        </button>
        <button className="note-tree-more" aria-label={`${entry.name} 的操作`} disabled={disabled} onClick={() => { onSelect(entry.path); setMenu(menu === entry.path ? null : entry.path); }}><NoteIcon name="more" size={14} /></button>
      </div>
      {menu === entry.path && <div className="note-tree-context" role="menu" aria-label="文件操作">{(['rename', 'move', 'reveal', 'trash'] as const).map((action) => <button key={action} role="menuitem" disabled={disabled || (entry.path === 'assets' && action !== 'reveal')} onClick={() => { setMenu(null); onAction(action, entry.path); }}>{({ rename: '重命名', move: '移动到…', reveal: window.snipvia.platform === 'darwin' ? '在 Finder 中显示' : '在文件管理器中显示', trash: '移到废纸篓' })[action]}</button>)}</div>}
      {entry.kind === 'folder' && expanded.has(entry.path) && <div role="group">{rows(entry.path, level + 1)}</div>}
    </div>);
  }
  return <aside id="notes-files" className={`notes-files${paneCollapsed ? ' pane-collapsed' : ''}`} aria-label="笔记文件目录" aria-hidden={paneCollapsed} inert={paneCollapsed} ref={root}><div className="notes-pane-content">
    <div className="notes-pane-heading"><strong>文件</strong><span>
      <button className="note-icon-button" title="新建笔记" aria-label="新建笔记" disabled={disabled} onClick={() => onCreate('note')}><NoteIcon name="new" /></button>
      <button className="note-icon-button" title="新建文件夹" aria-label="新建文件夹" disabled={disabled} onClick={() => onCreate('folder')}><NoteIcon name="folder" /></button>
      <button className="note-icon-button notes-pane-close" aria-label="关闭文件面板" title="收起文件列表" onClick={onCollapse}><NoteIcon name="back" size={14} /></button>
    </span></div>
    <div className="notes-file-toolbar" role="toolbar" aria-label="文件目录工具">
      <button className="note-icon-button" aria-label="刷新文件目录" title="刷新文件目录" onClick={onRefresh}><NoteIcon name="refresh" size={16} /></button>
      <button className="note-icon-button" title="排序" aria-label="文件排序" onClick={() => setSortMenu(!sortMenu)}><NoteIcon name="sort" /></button>
      <button className={`note-icon-button${autoReveal ? ' enabled' : ''}`} title="自动定位当前笔记" aria-label="自动定位当前笔记" aria-pressed={autoReveal} onClick={() => setAutoReveal(!autoReveal)}><NoteIcon name="reveal" /></button>
      <button className="note-icon-button" title={expanded.size ? '折叠所有文件夹' : '展开所有文件夹'} aria-label={expanded.size ? '折叠所有文件夹' : '展开所有文件夹'} onClick={() => setExpanded(expanded.size ? new Set() : new Set(visibleEntries.filter((entry) => entry.kind === 'folder').map((entry) => entry.path)))}><NoteIcon name="collapse" /></button>
    </div>
    {sortMenu && <div className="notes-sort" role="menu" aria-label="排序方式">{[['name-asc', '文件名 · A → Z'], ['name-desc', '文件名 · Z → A'], ['modified-desc', '修改时间 · 最新优先'], ['modified-asc', '修改时间 · 最早优先'], ['created-desc', '创建时间 · 最新优先']].map(([value, label]) => <button role="menuitemradio" aria-checked={sort === value} key={value} onClick={() => { setSort(value); setSortMenu(false); }}>{label}</button>)}</div>}
    <div ref={tree} className={`notes-tree${drag?.target?.parent === '' && !drag.target.reason ? ' root-drop-target' : ''}`} role="tree" aria-label="笔记文件" data-drop-parent="" onDragOver={dragOver} onDrop={drop}
      onDragLeave={(event) => { if (dragRef.current && !(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))) updateDrag({ ...dragRef.current, x: event.clientX, y: event.clientY, target: null }); }}>
      {rows()}
      {!visibleEntries.some((entry) => entry.kind === 'note') && <p className="notes-tree-empty">从一篇新笔记开始</p>}
      <button className="notes-tree-root" aria-label="选择笔记本根目录" data-drop-parent="" onClick={() => onSelect('')}>笔记本根目录{drag && <span>拖到这里移回根目录</span>}</button>
    </div>
    <canvas className="notes-drag-ghost" width={1} height={1} ref={ghost} aria-hidden="true" />
    {drag && createPortal(<div className={`notes-drag-preview${drag.target?.reason ? ' blocked' : ''}`} role="status" aria-label="拖拽移动提示" style={{ left: Math.max(8, Math.min(drag.x + 16, window.innerWidth - 256)), top: Math.max(8, Math.min(drag.y + 18, window.innerHeight - 86)) }}>
      <div><NoteIcon name={drag.entry.kind === 'folder' ? 'directory' : 'file'} size={16} /><strong>{drag.entry.kind === 'note' ? drag.entry.name.replace(/\.md$/i, '') : drag.entry.name}</strong></div>
      <span>{drag.target ? drag.target.reason ?? `移动到「${drag.target.parent || '笔记本根目录'}」` : '拖至文件夹或根目录'}</span>
    </div>, document.body)}
  </div></aside>;
}
