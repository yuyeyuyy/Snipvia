import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Icon } from '../components/Icon';
import type { ScreenshotPreview } from '../../../shared/screenshot';

export function PinnedCapture() {
  const [capture, setCapture] = useState<ScreenshotPreview | null>(null);
  const [performanceSessionId, setPerformanceSessionId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const activeSessionId = useRef<string | null>(null);
  const copyInFlight = useRef(false);
  const closeInFlight = useRef(false);
  const drag = useRef<{ pointerId: number; sessionId: string; screenX: number; screenY: number; x: number; y: number } | null>(null);
  const dragged = useRef(false), ignoreDoubleClick = useRef(false);
  const moveFrame = useRef(0);
  const pendingMove = useRef<{ sessionId: string; x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  function stopDrag() {
    drag.current = null; pendingMove.current = null;
    cancelAnimationFrame(moveFrame.current); moveFrame.current = 0;
    setDragging(false);
  }
  function resetInteraction() {
    stopDrag(); dragged.current = false; ignoreDoubleClick.current = false; closeInFlight.current = false;
  }
  function flushMove() {
    moveFrame.current = 0;
    const value = pendingMove.current; pendingMove.current = null;
    if (!value || value.sessionId !== activeSessionId.current) return;
    void window.snipvia.pin.move(value).then(result => {
      if (!result.ok && activeSessionId.current === value.sessionId) { setError(result.error); stopDrag(); }
    }).catch(() => { if (activeSessionId.current === value.sessionId) stopDrag(); });
  }
  function moveImage(event: ReactPointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (!current || event.pointerId !== current.pointerId) return;
    const dx = event.screenX - current.screenX, dy = event.screenY - current.screenY;
    if (!dragged.current && Math.hypot(dx, dy) < 4) return;
    dragged.current = true; ignoreDoubleClick.current = true; setDragging(true);
    pendingMove.current = { sessionId: current.sessionId, x: current.x + dx, y: current.y + dy };
    if (!moveFrame.current) moveFrame.current = requestAnimationFrame(flushMove);
  }
  async function closePin() {
    const sessionId = activeSessionId.current;
    if (!sessionId || closeInFlight.current) return;
    closeInFlight.current = true; stopDrag();
    try {
      const result = await window.snipvia.pin.close();
      if (!result.ok && activeSessionId.current === sessionId) { setError(result.error); closeInFlight.current = false; }
    } catch { if (activeSessionId.current === sessionId) closeInFlight.current = false; }
  }

  useEffect(() => {
    const reset = () => {
      // Clear focus when the reused window starts a new capture.
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      resetInteraction();
      activeSessionId.current = null;
      setCapture(null);
      setPerformanceSessionId(null);
      copyInFlight.current = false;
      setError('');
    };
    const stopSession = window.snipvia.pin.onSession((state) => {
      resetInteraction();
      const sessionId = state.performanceSessionId;
      activeSessionId.current = sessionId;
      setPerformanceSessionId(sessionId);
      copyInFlight.current = false;
      setError('');
      window.snipvia.performance.mark(sessionId, 'pin_image_load_start');
      setCapture(state.capture);
    });
    const stopReset = window.snipvia.pin.onResetSession(reset);
    const stopError = window.snipvia.capture.onError(setError);
    const keyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'c') {
        event.preventDefault();
        if (!copyInFlight.current) void copyAndClose();
        return;
      }
      if (event.key !== 'Escape') return;
      event.preventDefault();
      void closePin();
    };
    window.addEventListener('keydown', keyDown);
    const initialSessionId = window.snipvia.performance.initialSessionId;
    if (initialSessionId) {
      window.snipvia.performance.mark(initialSessionId, 'react_mount', { page: 'pin' });
      window.snipvia.performance.mark(initialSessionId, 'page_component_mount', { page: 'pin' });
    }
    window.snipvia.window.ready('pin');
    return () => {
      cancelAnimationFrame(moveFrame.current);
      stopSession();
      stopReset();
      stopError();
      window.removeEventListener('keydown', keyDown);
    };
  }, []);

  async function copyAndClose() {
    if (copyInFlight.current) return;
    copyInFlight.current = true;
    setError('');
    const result = await window.snipvia.pin.copy();
    if (!result.ok) {
      setError(result.error);
      copyInFlight.current = false;
    }
  }

  return <div className="pinned-capture">
    <div className="pinned-image-area" title="拖动移动 · 双击关闭钉图" data-dragging={dragging}
      onPointerDown={event => {
        const sessionId = activeSessionId.current;
        if (event.button !== 0 || !sessionId || closeInFlight.current) return;
        dragged.current = false;
        drag.current = { pointerId: event.pointerId, sessionId, screenX: event.screenX, screenY: event.screenY, x: window.screenX, y: window.screenY };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={moveImage}
      onPointerUp={event => {
        if (drag.current?.pointerId !== event.pointerId) return;
        moveImage(event);
        cancelAnimationFrame(moveFrame.current); flushMove(); stopDrag();
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={stopDrag}
      onLostPointerCapture={stopDrag}
      onClick={event => { if (event.detail === 1 && !dragged.current) ignoreDoubleClick.current = false; }}
      onDoubleClick={event => {
        if (event.button !== 0 || dragged.current || ignoreDoubleClick.current) return;
        event.preventDefault(); void closePin();
      }}>
      {capture && <img key={capture.id} src={capture.dataUrl} alt="置顶截图" draggable={false} onLoad={async () => {
        const sessionId = performanceSessionId;
        if (!sessionId || activeSessionId.current !== sessionId) return;
        window.snipvia.performance.mark(sessionId, 'pin_image_load_end');
        const rendered = await window.snipvia.pin.sessionRendered(sessionId);
        if (!rendered.ok || !rendered.value || activeSessionId.current !== sessionId) return;
        requestAnimationFrame(() => requestAnimationFrame(() => {
          if (activeSessionId.current !== sessionId) return;
          window.snipvia.performance.mark(sessionId, 'screenshot_window_reuse_visible');
          window.snipvia.performance.mark(sessionId, 'screenshot_to_all_visible');
          void window.snipvia.pin.sessionVisible(sessionId);
        }));
      }} />}
      {!capture && !error && <div className="pinned-loading">正在固定截图…</div>}
    </div>
    {capture && <div className="pinned-actions">
      <button type="button" aria-label="复制并关闭钉图" title="复制并关闭（⌘/Ctrl+C）" onClick={() => { void copyAndClose(); }}><Icon name="copy" size={16} /></button>
      <button type="button" aria-label="关闭钉图" title="关闭（Esc）" onClick={() => { void closePin(); }}><Icon name="close" size={16} /></button>
    </div>}
    {error && <div className="pinned-error" role="alert">{error}</div>}
  </div>;
}
