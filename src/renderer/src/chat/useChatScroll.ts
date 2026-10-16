import { useLayoutEffect, useRef, useState } from 'react';

export function useChatScroll({ id, loading, position, follow, count, sequence, onPosition }: {
  id: string | null; loading: boolean; position?: number; follow?: boolean; count: number; sequence?: number;
  onPosition(scroll: number, follow: boolean): void;
}) {
  const scroll = useRef<HTMLDivElement>(null), content = useRef<HTMLDivElement>(null);
  const following = useRef(follow !== false), programmatic = useRef<number | null>(null);
  const callback = useRef(onPosition); callback.current = onPosition;
  const [showJump, setShowJump] = useState(false);
  function bottom() { if (scroll.current) { programmatic.current = scroll.current.scrollHeight - scroll.current.clientHeight; scroll.current.scrollTop = scroll.current.scrollHeight; } }
  useLayoutEffect(() => { following.current = follow !== false; }, [follow]);
  useLayoutEffect(() => {
    const node = scroll.current; if (!node || loading) return;
    following.current = follow !== false; setShowJump(!following.current);
    const target = position ?? node.scrollHeight; programmatic.current = Math.max(0, Math.min(target, node.scrollHeight - node.clientHeight)); node.scrollTop = target;
  }, [id, loading]);
  useLayoutEffect(() => { if (following.current && !loading) bottom(); }, [count, sequence, loading]);
  useLayoutEffect(() => {
    const node = scroll.current, body = content.current; if (!node || !body) return;
    let frame = 0;
    const observer = new ResizeObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => { if (following.current) bottom(); }); });
    observer.observe(node); observer.observe(body);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, []);
  return { scroll, content, showJump, onScroll() {
    const node = scroll.current; if (!node) return;
    if (programmatic.current !== null && Math.abs(node.scrollTop - programmatic.current) < 2) { programmatic.current = null; return; }
    programmatic.current = null; const near = node.scrollHeight - node.scrollTop - node.clientHeight < 60;
    following.current = near; setShowJump(!near); callback.current(node.scrollTop, near);
  }, jump() { following.current = true; setShowJump(false); bottom(); if (scroll.current) callback.current(scroll.current.scrollTop, true); } };
}
