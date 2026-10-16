import { useEffect, useRef, type ReactNode } from 'react';

/** Native modal focus trapping, Escape handling and focus restoration. */
export function Dialog({ label, children, onClose, className = '' }: { label: string; children: ReactNode; onClose: () => void; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    dialog.querySelector<HTMLElement>('[data-initial-focus]')?.focus();
    return () => {
      dialog.close();
      // React removes the node before passive cleanup; native restoration alone is insufficient.
      if (previous?.isConnected && !dialog.contains(previous)) previous.focus({ preventScroll: true });
    };
  }, []);
  return <dialog ref={ref} className={`ui-dialog ${className}`} aria-label={label} onCancel={(event) => { event.preventDefault(); onClose(); }} onClick={(event) => {
    if (event.target !== event.currentTarget) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
  }}>{children}</dialog>;
}
