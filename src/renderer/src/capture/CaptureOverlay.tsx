import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ScreenshotEditor } from './editor/ScreenshotEditor';
import type { CaptureMode, Selection } from '../../../shared/contracts';

export function CaptureOverlay() {
  const [mode, setMode] = useState<CaptureMode>('ai');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState(false);
  const editingRef = useRef(false);
  const [frame, setFrame] = useState('');
  const [performanceSessionId, setPerformanceSessionId] = useState<string | null>(null);
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null);
  const [rect, setRect] = useState<Selection | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const activeSessionId = useRef<string | null>(null);
  const pendingSelection = useRef<{ sessionId: string; selection: Selection } | null>(null);
  const decodedSession = useRef<string | null>(null);
  const objectUrl = useRef<string | null>(null);
  const requestedFrameSessionId = useRef<string | null>(null);
  const shellReportedSessionId = useRef<string | null>(null);
  const resultFrameRafCount = useRef<1 | 2>(2);

  function afterAnimationFrames(count: 1 | 2, callback: () => void) {
    const next = (remaining: number) => requestAnimationFrame(() => {
      if (remaining <= 1) callback();
      else next(remaining - 1);
    });
    next(count);
  }

  useLayoutEffect(() => {
    const sessionId = performanceSessionId;
    if (!sessionId || shellReportedSessionId.current === sessionId) return;
    shellReportedSessionId.current = sessionId;
    void window.snipvia.capture.sessionShellRendered(sessionId).then((result) => {
      if (!result.ok || !result.value || activeSessionId.current !== sessionId) return;
      afterAnimationFrames(1, () => {
        if (activeSessionId.current === sessionId) window.snipvia.performance.mark(sessionId, 'capture_overlay_shell_visible');
      });
    });
  }, [performanceSessionId]);

  useEffect(() => {
    const reset = () => {
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      objectUrl.current = null;
      activeSessionId.current = null;
      requestedFrameSessionId.current = null;
      pendingSelection.current = null; decodedSession.current = null;
      setPerformanceSessionId(null);
      setFrame('');
      setOrigin(null);
      setRect(null);
      setError('');
      setBusy(false);
      setEditing(false); editingRef.current = false;
    };
    const requestFrame = (sessionId: string) => {
      if (requestedFrameSessionId.current === sessionId) return;
      requestedFrameSessionId.current = sessionId;
      window.snipvia.performance.mark(sessionId, 'capture_frame_request');
      void window.snipvia.capture.frame().then((result) => {
        if (activeSessionId.current !== sessionId) return;
        if (!result.ok) {
          setError(result.error);
          return;
        }
        if (result.value.performanceSessionId !== sessionId) return;
        resultFrameRafCount.current = result.value.visibilityRafCount;
        window.snipvia.performance.mark(sessionId, 'capture_frame_ipc_return', { transport: result.value.transport });
        window.snipvia.performance.mark(sessionId, 'frame_blob_create_start');
        let source: string;
        if ('dataUrl' in result.value) {
          source = result.value.dataUrl;
        } else {
          const copy = Uint8Array.from(result.value.bytes);
          source = URL.createObjectURL(new Blob([copy.buffer], { type: result.value.mimeType }));
          objectUrl.current = source;
        }
        window.snipvia.performance.mark(sessionId, 'frame_blob_create_end');
        window.snipvia.performance.mark(sessionId, 'frame_image_decode_start');
        setFrame(source);
      });
    };
    const stopSession = window.snipvia.capture.onSession(({ performanceSessionId: sessionId, frameReady, mode: captureMode, notice: membershipNotice }) => {
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      objectUrl.current = null;
      activeSessionId.current = sessionId;
      requestedFrameSessionId.current = null;
      pendingSelection.current = null; decodedSession.current = null;
      setPerformanceSessionId(sessionId);
      setMode(captureMode);
      setNotice(membershipNotice ?? '');
      setFrame('');
      setOrigin(null);
      setRect(null);
      setError('');
      setBusy(false);
      setEditing(false); editingRef.current = false;
      if (frameReady) requestFrame(sessionId);
    });
    const stopFrameReady = window.snipvia.capture.onFrameReady((sessionId) => {
      if (activeSessionId.current === sessionId) requestFrame(sessionId);
    });
    const stopReset = window.snipvia.capture.onResetSession(reset);
    const initialSessionId = window.snipvia.performance.initialSessionId;
    if (initialSessionId) {
      window.snipvia.performance.mark(initialSessionId, 'react_mount', { page: 'capture' });
      window.snipvia.performance.mark(initialSessionId, 'page_component_mount', { page: 'capture' });
    }
    window.snipvia.window.ready('capture');
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && !editingRef.current) void window.snipvia.capture.cancel(); };
    window.addEventListener('keydown', key);
    return () => {
      stopSession();
      stopFrameReady();
      stopReset();
      window.removeEventListener('keydown', key);
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    };
  }, []);

  function selection(x: number, y: number): Selection | null {
    if (!origin) return null;
    const boundedX = Math.max(0, Math.min(innerWidth, x));
    const boundedY = Math.max(0, Math.min(innerHeight, y));
    return { x: Math.min(origin.x, boundedX), y: Math.min(origin.y, boundedY), width: Math.abs(boundedX - origin.x), height: Math.abs(boundedY - origin.y) };
  }

  async function finishSelection(selected: Selection, sessionId: string) {
    if (activeSessionId.current !== sessionId) return;
    if (mode === 'standard') { setRect(selected); setBusy(false); setEditing(true); editingRef.current = true; return; }
    window.snipvia.performance.mark(sessionId, 'capture_finish_ipc_start');
    const result = await window.snipvia.capture.finish({ sessionId, selection: selected });
    if (!result.ok && activeSessionId.current === sessionId) { setError(result.error); setBusy(false); }
  }

  useEffect(() => {
    if (window.snipvia.platform !== 'win32') return;
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || event.repeat || busy || editing || origin || !performanceSessionId
        || decodedSession.current !== performanceSessionId) return;
      event.preventDefault();
      const selected = { x: 0, y: 0, width: innerWidth, height: innerHeight };
      setBusy(true); setRect(selected);
      window.snipvia.performance.mark(performanceSessionId, 'selection_end', { widthDip: selected.width, heightDip: selected.height });
      void finishSelection(selected, performanceSessionId);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [busy, editing, origin, performanceSessionId, mode]);

  return <div className="capture-overlay" data-performance-session={performanceSessionId ?? undefined}
    onPointerDown={(event) => {
      if (editing || busy || !performanceSessionId || event.button !== 0) return;
      if (performanceSessionId) window.snipvia.performance.mark(performanceSessionId, 'selection_start');
      event.currentTarget.setPointerCapture(event.pointerId);
      setOrigin({ x: event.clientX, y: event.clientY }); setRect(null); setError('');
    }}
    onPointerMove={(event) => { if (origin) setRect(selection(event.clientX, event.clientY)); }}
    onPointerUp={async (event) => {
      if (editing) return;
      const selected = selection(event.clientX, event.clientY);
      setOrigin(null);
      if (!selected || selected.width < 3 || selected.height < 3) { setRect(null); return; }
      setBusy(true);
      if (!performanceSessionId) { setError('截图性能会话已失效'); setBusy(false); return; }
      window.snipvia.performance.mark(performanceSessionId, 'selection_end', { widthDip: selected.width, heightDip: selected.height });
      setRect(selected);
      if (decodedSession.current !== performanceSessionId) {
        pendingSelection.current = { sessionId: performanceSessionId, selection: selected };
        return;
      }
      await finishSelection(selected, performanceSessionId);
    }}>
    {frame && <img src={frame} draggable={false} className="screen-frame" onLoad={async () => {
      const sessionId = performanceSessionId;
      if (!sessionId || activeSessionId.current !== sessionId) return;
      decodedSession.current = sessionId;
      window.snipvia.performance.mark(sessionId, 'frame_image_decode_end');
      window.snipvia.performance.mark(sessionId, 'capture_overlay_image_loaded');
      window.snipvia.performance.mark(sessionId, 'overlay_image_ready');
      const rendered = await window.snipvia.capture.sessionRendered(sessionId);
      if (!rendered.ok || !rendered.value || activeSessionId.current !== sessionId) return;
      const pending = pendingSelection.current;
      if (pending?.sessionId === sessionId) { pendingSelection.current = null; void finishSelection(pending.selection, sessionId); }
      afterAnimationFrames(resultFrameRafCount.current, () => {
        if (activeSessionId.current !== sessionId) return;
        window.snipvia.performance.mark(sessionId, 'capture_overlay_reuse_visible');
        window.snipvia.performance.mark(sessionId, 'capture_overlay_visible');
        void window.snipvia.capture.sessionVisible(sessionId);
      });
    }} />}
    <div className="capture-shade" />
    {notice && <div className="capture-membership-notice" role="status">{notice}</div>}
    {rect && !editing && <div className="selection" style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height, backgroundImage: frame ? `url(${frame})` : 'none', backgroundSize: `${innerWidth}px ${innerHeight}px`, backgroundPosition: `-${rect.x}px -${rect.y}px` }}><span>{Math.round(rect.width)} × {Math.round(rect.height)}</span></div>}
    {editing && rect && performanceSessionId && <ScreenshotEditor key={performanceSessionId} frame={frame} initialSelection={rect} sessionId={performanceSessionId} />}
    {!editing && <div className="capture-hint">{error || (busy ? '正在固定截图…' : frame ? mode === 'standard' ? `拖动选择截图区域 · 松开标注${window.snipvia.platform === 'win32' ? ' · Enter 全屏' : ''} · Esc 取消` : `拖动选择截图区域 · 松开完成${window.snipvia.platform === 'win32' ? ' · Enter 全屏' : ''} · Esc 取消` : '正在准备截图… · Esc 取消')}</div>}
  </div>;
}
