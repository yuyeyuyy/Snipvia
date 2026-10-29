import { BrowserWindow, screen, type WebPreferences } from 'electron';
import { quickTargetBounds, type QuickTargetArea, type QuickTargetState } from '../../shared/quick-target';

export class QuickTargetWindow {
  private window: BrowserWindow | null = null;
  private ready = false;
  private preparing: Promise<void> | null = null;
  private presentation = 0;
  private pending = false;
  private concealed = true;
  private area: QuickTargetArea | null = null;
  private targetCount = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  constructor(private readonly preferences: WebPreferences, private readonly load: (window: BrowserWindow, hash: string) => Promise<void>, private readonly failed: () => void) {}
  peekWindow() { return this.window && !this.window.isDestroyed() ? this.window : null; }
  isReady() { return this.ready && !!this.peekWindow(); }
  prepare() {
    if (this.preparing || this.peekWindow()) return this.preparing ?? Promise.resolve();
    const window = new BrowserWindow({ width: 520, height: 142, show: false, frame: false, transparent: true, backgroundColor: '#00000000', focusable: false, acceptFirstMouse: true, alwaysOnTop: true, hasShadow: false, skipTaskbar: true, resizable: false, movable: false, fullscreenable: false, webPreferences: { ...this.preferences, backgroundThrottling: false } });
    this.window = window;
    if (process.platform === 'darwin') window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    window.on('close', event => { event.preventDefault(); if (this.window === window) this.failed(); });
    window.webContents.on('render-process-gone', () => { if (this.window === window) { this.destroy(); this.failed(); } });
    const pending = this.load(window, 'quick-target').catch(() => {
      if (this.window === window) { this.destroy(); this.failed(); }
    }).finally(() => { if (this.preparing === pending) this.preparing = null; });
    this.preparing = pending;
    return pending;
  }
  markReady() { this.ready = !!this.peekWindow(); }
  present(state: QuickTargetState, area: QuickTargetArea) {
    const window = this.peekWindow(); if (!window || !this.ready) return;
    this.hide(); this.area = area; this.targetCount = state.targets.length; this.presentation = state.presentationId; this.pending = true;
    window.setBounds(quickTargetBounds(area, state.targets.length)); this.update(state);
    this.timer = setTimeout(() => { if (this.pending) this.failed(); }, 1500);
  }
  rendered(presentation: number) {
    const window = this.peekWindow();
    if (!window || !this.pending || this.presentation !== presentation) return false;
    this.pending = false; this.clearTimer(); window.setIgnoreMouseEvents(false); window.setOpacity(1); window.showInactive(); this.concealed = false; return true;
  }
  update(state: QuickTargetState) {
    const window = this.peekWindow();
    if (window && state.visible && this.area) {
      const bounds = quickTargetBounds(this.area, this.targetCount);
      const width = state.choices?.length ? Math.min(this.area.width, Math.max(360, bounds.width)) : bounds.width;
      const availableHeight = this.area.height - (bounds.y - this.area.y);
      window.setBounds({ ...bounds, x: Math.round(this.area.x + (this.area.width - width) / 2), width, height: Math.max(1, Math.min(availableHeight, bounds.height + (state.error || state.notice ? 70 : 0) + (state.choices?.length ? Math.min(240, state.choices.length * 52 + 12) : 0))) });
    }
    window?.webContents.send('quick-target:changed', state);
  }
  hasPointerInteraction() {
    const window = this.peekWindow(); if (!window || this.concealed || !window.isVisible()) return false;
    const bounds = window.getBounds(), cursor = screen.getCursorScreenPoint();
    return window.isFocused() || (cursor.x >= bounds.x && cursor.x <= bounds.x + bounds.width && cursor.y >= bounds.y && cursor.y <= bounds.y + bounds.height);
  }
  focus() { const window = this.peekWindow(); if (!window || !window.isVisible()) return false; window.setFocusable(true); window.show(); window.focus(); window.webContents.focus(); return true; }
  suspend() { this.pending = false; this.concealed = true; this.clearTimer(); const window = this.peekWindow(); if (window) { window.setOpacity(0); window.setIgnoreMouseEvents(true); window.setFocusable(false); } }
  hide() { this.suspend(); const window = this.peekWindow(); if (window?.isVisible()) window.hide(); }
  destroy() { this.clearTimer(); this.ready = false; this.pending = false; this.preparing = null; this.concealed = true; const window = this.peekWindow(); this.window = null; window?.destroy(); }
  private clearTimer() { if (this.timer) clearTimeout(this.timer); this.timer = null; }
}
