import { memo, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type DragEvent as ReactDragEvent } from 'react';
import { shelfCardRect, shelfLayout, shelfContentTop, shelfDropIndex, type ShelfState } from '../../../shared/collection';
import type { Result } from '../../../shared/contracts';
import { WorkspaceHeader } from '../components/WorkspaceHeader';
import { Icon } from '../components/Icon';
import { mergeCollectionImages } from './merge-images';
import { orderedOutputIds } from '../../../shared/collection-output';
import { ShelfActionButton } from './ShelfActionButton';
import { ShelfPreview } from './ShelfPreview';
import './shelf.css';

const thumbnails = new Map<string, Promise<string>>();
function thumbnail(id: string) {
  let value = thumbnails.get(id);
  if (!value) {
    value = window.snipvia.collection.thumbnail(id).then(r => { if (!r.ok) throw new Error(r.error); return r.value; });
    thumbnails.set(id, value);
    void value.catch(() => { thumbnails.delete(id); });
    if (thumbnails.size > 32) thumbnails.delete(thumbnails.keys().next().value!);
  }
  return value;
}
const Thumbnail = memo(function Thumbnail({ id, index, width, height, fullUrl, onError }: { id: string; index: number; width: number; height: number; fullUrl?: string; onError(value: string): void }) {
  const [url, setUrl] = useState('');
  useEffect(() => { let live = true; void thumbnail(id).then(value => { if (live) setUrl(value); }).catch(error => { if (live) onError(error.message); }); return () => { live = false; }; }, [id, onError]);
  return url ? <img src={fullUrl || url} alt={'截图 ' + (index + 1)} style={{ width, height }} draggable={false} /> : <span className="shelf-loading">正在预览…</span>;
});

