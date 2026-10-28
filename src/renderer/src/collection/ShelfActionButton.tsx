import { useEffect, useRef, useState } from 'react';
import { Icon, type IconName } from '../components/Icon';

type Props = {
  label: string;
  icon: IconName;
  className?: string;
  disabled?: boolean;
  onAction(): Promise<boolean | void>;
  onError(message: string): void;
};

/** Success belongs to this button; cancellation and failure never show a check. */
export function ShelfActionButton({ label, icon, className = '', disabled, onAction, onError }: Props) {
  const [status, setStatus] = useState<'idle' | 'pending' | 'success'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(false), busy = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; if (timer.current) clearTimeout(timer.current); };
  }, []);
  async function run() {
    if (disabled || busy.current) return;
    busy.current = true;
    if (timer.current) clearTimeout(timer.current);
    setStatus('pending');
    try {
      const completed = await onAction();
      if (!mounted.current) return;
      if (completed === false) { setStatus('idle'); return; }
      setStatus('success');
      timer.current = setTimeout(() => { timer.current = null; if (mounted.current) setStatus('idle'); }, 1000);
    } catch (error) {
      if (mounted.current) { setStatus('idle'); onError(error instanceof Error ? error.message : '操作失败，原图已保留'); }
    } finally { busy.current = false; }
  }
  return <button className={'shelf-glass ' + className} aria-label={label} title={label} data-action-state={status}
    aria-busy={status === 'pending'} disabled={disabled || status === 'pending'} onClick={() => { void run(); }}>
    <Icon name={status === 'success' ? 'check' : icon} />
  </button>;
}
