import { useEffect, useRef, useState } from 'react';
import type { Capture } from '../../../shared/contracts';

export function PinnedCapture() {
  const [capture, setCapture] = useState<Capture | null>(null);
  const [performanceSessionId, setPerformanceSessionId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const activeSessionId = useRef<string | null>(null);
  const aiCaptureId = useRef<string | null>(null);
  const chatActiveRef = useRef(false);
  const escapeCancelled = useRef(false);
  const copyInFlight = useRef(false);

  useEffect(() => {
    const reset = () => {
      // Clear focus when the reused window starts a new capture.
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      activeSessionId.current = null;
      aiCaptureId.current = null;
      setCapture(null);
      setPerformanceSessionId(null);
      copyInFlight.current = false;
      chatActiveRef.current = false;
      escapeCancelled.current = false;
      setError('');
    };
    const stopSession = window.snipvia.pin.onSession((state) => {
      const sessionId = state.performanceSessionId;
      activeSessionId.current = sessionId;
      aiCaptureId.current = state.localOnly ? null : state.capture.id;
      setPerformanceSessionId(sessionId);
      copyInFlight.current = false;
      chatActiveRef.current = state.chatActive;
      escapeCancelled.current = false;
      setError('');
      window.snipvia.performance.mark(sessionId, 'pin_image_load_start');
      setCapture(state.capture);
    });
    const stopReset = window.snipvia.pin.onResetSession(reset);
    const stopError = window.snipvia.capture.onError(setError);
    const stopChatState = window.snipvia.pin.onChatState((active) => {
      chatActiveRef.current = active;
    });
    const keyDown = (event: KeyboardEvent) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && !event.isComposing && !event.repeat &&
          aiCaptureId.current && !(event.target instanceof Element && event.target.closest('button'))) {
        event.preventDefault();
        void window.snipvia.autoAction.start(aiCaptureId.current).then((result) => { if (!result.ok) setError(result.error); }).catch(() => setError('无法开始分析，请重试'));
        return;
      }
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'c') {
        event.preventDefault();
        if (!copyInFlight.current) void copyAndClose();
        return;
      }
      if (event.key !== 'Escape') return;
      event.preventDefault();
      if (chatActiveRef.current && !escapeCancelled.current) {
        escapeCancelled.current = true;
        void window.snipvia.autoAction.cancel();
      } else void window.snipvia.pin.close();
    };
    window.addEventListener('keydown', keyDown);
    const initialSessionId = window.snipvia.performance.initialSessionId;
    if (initialSessionId) {
      window.snipvia.performance.mark(initialSessionId, 'react_mount', { page: 'pin' });
      window.snipvia.performance.mark(initialSessionId, 'page_component_mount', { page: 'pin' });
    }
    window.snipvia.window.ready('pin');
    return () => {
      stopSession();
      stopReset();
      stopError();
      stopChatState();
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
    <div className="pinned-image-area">
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
    {error && <div className="pinned-error" role="alert">{error}</div>}
  </div>;
}
