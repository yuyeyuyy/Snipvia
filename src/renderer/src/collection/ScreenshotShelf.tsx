import { useEffect, useState, type CSSProperties } from 'react';
import type { ShelfState } from '../../../shared/collection';
import type { Result } from '../../../shared/contracts';
import { WorkspaceHeader } from '../components/WorkspaceHeader';
import { Button } from '../components/ui/Button';
import { mergeCollectionImages } from './merge-images';
import { orderedOutputIds } from '../../../shared/collection-output';
import './shelf.css';

function Thumbnail({ id, index, onError }: { id: string; index: number; onError(value: string): void }) {
  const [url, setUrl] = useState('');
  useEffect(() => { let active = true; void window.snipvia.collection.thumbnail(id).then(r => { if (active) { if (r.ok) setUrl(r.value); else onError(r.error); } }); return () => { active = false; }; }, [id, onError]);
  return url ? <img src={url} alt={'截图 ' + (index + 1)} draggable={false} /> : <span>正在预览…</span>;
}
export function ScreenshotShelf() {
  const [state, setState] = useState<ShelfState | null>(null);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState<string | null>(null);
  const [sorting, setSorting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [width, setWidth] = useState(1600);
  const [gap, setGap] = useState(12);
  const [outputting, setOutputting] = useState(false);
  useEffect(() => {
    const off = window.snipvia.collection.onChanged(setState);
    void window.snipvia.collection.current().then(r => { if (r.ok) setState(r.value); });
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => { void window.snipvia.collection.reducedMotion(motion.matches); };
    update(); motion.addEventListener('change', update);
    window.snipvia.window.ready('shelf'); return () => { off(); motion.removeEventListener('change', update); };
  }, []);
  useEffect(() => {
    if (!state) return;
    let cancelled = false, second = 0, third = 0;
    const first = requestAnimationFrame(() => { second = requestAnimationFrame(() => {
      if (cancelled) return;
      void window.snipvia.collection.rendered(state.presentation).then(result => {
        if (!result.ok || !result.value || cancelled || !state.performanceSessionId) return;
        if (state.feedback?.kind === 'fly') for (const animation of document.getAnimations()) { animation.currentTime = 0; animation.play(); }
        third = requestAnimationFrame(() => {
          if (!cancelled) window.snipvia.performance.mark(state.performanceSessionId, state.expanded && !state.feedback ? 'shelf_interactive' : 'shelf_feedback_visible');
        });
      });
    }); });
    return () => { cancelled = true; cancelAnimationFrame(first); cancelAnimationFrame(second); cancelAnimationFrame(third); };
  }, [state]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { void window.snipvia.collection.collapse(); } };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, []);
  async function output(kind: 'copy' | 'export') {
    if (!state || outputting) return;
    setOutputting(true); setError('');
    try {
      const all = state.collection.items.map(item => item.id);
      const ids = orderedOutputIds(all, selected.filter(id => all.includes(id)).length ? selected.filter(id => all.includes(id)) : all);
      if (kind === 'export') {
        const r = await window.snipvia.collection.export({ ids, revision: state.collection.revision });
        if (!r.ok) throw new Error(r.error);
        if (r.value) setError('已导出 ' + r.value.count + ' 张图片');
      } else {
        const options = { width, gap };
        const png = await mergeCollectionImages(state.collection.items.filter(item => ids.includes(item.id)), options);
        const r = await window.snipvia.collection.copyMerged({ ids, revision: state.collection.revision, options, png });
        if (!r.ok) throw new Error(r.error); setError('已合并复制，可粘贴为一张图片');
      }
    } catch (error) { setError(error instanceof Error ? error.message : '输出失败，原图已保留'); }
    finally { setOutputting(false); }
  }
  function result<T>(r: Result<T>) { if (!r.ok) setError(r.error); }
  if (!state) return null;
  const items = state.collection.items;
  if (state.feedback?.kind === 'count') return <main className="shelf count-feedback" role="status"><strong>+1</strong><span>已收集 {items.length} 张</span></main>;
  if (state.feedback?.kind === 'fly' && state.feedback.source && state.feedback.target) {
    const { source, target, thumbnail, duration } = state.feedback;
    const style = { left: source.x, top: source.y, width: source.width, height: source.height,
      '--fly-x': (target.x - source.x) + 'px', '--fly-y': (target.y - source.y) + 'px',
      '--fly-sx': String(target.width / source.width), '--fly-sy': String(target.height / source.height),
      animationDuration: duration + 'ms' } as CSSProperties;
    return <><img className="shelf-fly" src={thumbnail} alt="" style={style} /><main className="shelf fly-destination" style={{ left: target.x, top: target.y, width: target.width, height: target.height }}><span>▧ 截图收纳</span><strong>{String(items.length).padStart(2, '0')}</strong></main></>;
  }
  if (state.hidden) return null;
  async function move(id: string, target: number) {
    if (!state || sorting) return;
    const ids = items.map(item => item.id), from = ids.indexOf(id);
    if (from < 0 || from === target) return;
    ids.splice(from, 1); ids.splice(target, 0, id); setSorting(true); setError('');
    try { result(await window.snipvia.collection.reorder({ ids, revision: state.collection.revision })); } finally { setSorting(false); setDragging(null); }
  }
  return <main className={'shelf ' + (state.expanded ? 'expanded' : 'collapsed')} data-revision={state.collection.revision}>
    {state.expanded ? <>
      <WorkspaceHeader title="截图收纳"><span>{items.length}</span><button aria-label="收起收纳区" onClick={() => { void window.snipvia.collection.collapse(); }}>−</button><button aria-label="隐藏收纳区" onClick={() => { void window.snipvia.collection.hide(); }}>×</button></WorkspaceHeader>
      <p className="shelf-caption">拖动调整顺序 · 本次运行内保留</p>
      <div className="shelf-grid" aria-label="截图列表">
        {items.map((item, index) => <article key={item.id} data-id={item.id} draggable={!sorting} onDragStart={() => setDragging(item.id)} onDragEnd={() => setDragging(null)} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (dragging) void move(dragging, index); }}>
          <button className="shelf-preview" aria-label={'预览截图 ' + (index + 1)} onClick={() => { void window.snipvia.collection.preview(item.id).then(result); }}><Thumbnail id={item.id} index={index} onError={setError} /></button>
          <div className="shelf-item-tools"><input type="checkbox" aria-label={'选择截图 ' + (index + 1)} checked={selected.includes(item.id)} onChange={event => setSelected(old => event.target.checked ? [...old, item.id] : old.filter(id => id !== item.id))} /><span>{String(index + 1).padStart(2, '0')}</span><button aria-label={'上移截图 ' + (index + 1)} disabled={index === 0 || sorting} onClick={() => { void move(item.id, index - 1); }}>↑</button><button aria-label={'下移截图 ' + (index + 1)} disabled={index === items.length - 1 || sorting} onClick={() => { void move(item.id, index + 1); }}>↓</button><button aria-label={'删除截图 ' + (index + 1)} onClick={() => { void window.snipvia.collection.remove(item.id).then(result); }}>×</button></div>
        </article>)}
        {!items.length && <p className="shelf-empty">按收集快捷键添加截图</p>}
      </div>
      <div className="shelf-output-options"><label>宽度 <select aria-label="合并最大宽度" value={width} onChange={e => setWidth(Number(e.target.value))}>{[800, 1600, 2048, 4096].map(w => <option key={w} value={w}>{w}px</option>)}</select></label><label>间距 <select aria-label="合并间距" value={gap} onChange={e => setGap(Number(e.target.value))}>{[0, 8, 12, 24].map(g => <option key={g} value={g}>{g}px</option>)}</select></label><span>{selected.filter(id => items.some(item => item.id === id)).length || items.length} 张</span></div>
      <footer><Button disabled={!items.length || outputting} onClick={() => { void output('copy'); }}>{outputting ? '处理中…' : '合并复制'}</Button><Button disabled={!items.length || outputting} onClick={() => { void output('export'); }}>导出 PNG</Button><Button disabled={!items.length || outputting} onClick={() => { void window.snipvia.collection.clear().then(result); }}>清空…</Button></footer>
      {error && <p role="alert">{error}</p>}
    </> : <><button className="shelf-open" onClick={() => { void window.snipvia.collection.toggle(); }} aria-label="展开截图收纳区"><span className="shelf-stack" aria-hidden="true">▧</span><span>截图收纳</span><strong>{String(items.length).padStart(2, '0')}</strong></button><button className="shelf-hide" aria-label="隐藏收纳区" onClick={() => { void window.snipvia.collection.hide(); }}>×</button></>}
  </main>;
}
