import { useEffect, useRef } from 'react';

type Size = { width: number; height: number };

/** Explicit resize affordance for transparent, frameless screenshot conversations. */
export function ChatResizeHandle({ expanded, onError }: { expanded: boolean; onError(message: string): void }) {
  const drag = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const pending = useRef<Size | null>(null);
  const frame = useRef(0);
  const active = useRef(true);
  const sending = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; cancelAnimationFrame(frame.current); }; }, []);

  function queue(size: Size) {
    pending.current = { width: Math.min(10000, Math.max(1, Math.round(size.width))), height: Math.min(10000, Math.max(1, Math.round(size.height))) };
    if (!frame.current && !sending.current) frame.current = requestAnimationFrame(() => { frame.current = 0; void flush(); });
  }
  async function flush() {
    const size = pending.current;
    if (!active.current || !size || sending.current) return;
    pending.current = null; sending.current = true;
    try {
      const result = await window.snipvia.chat.resize(size);
      if (!result.ok && active.current) onError(result.error);
    } catch { if (active.current) onError('调整对话框大小失败，请重试'); }
    finally {
      sending.current = false;
      if (active.current && pending.current) queue(pending.current);
    }
  }
  return <button type="button" className="chat-resize-handle" aria-label="调整对话框大小" title="拖动调整大小；方向键微调，Home 恢复默认"
    onPointerDown={event => {
      if (event.button !== 0) return;
      event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { x: event.screenX, y: event.screenY, width: window.outerWidth, height: window.outerHeight };
    }}
    onPointerMove={event => {
      const start = drag.current;
      if (start) queue({ width: start.width + event.screenX - start.x, height: start.height + event.screenY - start.y });
    }}
    onPointerUp={event => { drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
    onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}
    onKeyDown={event => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      const step = event.shiftKey ? 50 : 20;
      queue(event.key === 'Home' ? expanded ? { width: 1000, height: 680 } : { width: 440, height: 400 }
        : { width: window.outerWidth + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0), height: window.outerHeight + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0) });
    }}>
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M4 11 11 4M8 11l3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
  </button>;
}
