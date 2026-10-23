import { useEffect, useState } from 'react';
import type { ShelfState } from '../../../shared/collection';
import type { Result } from '../../../shared/contracts';
import { WorkspaceHeader } from '../components/WorkspaceHeader';
import { Button } from '../components/ui/Button';
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
  useEffect(() => {
    const off = window.snipvia.collection.onChanged(setState);
    void window.snipvia.collection.current().then(r => { if (r.ok) setState(r.value); });
    window.snipvia.window.ready('shelf'); return off;
  }, []);
  useEffect(() => {
    if (!state?.performanceSessionId) return;
    const id = state.performanceSessionId;
    const a = requestAnimationFrame(() => requestAnimationFrame(() => window.snipvia.performance.mark(id, state.expanded ? 'shelf_interactive' : 'shelf_feedback_visible')));
    return () => cancelAnimationFrame(a);
  }, [state]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { void window.snipvia.collection.collapse(); } };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, []);
  function result<T>(r: Result<T>) { if (!r.ok) setError(r.error); }
  if (!state) return null;
  const items = state.collection.items;
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
          <div className="shelf-item-tools"><span>{String(index + 1).padStart(2, '0')}</span><button aria-label={'上移截图 ' + (index + 1)} disabled={index === 0 || sorting} onClick={() => { void move(item.id, index - 1); }}>↑</button><button aria-label={'下移截图 ' + (index + 1)} disabled={index === items.length - 1 || sorting} onClick={() => { void move(item.id, index + 1); }}>↓</button><button aria-label={'删除截图 ' + (index + 1)} onClick={() => { void window.snipvia.collection.remove(item.id).then(result); }}>×</button></div>
        </article>)}
        {!items.length && <p className="shelf-empty">按收集快捷键添加截图</p>}
      </div>
      <footer><Button disabled={!items.length} onClick={() => { void window.snipvia.collection.clear().then(result); }}>清空…</Button><span>最多 32 张 / 256 MiB</span></footer>
      {error && <p role="alert">{error}</p>}
    </> : <><button className="shelf-open" onClick={() => { void window.snipvia.collection.toggle(); }} aria-label="展开截图收纳区"><span className="shelf-stack" aria-hidden="true">▧</span><span>截图收纳</span><strong>{String(items.length).padStart(2, '0')}</strong></button><button className="shelf-hide" aria-label="隐藏收纳区" onClick={() => { void window.snipvia.collection.hide(); }}>×</button></>}
  </main>;
}