export function ScreenshotShelf() {
  const [state, setState] = useState<ShelfState | null>(null), [error, setError] = useState('');
  const [multiSelect, setMultiSelect] = useState(false), [selected, setSelected] = useState<string[]>([]);
  const [dragging, setDragging] = useState<string | null>(null), [sorting, setSorting] = useState(false);
  const [outputting, setOutputting] = useState(false), [hovered, setHovered] = useState<string | null>(null);
  const [scrollY, setScrollY] = useState(0), [viewport, setViewport] = useState({ width: innerWidth, height: innerHeight });
  const [dragVisual, setDragVisual] = useState({ offset: 0, target: -1 });
  const panel = useRef<HTMLElement>(null), scroll = useRef<HTMLDivElement>(null), fly = useRef<HTMLImageElement>(null);
  const live = useRef(true), outputBusy = useRef(false), dragRaf = useRef(0);
  const suppressClick = useRef<{ id: string; until: number } | null>(null);
  const drag = useRef<null | { id: string; index: number; revision: number; startX: number; startY: number; y: number; startScroll: number; active: boolean; element: HTMLElement }>(null);
  const view = state?.viewport ?? viewport;
  const layout = shelfLayout(state?.collection.items ?? [], view.width, state?.expanded ?? false, state?.expanded ? view.height : state?.preferences.height);
  useEffect(() => {
    live.current = true;
    const off = window.snipvia.collection.onChanged(setState);
    void window.snipvia.collection.current().then(r => { if (live.current && r.ok) setState(r.value); });
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => { void window.snipvia.collection.reducedMotion(motion.matches); };
    const resize = () => setViewport({ width: innerWidth, height: innerHeight });
    update(); motion.addEventListener('change', update); window.addEventListener('resize', resize);
    window.snipvia.window.ready('shelf');
    return () => { live.current = false; off(); motion.removeEventListener('change', update); window.removeEventListener('resize', resize); };
  }, []);

  useEffect(() => {
    if (!state) return;
    const ids = new Set(state.collection.items.map(item => item.id));
    for (const id of thumbnails.keys()) if (!ids.has(id)) thumbnails.delete(id);
    setSelected(value => value.filter(id => ids.has(id)));
    if (!state.expanded) { setMultiSelect(false); setSelected([]); setScrollY(0); if (scroll.current) scroll.current.scrollTop = 0; }
    if (hovered && !ids.has(hovered)) setHovered(null);
  }, [state?.collection.revision, state?.expanded]);
  useEffect(() => {
    if (state?.suspended || state?.hidden || state?.preview) { stopDrag(); setHovered(null); }
  }, [state?.suspended, state?.hidden, state?.preview?.id]);
  useEffect(() => () => { cancelAnimationFrame(dragRaf.current); void window.snipvia.collection.interaction(false); }, []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || state?.preview) return;
      if (drag.current) stopDrag(); else void window.snipvia.collection.collapse();
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [state?.preview?.id]);

  useEffect(() => {
    if (!state || state.suspended || state.preview) return;
    let cancelled = false, painted = 0;
    let animation: Animation | undefined;
    const feedback = state.feedback;
    async function present() {
      const started = performance.now();
      if (feedback?.kind === 'fly') {
        thumbnails.set(feedback.id, Promise.resolve(feedback.thumbnail));
        try { await fly.current?.decode(); } catch { if (!cancelled) void window.snipvia.collection.feedbackFinished(state!.presentation); return; }
      }
      if (cancelled) return;
      if (feedback?.kind === 'fly' && fly.current) {
        const dx = feedback.target.x - feedback.source.x, dy = feedback.target.y - feedback.source.y;
        const scale = feedback.target.width / feedback.source.width;
        const arc = Math.min(90, Math.hypot(dx, dy) * .09);
        const path = Array.from({ length: 21 }, (_, index) => {
          const t = index / 20;
          return { offset: t, transform: `translate(${dx * t}px,${dy * t - 4 * arc * t * (1 - t)}px) scale(${1 + (scale - 1) * t}) rotate(${-Math.sin(Math.PI * t)}deg)` };
        });
        animation = fly.current.animate(path, { duration: feedback.duration, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'forwards' });
        animation.pause(); animation.currentTime = 0;
        animation.onfinish = () => { if (!cancelled) void window.snipvia.collection.feedbackFinished(state!.presentation); };
      }
      // A zero-alpha native surface may defer RAF. DOM commit + image decode
      // prepare the first frame; restore visibility before awaiting paint.
      if (['docking', 'revealing'].includes(state!.edge) && panel.current) {
        const out = state!.edge === 'docking';
        animation = panel.current.animate([{ transform: out ? 'translateX(0)' : 'translateX(100%)', opacity: out ? 1 : 0 }, { transform: out ? 'translateX(100%)' : 'translateX(0)', opacity: out ? 0 : 1 }],
          { duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : out ? 240 : 300, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'forwards' });
        animation.pause(); animation.currentTime = 0;
        animation.onfinish = () => { if (!cancelled) void window.snipvia.collection.edgeFinished(state!.presentation); };
      }
      const decodedAt = performance.now();
      const result = await window.snipvia.collection.rendered(state!.presentation);
      if (!result.ok || !result.value || cancelled) { animation?.cancel(); return; }
      animation?.play();
      const acknowledgedAt = performance.now();
      painted = requestAnimationFrame(() => {
        if (!cancelled && state!.performanceSessionId) window.snipvia.performance.mark(state!.performanceSessionId, state!.expanded && !feedback ? 'shelf_interactive' : 'shelf_feedback_visible', { shelfDecodeMs: decodedAt - started, shelfAckMs: acknowledgedAt - decodedAt, shelfPaintWaitMs: performance.now() - acknowledgedAt });
      });
    }
    void present();
    return () => { cancelled = true; animation?.cancel(); cancelAnimationFrame(painted); };
  }, [state?.presentation]);

  useEffect(() => {
    if (!state || state.suspended || state.feedback || state.hidden) return;
    let frame = 0, until = performance.now() + 420, cancelled = false;
    function regions() {
      if (cancelled) return;
      const boxes = [...document.querySelectorAll<HTMLElement>('[data-shelf-hit]')].filter(node => !node.closest('[data-hidden="true"]') && !node.parentElement?.closest('[data-shelf-hit]')).flatMap(node => {
        const parts = [node, ...node.querySelectorAll<HTMLElement>('button, input, label')].map(part => part.getBoundingClientRect());
        const clip = node.closest('.shelf-scroll')?.getBoundingClientRect();
        const left = Math.max(0, Math.min(...parts.map(r => r.left))), right = Math.min(innerWidth, Math.max(...parts.map(r => r.right)));
        const top = Math.max(0, clip?.top ?? 0, Math.min(...parts.map(r => r.top))), bottom = Math.min(innerHeight, clip?.bottom ?? innerHeight, Math.max(...parts.map(r => r.bottom)));
        return right > left && bottom > top ? [{ x: left, y: top, width: right - left, height: bottom - top }] : [];
      });
      void window.snipvia.collection.hitRegions(boxes);
      if (performance.now() < until) frame = requestAnimationFrame(regions);
    }
    const onScroll = () => { until = performance.now() + 80; cancelAnimationFrame(frame); frame = requestAnimationFrame(regions); };
    frame = requestAnimationFrame(regions); scroll.current?.addEventListener('scroll', onScroll);
    const element = scroll.current;
    return () => { cancelled = true; cancelAnimationFrame(frame); element?.removeEventListener('scroll', onScroll); };
  }, [state?.presentation, state?.collection.revision, state?.preview?.id, state?.edge, viewport, multiSelect, hovered, scrollY]);

  function stopDrag() {
    cancelAnimationFrame(dragRaf.current); dragRaf.current = 0; drag.current = null;
    setDragging(null); setDragVisual({ offset: 0, target: -1 });
    void window.snipvia.collection.interaction(false);
  }
  function updateDrag() {
    const current = drag.current, element = scroll.current;
    if (!current?.active || !element || !state) return;
    const bounds = element.getBoundingClientRect();
    if (current.y < bounds.top + 36) element.scrollTop -= 10;
    if (current.y > bounds.bottom - 36) element.scrollTop += 10;
    const target = shelfDropIndex(layout.cards, current.y - bounds.top + element.scrollTop);
    setDragVisual({ offset: current.y - current.startY + element.scrollTop - current.startScroll, target });
    dragRaf.current = requestAnimationFrame(updateDrag);
  }
  function beginDrag(event: ReactPointerEvent<HTMLElement>, id: string, index: number) {
    suppressClick.current = null;
    if (!state?.expanded || multiSelect || sorting || outputting || event.button !== 0 || !event.altKey
      || (event.target as HTMLElement).closest('.shelf-card-action, .shelf-select')) return;
    event.preventDefault();
    drag.current = { id, index, revision: state.collection.revision, startX: event.clientX, startY: event.clientY,
      y: event.clientY, startScroll: scroll.current?.scrollTop ?? 0, active: false, element: event.currentTarget };
  }
  function dragMove(event: ReactPointerEvent<HTMLElement>) {
    const current = drag.current; if (!current) return;
    current.y = event.clientY;
    if (!current.active && Math.hypot(event.clientX - current.startX, event.clientY - current.startY) > 6) {
      current.active = true; event.currentTarget.setPointerCapture(event.pointerId);
      setDragging(current.id); void window.snipvia.collection.interaction(true);
      dragRaf.current = requestAnimationFrame(updateDrag);
    }
    if (current.active) event.preventDefault();
  }
  function endDrag(event: ReactPointerEvent<HTMLElement>) {
    const current = drag.current; if (!current) return;
    if (current.active) {
      const bounds = scroll.current!.getBoundingClientRect();
      const target = shelfDropIndex(layout.cards, event.clientY - bounds.top + scroll.current!.scrollTop);
      suppressClick.current = { id: current.id, until: performance.now() + 300 };
      void move(current.id, target, current.revision);
    }
    stopDrag();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function result<T>(r: Result<T>) { if (!r.ok) setError(r.error); }
  async function move(id: string, target: number, expectedRevision = state?.collection.revision) {
    if (!state || sorting) return;
    if (expectedRevision !== state.collection.revision) { setError('收纳区已变化，请重新拖动排序'); return; }
    const ids = state.collection.items.map(item => item.id), from = ids.indexOf(id);
    if (from < 0 || from === target) return;
    ids.splice(from, 1); ids.splice(target, 0, id); setSorting(true); setError('');
    try { result(await window.snipvia.collection.reorder({ ids, revision: state.collection.revision })); } finally { setSorting(false); setDragging(null); }
  }
  function startFileDrag(event: ReactDragEvent, id: string) {
    event.preventDefault();
    if (!state?.expanded || multiSelect || sorting || outputting || event.altKey) return;
    stopDrag(); setError('');
    suppressClick.current = { id, until: Infinity };
    void window.snipvia.collection.startDrag({ id, revision: state.collection.revision }).then(r => {
      if (!r.ok) { suppressClick.current = null; setError(r.error); }
    }).catch(() => { suppressClick.current = null; setError('图片拖出失败，原图已保留'); });
  }
  function clearHover(next: EventTarget | null) {
    if (!(next instanceof Element) || !next.closest('.shelf-card, .shelf-tools')) setHovered(null);
  }
  async function output(kind: 'copy-all' | 'merge' | 'export') {
    if (!state || outputBusy.current) return false;
    outputBusy.current = true; setOutputting(true); setError('');
    try {
      await window.snipvia.collection.interaction(true);
      if (kind === 'copy-all') {
        const r = await window.snipvia.collection.copyAll({ revision: state.collection.revision });
        if (!r.ok) throw new Error(r.error);
        return true;
      }
      const all = state.collection.items.map(item => item.id);
      const ids = orderedOutputIds(all, multiSelect ? selected.filter(id => all.includes(id)) : all);
      if (kind === 'export') {
        const r = await window.snipvia.collection.export({ ids, revision: state.collection.revision });
        if (!r.ok) throw new Error(r.error);
        return r.value !== null;
      }
      const options = { width: state.preferences.mergeWidth, gap: state.preferences.gap };
      const png = await mergeCollectionImages(state.collection.items.filter(item => ids.includes(item.id)), options);
      const r = await window.snipvia.collection.copyMerged({ ids, revision: state.collection.revision, options, png });
      if (!r.ok) throw new Error(r.error);
      return true;
    } finally { outputBusy.current = false; void window.snipvia.collection.interaction(false); if (live.current) setOutputting(false); }
  }
  if (!state) return null;
  if (state.preview) return <><ShelfPreview state={state} thumbnail={thumbnail} onError={setError} />{error && <button className="shelf-notice shelf-glass" role="status" onClick={() => setError('')}>{error}</button>}</>;
  const items = state.collection.items, expanded = state.expanded;
  if (state.feedback?.kind === 'count') return <main className="shelf count-feedback" role="status"><span className="shelf-toast">+1 · 已收集 {items.length} 张</span></main>;
  if (state.feedback?.kind === 'fly') {
    const { source, target, thumbnail: url } = state.feedback;
    return <main className="shelf fly-feedback"><img ref={fly} className="shelf-fly" src={url} alt="" style={{ left: source.x, top: source.y, width: source.width, height: source.height }} /><span className="fly-count" style={{ left: target.x, top: Math.max(0, target.y - 28) }}>+1 · {items.length}</span></main>;
  }
  if (state.hidden || state.suspended) return null;
  if (state.edge === 'docked') return <main className="shelf-edge-tab" data-shelf-hit><button aria-label="拉出收纳区" title="悬停拉出收纳区" onPointerEnter={() => { void window.snipvia.collection.reveal(); }} onFocus={() => { void window.snipvia.collection.reveal(); }} onClick={() => { void window.snipvia.collection.reveal(); }}><Icon name="back" size={13} /></button></main>;
  const activeIds = multiSelect ? selected.filter(id => items.some(item => item.id === id)) : items.map(item => item.id);
  const hoverIndex = items.findIndex(item => item.id === hovered), active = hoverIndex >= 0 && !dragging;
  const hoverBox = layout.cards[Math.max(0, hoverIndex)];
  const toolsStyle = hoverBox ? { left: hoverBox.x + hoverBox.width / 2, top: shelfContentTop + hoverBox.y - scrollY + (hoverBox.height >= 56 ? hoverBox.height - 38 : hoverBox.height + 6) } : {};
  const outputActions = <div className="shelf-output-actions" data-shelf-hit aria-label="收纳区输出">
      <ShelfActionButton className="shelf-output" label="全部复制" icon="copy" disabled={!items.length || outputting} onAction={() => output('copy-all')} onError={setError} />
      <ShelfActionButton className="shelf-output" label="合并复制" icon="merge" disabled={!activeIds.length || outputting} onAction={() => output('merge')} onError={setError} />
      <ShelfActionButton className="shelf-output" label="导出 PNG" icon="export" disabled={!activeIds.length || outputting} onAction={() => output('export')} onError={setError} />
  </div>;
  return <main ref={panel} className={'shelf ' + (expanded ? 'expanded' : 'collapsed') + (dragging ? ' is-sorting' : '')}
    style={{ '--shelf-content-top': shelfContentTop + 'px' } as CSSProperties} data-revision={state.collection.revision}>
    <WorkspaceHeader title="截图收纳">
      {expanded && outputActions}
      <span className="shelf-count">{multiSelect ? '已选 ' + activeIds.length : String(items.length).padStart(2, '0')}</span>
      {expanded && <button className="shelf-glass" data-shelf-hit aria-label={multiSelect ? '退出多选' : '多选截图'} aria-pressed={multiSelect} title="多选" onClick={() => { setMultiSelect(value => !value); setSelected([]); }}><Icon name="select" size={15} /></button>}
      {multiSelect && <button className="shelf-glass" data-shelf-hit aria-label={selected.length === items.length ? '取消全选' : '全选截图'} title="全选" onClick={() => setSelected(selected.length === items.length ? [] : items.map(item => item.id))}><Icon name="check" size={15} /></button>}
      <button className="shelf-glass" data-shelf-hit aria-label={expanded ? '收起收纳区' : '展开图堆'} title={expanded ? '收起' : '展开'} onClick={() => { void (expanded ? window.snipvia.collection.collapse() : window.snipvia.collection.toggle()); }}><Icon name={expanded ? 'collapse' : 'expand'} size={15} /></button>
      <button className="shelf-glass" data-shelf-hit aria-label="隐藏收纳区" title="隐藏" onClick={() => { void window.snipvia.collection.hide(); }}><Icon name="close" size={15} /></button>
    </WorkspaceHeader>
    <div ref={scroll} className="shelf-scroll" onScroll={event => setScrollY(event.currentTarget.scrollTop)}>
      <div className="shelf-grid" aria-label="截图列表" style={{ height: layout.height }}>
        {items.map((item, index) => {
          const hidden = !expanded && index < items.length - 5, base = shelfCardRect(item, 300, 0, 1, false);
          let box = layout.cards[index];
          const scale = box.width / base.width, isDragging = dragging === item.id;
          const cardWidth = expanded ? Math.max(128, box.width) : box.width, cardHeight = expanded ? Math.max(76, box.height) : box.height;
          box = { ...box, x: box.x - (cardWidth - box.width) / 2, y: box.y - (cardHeight - box.height) / 2 };
          const style = { width: cardWidth / scale, height: cardHeight / scale,
            transform: `translate(${box.x}px,${box.y + (isDragging ? dragVisual.offset : 0)}px) rotate(${box.rotation}deg) scale(${scale})`,
            zIndex: isDragging ? 100 : index + 1, '--inverse-scale': 1 / scale } as CSSProperties;
          return <article key={item.id} data-id={item.id} data-hidden={hidden} data-shelf-hit className={'shelf-card' + (isDragging ? ' dragging' : '') + (dragging && !isDragging && dragVisual.target === index ? ' drop-target' : '')}
            style={style} onPointerEnter={() => setHovered(item.id)} onPointerLeave={event => { if (!drag.current?.active) clearHover(event.relatedTarget); }}
            onFocusCapture={() => setHovered(item.id)} onBlurCapture={event => clearHover(event.relatedTarget)}
            onPointerDown={event => beginDrag(event, item.id, index)} onPointerMove={dragMove} onPointerUp={endDrag} onPointerCancel={stopDrag} onLostPointerCapture={() => { if (drag.current) stopDrag(); }}>
            <button className="shelf-preview" tabIndex={hidden ? -1 : 0} aria-label={expanded ? '预览截图 ' + (index + 1) : '展开截图收纳区'} draggable={expanded && !multiSelect && !sorting && !outputting}
              title={expanded ? '拖出原图 · Alt 拖动排序 · 点击预览' : '点击展开收纳区'} onDragStart={event => startFileDrag(event, item.id)}
              onKeyDown={event => { if (['Enter', ' '].includes(event.key)) suppressClick.current = null; if (expanded && event.altKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); void move(item.id, Math.max(0, Math.min(items.length - 1, index + (event.key === 'ArrowUp' ? -1 : 1)))); } }}
              onClick={event => {
                if (suppressClick.current?.id === item.id && performance.now() < suppressClick.current.until) return;
                if (!expanded) { void window.snipvia.collection.toggle().then(result); return; }
                if (multiSelect) { setSelected(value => value.includes(item.id) ? value.filter(id => id !== item.id) : [...value, item.id]); return; }
                const r = event.currentTarget.getBoundingClientRect(), factor = Math.min(r.width / item.width, r.height / item.height);
                const width = item.width * factor, height = item.height * factor;
                void window.snipvia.collection.openPreview({ id: item.id, source: { x: r.x + (r.width - width) / 2, y: r.y + (r.height - height) / 2, width, height } }).then(result);
              }}>
              {!hidden && <Thumbnail id={item.id} index={index} width={base.width} height={base.height} onError={setError} />}
            </button>
            {expanded && <>
              <ShelfActionButton className="shelf-card-action copy-action" label={'复制截图 ' + (index + 1)} icon="copy" onError={setError} onAction={async () => { setError(''); const r = await window.snipvia.collection.copy(item.id); if (!r.ok) throw new Error(r.error); }} />
              <button className="shelf-glass shelf-card-action delete-action" aria-label={'删除截图 ' + (index + 1)} title="删除" onClick={() => { void window.snipvia.collection.remove(item.id).then(result); }}><Icon name="trash" size={16} /></button>
              {multiSelect && <label className="shelf-glass shelf-select" title={'选择截图 ' + (index + 1)}><input type="checkbox" aria-label={'选择截图 ' + (index + 1)} checked={selected.includes(item.id)} onChange={event => setSelected(value => event.target.checked ? [...value, item.id] : value.filter(id => id !== item.id))} /><Icon name={selected.includes(item.id) ? 'check' : 'select'} size={15} /></label>}
              <span className="shelf-card-number">{String(index + 1).padStart(2, '0')}</span>
            </>}
          </article>;
        })}
        {!items.length && <p className="shelf-empty">按收集快捷键添加截图</p>}
      </div>
    </div>
    {expanded && layout.height > view.height - shelfContentTop - 16 && <span className="shelf-scroll-hit" data-shelf-hit aria-hidden="true" />}
    {!expanded && <footer className="shelf-tools" data-shelf-hit data-hidden={!active} aria-hidden={!active} inert={!active} aria-label="收纳区输出" style={toolsStyle}
      onPointerLeave={event => clearHover(event.relatedTarget)} onBlurCapture={event => clearHover(event.relatedTarget)}>
      {outputActions}
    </footer>}
    {error && <button className="shelf-notice shelf-glass" data-shelf-hit role="status" onClick={() => setError('')}>{error}</button>}
  </main>;
}
