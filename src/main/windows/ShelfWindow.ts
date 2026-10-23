import { BrowserWindow, screen, type Rectangle, type WebPreferences } from 'electron';
import type { ShelfState, ShelfFeedback, CollectionSnapshot } from '../../shared/collection';
import { shelfBounds } from '../../shared/collection';
import { screenshotPerformance } from '../performance/screenshot-performance';

export class ShelfWindow {
  private window: BrowserWindow | null = null;
  private ready: Promise<void> | null = null;
  private resolveReady: (() => void) | null = null;
  private expanded = false;
  private hidden = false;
  private suspended = false;
  private area: Rectangle | null = null;
  private epoch = 0;
  private performanceSessionId?: string;
  private presentation = 0;
  private pendingFocus: boolean | null = null;
  private feedback?: ShelfFeedback;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private reducedMotion = true;
  constructor(private readonly preferences: WebPreferences, private readonly load: (window: BrowserWindow, hash: string) => Promise<void>, private readonly snapshot: () => CollectionSnapshot, private readonly thumbnail: (id: string) => string) {}
  peekWindow() { return this.window && !this.window.isDestroyed() ? this.window : null; }
  current(): ShelfState { return { presentation: this.presentation, feedback: this.feedback, collection: this.snapshot(), hidden: this.hidden, expanded: this.expanded, performanceSessionId: this.performanceSessionId }; }
  async prepare() {
    if (this.ready) return this.ready;
    this.ready = new Promise<void>(resolve => { this.resolveReady = resolve; });
    const area = this.area ?? screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    const window = new BrowserWindow({ ...shelfBounds(area, false), frame: false, show: false, transparent: true, backgroundColor: '#00000000', resizable: false, movable: false, alwaysOnTop: true, skipTaskbar: true, hasShadow: false, fullscreenable: false, webPreferences: this.preferences });
    this.window = window;
    if (process.platform === 'darwin') window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    window.on('close', event => { event.preventDefault(); this.hide(); });
    window.webContents.on('render-process-gone', () => { this.hide(); window.destroy(); this.window = null; this.ready = null; this.resolveReady?.(); this.resolveReady = null; });
    void this.load(window, 'shelf').catch(() => { this.resolveReady?.(); this.resolveReady = null; this.ready = null; window.destroy(); this.window = null; });
    return this.ready;
  }
  markReady() { this.resolveReady?.(); this.resolveReady = null; this.publish(); }
  publish() { this.peekWindow()?.webContents.send('collection:changed', this.current()); }
  suspend() { this.suspended = true; this.cancelFeedback(); this.epoch++; this.pendingFocus = null; this.peekWindow()?.setIgnoreMouseEvents(false); this.peekWindow()?.hide(); }
  resume() { this.suspended = false; if (!this.hidden && this.snapshot().count) void this.present(false); }
  collected(display: { bounds: Rectangle; workArea: Rectangle }, selection: Rectangle, id: string, sessionId: string) {
    this.area = display.workArea; this.performanceSessionId = sessionId; this.suspended = false;
    void this.showFeedback(display, selection, id);
  }
  private async showFeedback(display: { bounds: Rectangle; workArea: Rectangle }, selection: Rectangle, id: string) {
    this.cancelFeedback();
    const epoch = ++this.epoch;
    await this.prepare();
    const window = this.peekWindow();
    if (!window || epoch !== this.epoch || this.suspended) return;
    window.hide(); window.setIgnoreMouseEvents(true);
    const target = shelfBounds(display.workArea, false);
    if (this.hidden || this.reducedMotion) {
      this.feedback = { kind: 'count', duration: this.reducedMotion ? 550 : 800 };
      window.setBounds(target);
    } else {
      let thumbnail: string;
      try { thumbnail = this.thumbnail(id); } catch { this.resume(); return; }
      this.feedback = { kind: 'fly', duration: 220, thumbnail, source: selection,
        target: { x: target.x - display.bounds.x, y: target.y - display.bounds.y, width: target.width, height: target.height } };
      window.setBounds(display.bounds);
    }
    this.pendingFocus = false; this.presentation++; this.publish();
    // Watchdog: never leave a screen-sized window alive if Renderer cannot acknowledge.
    this.timer = setTimeout(() => this.finishFeedback(), 1500);
  }
  rendered(presentation: number) {
    const window = this.peekWindow();
    if (!window || this.suspended || presentation !== this.presentation || this.pendingFocus === null) return false;
    const focus = this.pendingFocus; this.pendingFocus = null;
    if (focus) { window.show(); window.focus(); } else window.showInactive();
    if (this.feedback) {
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => this.finishFeedback(), this.feedback.duration + 40);
    }
    return true;
  }
  setReducedMotion(value: boolean) { this.reducedMotion = value; if (value && this.feedback?.kind === 'fly') this.finishFeedback(); }
  private cancelFeedback() { if (this.timer) clearTimeout(this.timer); this.timer = null; this.feedback = undefined; }
  private finishFeedback() {
    this.cancelFeedback(); this.peekWindow()?.hide(); this.peekWindow()?.setIgnoreMouseEvents(false);
    if (!this.hidden && !this.suspended) void this.present(false); else this.publish();
  }
  async toggle() {
    this.performanceSessionId = screenshotPerformance.startSession({ trigger: 'shelf-expand' });
    screenshotPerformance.mark(this.performanceSessionId, 'shelf_expand_start');
    this.cancelFeedback(); this.peekWindow()?.setIgnoreMouseEvents(false);
    this.hidden = false; this.expanded = !this.expanded || !this.peekWindow()?.isVisible();
    await this.present(true);
  }
  collapse() { this.expanded = false; void this.present(false); }
  hide() { this.cancelFeedback(); this.pendingFocus = null; this.peekWindow()?.setIgnoreMouseEvents(false); this.hidden = true; this.expanded = false; this.epoch++; this.peekWindow()?.hide(); this.publish(); }
  private async present(focus: boolean) {
    const epoch = ++this.epoch;
    await this.prepare();
    const window = this.peekWindow();
    if (!window || epoch !== this.epoch || this.hidden || this.suspended) return;
    const area = this.area ?? screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    window.setIgnoreMouseEvents(false);
    window.setBounds(shelfBounds(area, this.expanded)); this.pendingFocus = focus; this.presentation++; this.publish();
  }
  destroy() { this.cancelFeedback(); this.epoch++; this.peekWindow()?.destroy(); this.window = null; this.ready = null; }
}
