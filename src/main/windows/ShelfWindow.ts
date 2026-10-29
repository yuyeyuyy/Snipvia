import { BrowserWindow, screen, type Rectangle, type WebPreferences } from 'electron';
import type { ShelfState, ShelfFeedback, CollectionSnapshot, ShelfPreview, ShelfEdge } from '../../shared/collection';
import { shelfWindowBounds, shelfDockBounds, shelfPreviewTarget, shelfCardRect, shelfContentTop, type ShelfRect } from '../../shared/collection';
import { defaultShelfSize, defaultShelfPreferences, type ShelfSize, type ShelfPreferences } from '../../shared/shelf-preferences';
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
  private hitRegions: ShelfRect[] = [];
  private hitTimer: ReturnType<typeof setInterval> | null = null;
  private ignoring = false;
  private pointerInteraction = false;
  private wide = false;
  private edge: ShelfEdge = 'shown';
  private edgeTimer: ReturnType<typeof setTimeout> | null = null;
  private previewTimer: ReturnType<typeof setTimeout> | null = null;
  private preview?: ShelfPreview;
  private lastInside = performance.now();
  constructor(private readonly preferences: WebPreferences, private readonly load: (window: BrowserWindow, hash: string) => Promise<void>, private readonly snapshot: () => CollectionSnapshot, private readonly thumbnail: (id: string) => string, private size: ShelfSize = { ...defaultShelfSize }, private configuration: ShelfPreferences = { ...defaultShelfPreferences, ...size }) {}
  private hideWindow() { const window = this.peekWindow(); if (window?.isVisible()) window.hide(); }
  peekWindow() { return this.window && !this.window.isDestroyed() ? this.window : null; }
  private workArea() { return this.area ?? screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea; }
  private restingBounds() { return shelfWindowBounds(this.workArea(), this.size, this.snapshot().items, this.expanded, this.wide, this.configuration.heightMode); }
  private activeBounds() {
    if (this.edge !== 'docked') return this.restingBounds();
    // The handle belongs to the resting stack, not the expanded browsing viewport.
    const area = this.workArea();
    return shelfDockBounds(area, shelfWindowBounds(area, this.size, this.snapshot().items, false, this.wide, this.configuration.heightMode));
  }
  current(): ShelfState {
    const bounds = this.peekWindow()?.getBounds() ?? this.activeBounds();
    return { size: { ...this.size }, preferences: { ...this.configuration, ...this.size }, edge: this.edge, wide: this.wide,
      preview: this.preview ? { ...this.preview, source: { ...this.preview.source }, target: { ...this.preview.target } } : undefined,
      viewport: { width: bounds.width, height: bounds.height }, presentation: this.presentation, feedback: this.feedback, collection: this.snapshot(),
      hidden: this.hidden, suspended: this.suspended, expanded: this.expanded, performanceSessionId: this.performanceSessionId };
  }
  async prepare() {
    if (this.ready) return this.ready;
    this.ready = new Promise<void>(resolve => { this.resolveReady = resolve; });
    const area = this.area ?? screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    const window = new BrowserWindow({ ...shelfWindowBounds(area, this.size, this.snapshot().items, this.expanded, this.wide, this.configuration.heightMode), frame: false, show: false, focusable: false, transparent: true, acceptFirstMouse: true, backgroundColor: '#00000000', resizable: false, movable: false, alwaysOnTop: true, skipTaskbar: true, hasShadow: false, fullscreenable: false, webPreferences: { ...this.preferences, backgroundThrottling: false } });
    this.window = window;
    if (process.platform === 'darwin') window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    window.on('close', event => { event.preventDefault(); this.hide(); });
    window.webContents.on('render-process-gone', () => { this.hide(); window.destroy(); this.window = null; this.ready = null; this.resolveReady?.(); this.resolveReady = null; });
    void this.load(window, 'shelf').catch(() => { this.resolveReady?.(); this.resolveReady = null; this.ready = null; window.destroy(); this.window = null; });
    return this.ready;
  }
  markReady() { this.resolveReady?.(); this.resolveReady = null; this.publish(); }
  recordInteraction(sessionId: string) { this.performanceSessionId = sessionId; }
  publish() {
    if (this.preview && !this.snapshot().items.some(item => item.id === this.preview!.id)) {
      this.clearPreview(); void this.present(false); return;
    }
    this.peekWindow()?.webContents.send('collection:changed', this.current());
  }
  suspend() {
    this.cancelEdgeMotion(); this.clearPreview(); this.pointerInteraction = false;
    const started = performance.now(); this.stopHitTesting(); const mouseReset = performance.now();
    this.suspended = true; this.cancelFeedback(); this.epoch++; this.presentation++; this.publish(); this.pendingFocus = null;
    // Keep native visibility for fast repeated captures, but exclude this
    // transparent surface from focus handoffs and from the captured pixels.
    const published = performance.now(); this.peekWindow()?.setOpacity(0); this.peekWindow()?.setIgnoreMouseEvents(true); this.peekWindow()?.setFocusable(false); const hidden = performance.now();
    return { shelfMouseResetMs: mouseReset - started, shelfPublishMs: published - mouseReset, shelfHideMs: hidden - published, shelfSuspendMs: hidden - started };
  }
  hideSuspendedWindow() {
    // Exit fallback for Edit and platforms without macOS app deactivation.
    if (this.suspended) this.hideWindow();
  }
  resume() { this.suspended = false; if (!this.hidden && this.snapshot().count) void this.present(false); }
  collected(display: { bounds: Rectangle; workArea: Rectangle }, selection: Rectangle, id: string, sessionId: string) {
    this.area = display.workArea; this.performanceSessionId = sessionId; this.suspended = false;
    this.cancelEdgeMotion(); this.edge = 'shown'; this.clearPreview();
    void this.showFeedback(display, selection, id);
  }
  private async showFeedback(display: { bounds: Rectangle; workArea: Rectangle }, selection: Rectangle, id: string) {
    const preparationStarted = performance.now(), sessionId = this.performanceSessionId;
    this.stopHitTesting(); this.cancelFeedback();
    const epoch = ++this.epoch;
    await this.prepare();
    const preparedAt = performance.now();
    const window = this.peekWindow();
    if (!window || epoch !== this.epoch || this.suspended) return;
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.setFocusable(false);
    const concealedAt = performance.now();
    const target = shelfWindowBounds(display.workArea, this.size, this.snapshot().items, this.expanded, this.wide, this.configuration.heightMode);
    if (this.hidden || this.reducedMotion) {
      this.feedback = { kind: 'count', duration: this.reducedMotion ? 550 : 800 };
      window.setBounds(target);
    } else {
      let thumbnail: string;
      try { thumbnail = this.thumbnail(id); } catch { this.resume(); return; }
      const item = this.snapshot().items.find(item => item.id === id);
      if (!item) { this.resume(); return; }
      const card = shelfCardRect(item, target.width, 0, 1, false, target.height);
      const ratio = Math.min(card.width / selection.width, card.height / selection.height);
      this.feedback = { kind: 'fly', id, duration: 340, thumbnail, source: selection,
        target: { x: target.x - display.bounds.x + card.x, y: target.y - display.bounds.y + shelfContentTop + card.y,
          width: selection.width * ratio, height: selection.height * ratio } };
      window.setBounds(display.bounds);
    }
    const boundsSetAt = performance.now();
    this.pendingFocus = false; this.presentation++; this.publish();
    screenshotPerformance.updateMetadata(sessionId, { feedbackPrepareMs: preparedAt - preparationStarted, feedbackConcealMs: concealedAt - preparedAt, feedbackBoundsAndThumbnailMs: boundsSetAt - concealedAt, feedbackPublishMs: performance.now() - boundsSetAt });
    // Watchdog: never leave a screen-sized window alive if Renderer cannot acknowledge.
    this.timer = setTimeout(() => this.finishFeedback(), 1500);
  }
  rendered(presentation: number) {
    const window = this.peekWindow();
    if (!window || this.suspended || presentation !== this.presentation || this.pendingFocus === null) return false;
    const focus = this.pendingFocus; this.pendingFocus = null;
    window.setOpacity(1);
    if (focus) { window.show(); window.focus(); } else if (!window.isVisible()) window.showInactive();
    if (this.feedback) {
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => this.finishFeedback(), this.feedback.duration + (this.feedback.kind === 'fly' ? 500 : 40));
    }
    if (this.preview && !this.preview.closing && this.previewTimer) { clearTimeout(this.previewTimer); this.previewTimer = null; }
    if (!this.feedback && !['docking', 'revealing'].includes(this.edge)) this.startHitTesting();
    return true;
  }
  feedbackFinished(presentation: number) {
    if (presentation !== this.presentation || this.feedback?.kind !== 'fly' || this.suspended) return false;
    this.finishFeedback(); return true;
  }
  hasPointerInteraction() {
    const window = this.peekWindow();
    if (!window || this.suspended || this.hidden || this.feedback) return false;
    if (this.pointerInteraction || this.preview || this.edge === 'revealing') return true;
    if (!window.isVisible()) return false;
    const bounds = window.getBounds(), cursor = screen.getCursorScreenPoint();
    if (this.edge === 'docked') return cursor.x >= bounds.x && cursor.x <= bounds.x + bounds.width && cursor.y >= bounds.y && cursor.y <= bounds.y + bounds.height;
    return this.hitRegions.some(r => cursor.x >= bounds.x + r.x && cursor.x <= bounds.x + r.x + r.width && cursor.y >= bounds.y + r.y && cursor.y <= bounds.y + r.y + r.height);
  }
  setPointerInteraction(active: boolean) {
    this.pointerInteraction = active && !this.suspended && !this.hidden && !this.feedback;
    this.updateHitTesting();
  }
  resize(size: ShelfSize) {
    this.size = { ...size }; this.configuration = { ...this.configuration, ...size, heightMode: 'fixed' };
    const window = this.peekWindow();
    if (window && !this.feedback && !this.preview) window.setBounds(this.activeBounds());
    this.lastInside = performance.now(); this.publish();
    return this.current();
  }
  async configure(value: ShelfPreferences) {
    this.configuration = { ...value }; this.size = { width: value.width, height: value.height };
    this.lastInside = performance.now();
    if (!this.peekWindow()) { this.publish(); return this.current(); }
    if (!value.autoHide && this.edge !== 'shown' && !this.hidden && !this.suspended && !this.preview) await this.reveal();
    else if (!this.preview && !this.feedback && !this.suspended && !this.hidden) await this.present(false);
    else {
      if (!value.autoHide) { this.cancelEdgeMotion(); this.edge = 'shown'; }
      this.publish();
    }
    return this.current();
  }
  async widen() { if (!this.preview) { this.wide = !this.wide; await this.present(false); } return this.current(); }
  private cancelEdgeMotion() {
    if (this.edgeTimer) clearTimeout(this.edgeTimer); this.edgeTimer = null;
    if (this.edge === 'docking') this.edge = 'docked'; else if (this.edge === 'revealing') this.edge = 'shown';
  }
  private startDock() {
    if (this.edge !== 'shown' || this.preview || this.feedback || this.pointerInteraction || !this.snapshot().count) return;
    this.edge = 'docking'; this.presentation++; this.pendingFocus = false;
    this.peekWindow()?.setIgnoreMouseEvents(true); this.publish();
    const presentation = this.presentation;
    this.edgeTimer = setTimeout(() => this.edgeFinished(presentation), 600);
  }
  async reveal() {
    if (this.edge === 'shown' || this.edge === 'revealing' || this.suspended || this.feedback || !this.snapshot().count) return;
    this.cancelEdgeMotion(); this.edge = 'revealing'; this.lastInside = performance.now();
    this.hidden = false; this.peekWindow()?.setOpacity(0);
    await this.present(false);
    const presentation = this.presentation;
    this.edgeTimer = setTimeout(() => this.edgeFinished(presentation), 700);
  }
  edgeFinished(presentation: number) {
    if (presentation !== this.presentation || this.suspended || this.hidden || !['docking', 'revealing'].includes(this.edge)) return false;
    const docked = this.edge === 'docking'; this.cancelEdgeMotion(); this.edge = docked ? 'docked' : 'shown';
    this.lastInside = performance.now();
    if (docked) { this.peekWindow()?.setOpacity(0); void this.present(false); }
    else { this.publish(); this.startHitTesting(); }
    return true;
  }
  async openPreview(id: string, source: ShelfRect) {
    const item = this.snapshot().items.find(item => item.id === id), window = this.peekWindow();
    if (!item || !window || this.suspended || this.feedback || this.hidden) throw new Error('请在收纳区就绪后预览截图');
    const bounds = window.getBounds(), area = this.workArea();
    if (![source.x, source.y, source.width, source.height].every(Number.isFinite) || source.width <= 0 || source.height <= 0 || source.x < -bounds.width || source.y < -bounds.height || source.x > bounds.width || source.y > bounds.height || source.width > bounds.width * 2 || source.height > bounds.height * 2) throw new Error('预览来源区域无效');
    this.cancelEdgeMotion(); this.edge = 'shown'; this.clearPreview(); this.stopHitTesting();
    this.preview = { id, source: { ...source, x: bounds.x - area.x + source.x, y: bounds.y - area.y + source.y }, target: shelfPreviewTarget(item, area), closing: false };
    window.setOpacity(0); window.setIgnoreMouseEvents(false); window.setFocusable(true); window.setBounds(area);
    this.pendingFocus = true; this.presentation++; this.publish();
    this.previewTimer = setTimeout(() => { this.clearPreview(); void this.present(false); }, 1800);
  }
  closePreview() {
    if (!this.preview || this.preview.closing) return;
    if (this.previewTimer) clearTimeout(this.previewTimer);
    this.preview = { ...this.preview, closing: true }; this.pendingFocus = true; this.presentation++; this.publish();
    const presentation = this.presentation;
    this.previewTimer = setTimeout(() => this.previewFinished(presentation), 700);
  }
  previewFinished(presentation: number) {
    if (presentation !== this.presentation || !this.preview?.closing) return false;
    this.clearPreview(); this.lastInside = performance.now(); void this.present(false); return true;
  }
  private clearPreview() { if (this.previewTimer) clearTimeout(this.previewTimer); this.previewTimer = null; this.preview = undefined; }
  setHitRegions(regions: ShelfRect[]) { this.hitRegions = regions; this.updateHitTesting(); }
  private updateHitTesting() {
    const window = this.peekWindow();
    if (!window?.isVisible() || this.feedback || this.suspended) return;
    const bounds = window.getBounds(), cursor = screen.getCursorScreenPoint();
    const x = cursor.x - bounds.x, y = cursor.y - bounds.y;
    const over = this.edge === 'docked'
      ? x >= 0 && y >= 0 && x <= bounds.width && y <= bounds.height
      : this.hitRegions.some(r => x >= r.x && y >= r.y && x <= r.x + r.width && y <= r.y + r.height);
    if (over && this.edge === 'docked') { void this.reveal(); return; }
    if (over || this.pointerInteraction || this.preview) this.lastInside = performance.now();
    else if (this.edge === 'shown' && this.configuration.autoHide && performance.now() - this.lastInside >= this.configuration.hideDelayMs) { this.startDock(); return; }
    const ignore = ['docking', 'revealing'].includes(this.edge) || (!this.preview && !this.pointerInteraction && !over);
    if (this.ignoring !== ignore) { window.setIgnoreMouseEvents(ignore, { forward: true }); this.ignoring = ignore; }
  }
  private startHitTesting() {
    this.stopHitTesting(); this.updateHitTesting();
    this.hitTimer = setInterval(() => this.updateHitTesting(), 32); this.hitTimer.unref();
  }
  private stopHitTesting() { if (this.hitTimer) clearInterval(this.hitTimer); this.hitTimer = null; this.ignoring = false; this.peekWindow()?.setIgnoreMouseEvents(false); }
  setReducedMotion(value: boolean) { this.reducedMotion = value; if (value && this.feedback?.kind === 'fly') this.finishFeedback(); }
  private cancelFeedback() { if (this.timer) clearTimeout(this.timer); this.timer = null; this.feedback = undefined; }
  private finishFeedback() {
    this.cancelFeedback(); this.peekWindow()?.setOpacity(0); this.peekWindow()?.setIgnoreMouseEvents(false);
    if (!this.hidden && !this.suspended) void this.present(false); else { this.hideWindow(); this.publish(); }
  }
  async toggle() {
    this.performanceSessionId = screenshotPerformance.startSession({ trigger: 'shelf-expand' });
    screenshotPerformance.mark(this.performanceSessionId, 'shelf_expand_start');
    this.cancelFeedback(); this.peekWindow()?.setIgnoreMouseEvents(false);
    this.clearPreview(); this.cancelEdgeMotion(); this.edge = 'shown';
    this.hidden = false; this.expanded = !this.expanded || !this.peekWindow()?.isVisible();
    await this.present(true);
  }
  collapse() { this.clearPreview(); this.expanded = false; void this.present(false); }
  hide() { this.cancelEdgeMotion(); this.clearPreview(); this.pointerInteraction = false; this.stopHitTesting(); this.cancelFeedback(); this.pendingFocus = null; this.peekWindow()?.setIgnoreMouseEvents(false); this.hidden = true; this.expanded = false; this.epoch++; this.hideWindow(); this.publish(); }
  private async present(focus: boolean) {
    const epoch = ++this.epoch;
    await this.prepare();
    const window = this.peekWindow();
    if (!window || epoch !== this.epoch || this.hidden || this.suspended) return;
    const area = this.area ?? screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    this.area = area;
    this.stopHitTesting(); window.setIgnoreMouseEvents(['docking', 'revealing'].includes(this.edge)); window.setFocusable(this.expanded && this.edge !== 'docked');
    window.setBounds(this.activeBounds()); this.lastInside = performance.now(); this.pendingFocus = focus; this.presentation++; this.publish();
  }
  relocate() {
    if (!this.area || !this.peekWindow()) return;
    this.clearPreview(); this.cancelEdgeMotion();
    this.area = screen.getDisplayMatching(this.area).workArea;
    if (!this.hidden && !this.suspended) { this.cancelFeedback(); void this.present(false); }
  }
  destroy() { this.cancelEdgeMotion(); this.clearPreview(); this.pointerInteraction = false; this.stopHitTesting(); this.cancelFeedback(); this.epoch++; this.peekWindow()?.destroy(); this.window = null; this.ready = null; }
}
