import type { QuickTargetArea, QuickTargetPreferences, QuickTargetState, QuickTargetView, QuickTarget, QuickTargetActivation } from '../../shared/quick-target';

/** Coordinates only post-commit UI. Selection sessions and clipboard writes keep their own lifetime. */
export class QuickTargetService {
  private latestOutput: string | null = null;
  private state: QuickTargetState = { presentationId: 0, visible: false, busy: false, error: '', targets: [] };
  private marker: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private watch: ReturnType<typeof setTimeout> | null = null;
  private controller: AbortController | null = null;
  private deadline = 0;
  private remaining = 0;
  private interacting = false;
  private handoffUntil = 0;
  constructor(private readonly options: {
    preferences(): QuickTargetPreferences;
    views(): QuickTargetView[];
    clipboardMatches(marker: string): Promise<boolean>;
    ready(): boolean;
    present(state: QuickTargetState, area: QuickTargetArea): void;
    update(state: QuickTargetState): void;
    hide(forCapture: boolean): void;
    activate(target: QuickTarget, launch: boolean, signal: AbortSignal, presentation: number, choiceId?: string): Promise<QuickTargetActivation | void>;
  }) {}
  current() { return structuredClone(this.state); }
  updateArtwork(targets: QuickTargetView[]) {
    if (!this.state.visible) return;
    const views = new Map(targets.map(target => [target.id, target]));
    this.state.targets = this.state.targets.map(target => views.get(target.id) ?? target);
    this.options.update(this.current());
  }
  beginCapture(id: string) { this.latestOutput = id; this.dismiss(true); }
  beginCopy(id: string) { this.latestOutput = id; this.dismiss(); }
  enabled() { const value = this.options.preferences(); return value.enabled && value.targets.length > 0; }
  protectsActivation() { return !!this.controller || performance.now() < this.handoffUntil; }
  copied(id: string, marker: string, area: QuickTargetArea) {
    // Never return a promise into the successful output job; this UI may fail independently.
    const presentation = this.state.presentationId;
    setImmediate(() => { void this.offer(id, marker, area, presentation).catch(() => { if (presentation === this.state.presentationId) this.dismiss(); }); });
  }
  private async offer(id: string, marker: string, area: QuickTargetArea, presentation: number) {
    if (id !== this.latestOutput || presentation !== this.state.presentationId || !this.enabled() || !this.options.ready()) return;
    if (!await this.options.clipboardMatches(marker)) return;
    if (id !== this.latestOutput || presentation !== this.state.presentationId || !this.enabled() || !this.options.ready()) return;
    this.marker = marker;
    this.state = { presentationId: presentation + 1, visible: true, busy: false, error: '', targets: this.options.views() };
    this.remaining = this.options.preferences().durationMs;
    try { this.options.present(this.current(), area); } catch { this.dismiss(); return; }
    this.armTimer(); this.watchClipboard(this.state.presentationId);
  }
  interaction(presentation: number, active: boolean) {
    this.requireActive(presentation);
    if (this.interacting === active) return;
    this.interacting = active;
    if (active) { this.remaining = Math.max(0, this.deadline - performance.now()); this.clearTimer(); }
    else if (!this.state.busy) this.armTimer();
  }
  async activate(presentation: number, targetId: string, choiceId?: string) {
    this.requireActive(presentation);
    if (this.state.busy) throw new Error('正在切换，请稍候');
    const target = this.options.preferences().targets.find(item => item.id === targetId);
    if (!target) throw new Error('目标已移除');
    if (choiceId && (this.state.choiceTargetId !== targetId || !this.state.choices?.some(choice => choice.id === choiceId))) throw new Error('标签选择已过期，请重新选择目标');
    const controller = new AbortController(); this.controller = controller;
    const timeout = setTimeout(() => controller.abort(new Error('切换超时，请手动打开目标；截图仍在剪贴板中')), 5000);
    this.clearTimer(); this.state.busy = true; this.state.error = ''; this.state.notice = '';
    if (!choiceId) { this.state.choices = undefined; this.state.choiceTargetId = undefined; }
    this.options.update(this.current());
    try {
      if (!this.marker || !await this.options.clipboardMatches(this.marker)) { this.dismiss(); throw new Error('剪贴板已变化，请重新截图'); }
      controller.signal.throwIfAborted(); this.requireActive(presentation);
      const result = await this.options.activate(target, this.options.preferences().launchApplications, controller.signal, presentation, choiceId);
      controller.signal.throwIfAborted();
      if (presentation === this.state.presentationId) {
        // Composer focus is optional. A completed switch closes quietly either way.
        if (!result || result.kind === 'done' || result.kind === 'manual') this.dismiss();
        else {
          this.state.busy = false;
          this.state.choices = result.choices;
          this.state.choiceTargetId = targetId;
          this.state.notice = '选择要切换的标签';
          this.options.update(this.current()); this.remaining = this.options.preferences().durationMs; if (!this.interacting) this.armTimer();
        }
      }
    } catch (error) {
      if (presentation === this.state.presentationId && this.state.visible) {
        this.state.busy = false; this.state.error = error instanceof Error ? error.message : '切换失败，请手动打开目标';
        this.options.update(this.current()); this.remaining = this.options.preferences().durationMs; if (!this.interacting) this.armTimer();
      }
      throw error;
    } finally {
      clearTimeout(timeout); this.handoffUntil = performance.now() + 500;
      if (this.controller === controller) this.controller = null;
    }
  }
  dismiss(forCapture = false) {
    this.controller?.abort(new Error('快速切换已取消')); this.controller = null;
    this.clearTimer(); if (this.watch) clearTimeout(this.watch); this.watch = null;
    this.interacting = false; this.marker = null;
    this.state = { presentationId: this.state.presentationId + 1, visible: false, busy: false, error: '', targets: [] };
    this.options.hide(forCapture); this.options.update(this.current());
  }
  dismissPresentation(presentation: number) { this.requireActive(presentation); this.handoffUntil = performance.now() + 300; this.dismiss(); }
  dispose() { this.latestOutput = null; this.dismiss(); }
  private requireActive(presentation: number) { if (!this.state.visible || presentation !== this.state.presentationId) throw new Error('快速切换已过期'); }
  private clearTimer() { if (this.timer) clearTimeout(this.timer); this.timer = null; }
  private armTimer() { this.clearTimer(); this.deadline = performance.now() + this.remaining; this.timer = setTimeout(() => this.dismiss(), this.remaining); }
  private watchClipboard(presentation: number) {
    this.watch = setTimeout(() => {
      void (async () => {
        if (presentation !== this.state.presentationId || !this.marker) return;
        const matches = await this.options.clipboardMatches(this.marker);
        if (presentation !== this.state.presentationId) return;
        if (!matches) this.dismiss(); else this.watchClipboard(presentation);
      })().catch(() => { if (presentation === this.state.presentationId) this.dismiss(); });
    }, 750);
  }
}
