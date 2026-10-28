import { useEffect, useRef } from 'react';
import type { ShelfState } from '../../../shared/collection';
import { WorkspaceHeader } from '../components/WorkspaceHeader';
import { Icon } from '../components/Icon';
import { ShelfActionButton } from './ShelfActionButton';

export function ShelfPreview({ state, thumbnail, onError }: { state: ShelfState; thumbnail(id: string): Promise<string>; onError(value: string): void }) {
  const image = useRef<HTMLImageElement>(null), fullUrl = useRef(''), decoding = useRef(false);
  const preview = state.preview!, id = preview.id;
  useEffect(() => {
    let live = true, url = '';
    void window.snipvia.collection.image(id).then(async result => {
      if (!live) return;
      if (!result.ok) { onError(result.error); return; }
      url = URL.createObjectURL(new Blob([new Uint8Array(result.value.bytes)], { type: result.value.mimeType }));
      const decoded = new Image(); decoded.src = url; await decoded.decode();
      if (!live) return;
      fullUrl.current = url; if (image.current && !decoding.current) image.current.src = url;
    }).catch(() => { if (live) onError('原图读取失败，缩略图仍可预览'); });
    return () => { live = false; fullUrl.current = ''; if (url) URL.revokeObjectURL(url); };
  }, [id, onError]);
  useEffect(() => {
    let cancelled = false, animation: Animation | undefined;
    const element = image.current!, p = state.presentation, { source, target, closing } = preview;
    async function animate() {
      const interrupted = getComputedStyle(element).transform;
      decoding.current = true;
      element.src = fullUrl.current || await thumbnail(id);
      try { await element.decode(); } catch { if (!cancelled) { onError('图片无法预览'); void window.snipvia.collection.closePreview(); } return; }
      if (cancelled) return;
      decoding.current = false;
      if (fullUrl.current) element.src = fullUrl.current;
      const result = await window.snipvia.collection.rendered(p);
      if (!result.ok || !result.value || cancelled) return;
      const start = `translate(${source.x}px,${source.y}px) scale(${source.width / target.width})`;
      const end = `translate(${target.x}px,${target.y}px) scale(1)`;
      animation = element.animate([{ transform: closing && interrupted !== 'none' ? interrupted : closing ? end : start }, { transform: closing ? start : end }],
        { duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : closing ? 240 : 340, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'forwards' });
      animation.onfinish = () => { if (!cancelled && closing) void window.snipvia.collection.previewFinished(p); };
    }
    void animate().catch(() => { if (!cancelled) { onError('预览未能打开'); void window.snipvia.collection.closePreview(); } });
    return () => { cancelled = true; try { animation?.commitStyles(); } catch { /* Already removed from the document. */ } animation?.cancel(); };
  }, [state.presentation]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') void window.snipvia.collection.closePreview(); };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, []);
  const { target } = preview;
  return <main className="shelf-preview-scene" data-shelf-hit aria-label="截图居中预览">
    <button className="shelf-preview-dismiss" aria-label="返回收纳区" onClick={() => { void window.snipvia.collection.closePreview(); }} />
    <img ref={image} onClick={() => { void window.snipvia.collection.closePreview(); }} alt="原图预览" className="shelf-center-image" style={{ width: target.width, height: target.height, transform: `translate(${target.x}px,${target.y}px)` }} />
    <WorkspaceHeader title="截图预览">
      <div className="shelf-preview-toolbar" style={{ top: Math.max(12, target.y - 40) }}>
        <ShelfActionButton className="shelf-small-action" label="复制当前截图" icon="copy" onError={onError} onAction={async () => { const r = await window.snipvia.collection.copy(id); if (!r.ok) throw new Error(r.error); }} />
        <button className="shelf-glass" aria-label="定住当前截图" title="定住当前截图" onClick={() => { void window.snipvia.collection.preview(id).then(r => { if (!r.ok) onError(r.error); else void window.snipvia.collection.closePreview(); }); }}><Icon name="pin" size={16} /></button>
        <button className="shelf-glass" aria-label="删除当前截图" title="删除当前截图" onClick={() => { void window.snipvia.collection.remove(id).then(r => { if (!r.ok) onError(r.error); }); }}><Icon name="trash" size={16} /></button>
        <button className="shelf-glass" aria-label="关闭原图预览" title="关闭" onClick={() => { void window.snipvia.collection.closePreview(); }}><Icon name="close" size={16} /></button>
      </div>
    </WorkspaceHeader>
  </main>;
}
