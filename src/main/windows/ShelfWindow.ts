import { BrowserWindow, screen, type Rectangle, type WebPreferences } from 'electron';
import type { ShelfState, CollectionSnapshot } from '../../shared/collection';
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
  constructor(private readonly preferences: WebPreferences, private readonly load: (window: BrowserWindow, hash: string) => Promise<void>, private readonly snapshot: () => CollectionSnapshot) {}
  peekWindow() { return this.window && !this.window.isDestroyed() ? this.window : null; }
  current(): ShelfState { return { collection: this.snapshot(), hidden: this.hidden, expanded: this.expanded, performanceSessionId: this.performanceSessionId }; }
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
  suspend() { this.suspended = true; this.epoch++; this.peekWindow()?.hide(); }
  resume() { this.suspended = false; if (!this.hidden && this.snapshot().count) void this.present(false); }
  collected(area: Rectangle, sessionId: string) {
    this.area = area; this.performanceSessionId = sessionId; this.suspended = false; this.publish();
    if (!this.hidden) void this.present(false);
  }
  async toggle() {
    this.performanceSessionId = screenshotPerformance.startSession({ trigger: 'shelf-expand' });
    screenshotPerformance.mark(this.performanceSessionId, 'shelf_expand_start');
    this.hidden = false; this.expanded = !this.expanded || !this.peekWindow()?.isVisible();
    await this.present(true);
  }
  collapse() { this.expanded = false; void this.present(false); }
  hide() { this.hidden = true; this.expanded = false; this.epoch++; this.peekWindow()?.hide(); this.publish(); }
  private async present(focus: boolean) {
    const epoch = ++this.epoch;
    await this.prepare();
    const window = this.peekWindow();
    if (!window || epoch !== this.epoch || this.hidden || this.suspended) return;
    const area = this.area ?? screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    window.setBounds(shelfBounds(area, this.expanded)); this.publish();
    if (focus) { window.show(); window.focus(); } else window.showInactive();
  }
  destroy() { this.epoch++; this.peekWindow()?.destroy(); this.window = null; this.ready = null; }
}
