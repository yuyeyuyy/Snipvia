import { useEffect, useRef, useState } from 'react';
import type { QuickTargetState } from '../../../shared/quick-target';
import { Icon } from '../components/Icon';
import { QuickTargetIcon } from '../components/QuickTargetIcon';
import { WorkspaceHeader } from '../components/WorkspaceHeader';
import './quick-target.css';

export function QuickTargetBar() {
  const [state, setState] = useState<QuickTargetState | null>(null);
  const panel = useRef<HTMLElement>(null), hovered = useRef(false), focused = useRef(false);
  useEffect(() => {
    let live = true;
    const off = window.snipvia.quickTarget.onChanged(value => { if (live) setState(value); });
    void window.snipvia.quickTarget.current().then(result => { if (live && result.ok) setState(result.value); });
    window.snipvia.window.ready('quick-target');
    return () => { live = false; off(); };
  }, []);
  useEffect(() => {
    if (!state?.visible) { hovered.current = false; focused.current = false; return; }
    let cancelled = false;
    const presentationId = state.presentationId;
    const images = [...(panel.current?.querySelectorAll('img') ?? [])];
    // Avoid an empty icon frame; a missing icon uses the existing local fallback.
    void Promise.all(images.map(image => image.decode().catch(() => {}))).then(async () => {
      if (cancelled) return;
      const result = await window.snipvia.quickTarget.rendered({ presentationId });
      if (!cancelled && result.ok && result.value && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        panel.current?.animate([{ transform: 'translateY(-4px)', opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }], { duration: 160, easing: 'cubic-bezier(.22,1,.36,1)' });
      }
    });
    return () => { cancelled = true; };
  }, [state?.presentationId, state?.visible]);
  useEffect(() => {
    if (!state?.visible) return;
    const presentationId = state.presentationId;
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); void window.snipvia.quickTarget.dismiss({ presentationId }); } };
    const focus = () => { panel.current?.querySelector<HTMLButtonElement>('.quick-target-item')?.focus(); };
    window.addEventListener('keydown', key); window.addEventListener('focus', focus);
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('focus', focus); };
  }, [state?.visible, state?.presentationId]);
  if (!state?.visible) return <main className="quick-target-window" />;
  const presentationId = state.presentationId;
  const interact = () => { void window.snipvia.quickTarget.interaction({ presentationId, active: hovered.current || focused.current }); };
  return <main className="quick-target-window">
    <section className="quick-target-surface" ref={panel} aria-label="截图后快速切换"
      onPointerEnter={() => { hovered.current = true; interact(); }} onPointerLeave={() => { hovered.current = false; interact(); }}
      onFocusCapture={() => { focused.current = true; interact(); }} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) { focused.current = false; interact(); } }}
      onKeyDown={event => {
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
          const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('.quick-target-item, .quick-target-choice')];
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1) + buttons.length) % buttons.length;
          event.preventDefault(); buttons[next]?.focus();
        }
      }}>
      <WorkspaceHeader title="截图后快速切换"><button className="quick-target-close" type="button" aria-label="关闭快速切换" title="关闭；图片仍在剪贴板中" onClick={() => { void window.snipvia.quickTarget.dismiss({ presentationId }); }}><Icon name="close" size={13} /></button></WorkspaceHeader>
      <p className="quick-target-caption" role="status">{state.busy ? '正在切换…' : state.targets.length < 4 ? '图片已复制' : '图片已复制 · 选择目标'}</p>
      <div className="quick-target-bar" role="toolbar" aria-label="选择应用或网页">
        {state.targets.map(target => <button className="quick-target-item" type="button" key={target.id} disabled={state.busy} aria-label={target.detail + '：' + target.label} title={target.detail + ' · ' + target.label}
          onClick={() => { void window.snipvia.quickTarget.activate({ presentationId, targetId: target.id }); }}>
          <span className="quick-target-icon"><QuickTargetIcon target={target} /></span>
          <span className="quick-target-label">{target.label}</span>
        </button>)}
      </div>
      {state.notice && <p className="quick-target-notice" role="status">{state.notice}</p>}
      {state.choices && state.choiceTargetId && <div className="quick-target-choices" role="group" aria-label="选择 Chrome 标签">
        {state.choices.map(choice => <button type="button" className="quick-target-choice" key={choice.id} disabled={state.busy} onClick={() => { void window.snipvia.quickTarget.activate({ presentationId, targetId: state.choiceTargetId!, choiceId: choice.id }); }}><strong>{choice.title}</strong><span>{choice.detail}</span></button>)}
      </div>}
      {state.error && <p className="quick-target-error" role="alert">{state.error}</p>}
    </section>
  </main>;
}
