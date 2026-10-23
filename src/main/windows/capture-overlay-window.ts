import { BrowserWindow, type Rectangle, type WebPreferences } from 'electron';
import type { CaptureMode } from '../../shared/contracts';
import { screenshotPerformance } from '../performance/screenshot-performance';

type RendererLoader = (window: BrowserWindow, route: string) => Promise<void>;

export class CaptureOverlayWindow {
  private window: BrowserWindow | null = null;
  private rendererReady = false;
  private readyPromise: Promise<void> | null = null;
  private resolveReady: (() => void) | null = null;
  private activeSessionId: string | null = null;
  private visiblePromise: Promise<boolean> | null = null;
  private resolveVisible: ((visible: boolean) => void) | null = null;
  private destroying = false;

  constructor(
    private readonly webPreferences: WebPreferences,
    private readonly loadRenderer: RendererLoader,
    private readonly preloadSessionId: string,
    private readonly onClose: () => void
  ) {}

  async create(initialBounds: Rectangle) {
    if (this.window && !this.window.isDestroyed()) return this.ensureReady();
    this.rendererReady = false;
    this.destroying = false;
    screenshotPerformance.mark(this.preloadSessionId, 'window_preload_start', 'main', { window: 'capture-overlay' });
    screenshotPerformance.mark(this.preloadSessionId, 'overlay_window_create_start');
    const window = new BrowserWindow({
      ...initialBounds,
      frame: false,
      show: false,
      resizable: false,
      movable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: false,
      fullscreenable: false,
      enableLargerThanScreen: true,
      transparent: true,
      webPreferences: { ...this.webPreferences, backgroundThrottling: false },
      backgroundColor: '#00000000'
    });
    this.window = window;
    screenshotPerformance.mark(this.preloadSessionId, 'overlay_window_create_end');
    window.setAlwaysOnTop(true, 'screen-saver');
    if (process.platform === 'darwin') window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    window.on('close', (event) => {
      if (this.destroying) return;
      event.preventDefault();
      this.onClose();
    });
    window.on('closed', () => {
      if (this.window === window) this.window = null;
      this.finishVisible(false);
    });
    this.readyPromise = new Promise((resolve) => { this.resolveReady = resolve; });
    screenshotPerformance.mark(this.preloadSessionId, 'overlay_load_start');
    window.webContents.once('did-finish-load', () => screenshotPerformance.mark(this.preloadSessionId, 'overlay_did_finish_load'));
    await this.loadRenderer(window, 'capture');
    await this.ensureReady();
    screenshotPerformance.mark(this.preloadSessionId, 'window_preload_ready', 'main', { window: 'capture-overlay' });
  }

  markRendererReady() {
    if (this.rendererReady) return;
    this.rendererReady = true;
    this.resolveReady?.();
    this.resolveReady = null;
  }

  ensureReady() {
    if (this.rendererReady) return Promise.resolve();
    if (!this.readyPromise) throw new Error('CaptureOverlay 尚未创建');
    return this.readyPromise;
  }

  async present(sessionId: string, bounds: Rectangle, frameReady = true, mode: CaptureMode = 'quick') {
    await this.beginSession(sessionId, bounds, frameReady, mode);
    return this.visiblePromise ?? false;
  }

  async prepare(sessionId: string, bounds: Rectangle, mode: CaptureMode = 'quick') {
    await this.beginSession(sessionId, bounds, false, mode);
  }

  waitUntilVisible(sessionId: string) {
    if (sessionId !== this.activeSessionId) return Promise.resolve(false);
    return this.visiblePromise ?? Promise.resolve(false);
  }

  private async beginSession(sessionId: string, bounds: Rectangle, frameReady: boolean, mode: CaptureMode) {
    await this.ensureReady();
    const window = this.getWindow();
    this.hide();
    this.activeSessionId = sessionId;
    window.setBounds(bounds);
    window.setAlwaysOnTop(true, 'screen-saver');
    screenshotPerformance.mark(sessionId, 'capture_overlay_reuse_start');
    this.visiblePromise = new Promise((resolve) => { this.resolveVisible = resolve; });
    window.webContents.send('capture:new-session', { performanceSessionId: sessionId, frameReady, mode });
  }

  showShellSession(sessionId: string) {
    if (sessionId !== this.activeSessionId) return false;
    const window = this.getWindow();
    screenshotPerformance.mark(sessionId, 'capture_overlay_shell_show_called');
    // The shell is informative while the frame is still unavailable. Showing it
    // without activation avoids a costly focus handoff; the ready overlay takes
    // focus a few milliseconds later when selection can actually begin.
    if (!window.isVisible()) window.showInactive();
    screenshotPerformance.mark(sessionId, 'capture_overlay_shell_show_returned');
    return true;
  }

  frameReady(sessionId: string) {
    if (sessionId !== this.activeSessionId) return false;
    this.getWindow().webContents.send('capture:frame-ready', sessionId);
    return true;
  }

  showRenderedSession(sessionId: string) {
    if (sessionId !== this.activeSessionId) return false;
    const window = this.getWindow();
    screenshotPerformance.mark(sessionId, 'capture_overlay_show_called');
    if (!window.isVisible()) window.show();
    window.focus();
    screenshotPerformance.mark(sessionId, 'capture_overlay_show_returned');
    return true;
  }

  markSessionVisible(sessionId: string) {
    if (sessionId !== this.activeSessionId) return false;
    this.finishVisible(true);
    return true;
  }

  suspendForCapture() {
    // Hide our pixels for Electron fallback while preserving an in-progress drag.
    const window = this.window;
    if (window && !window.isDestroyed()) window.hide();
  }

  hide() {
    this.finishVisible(false);
    this.activeSessionId = null;
    const window = this.window;
    if (!window || window.isDestroyed()) return;
    window.hide();
    window.webContents.send('capture:reset-session');
  }

  isActive() {
    return this.activeSessionId !== null;
  }

  isSessionActive(sessionId: string) {
    return this.activeSessionId === sessionId;
  }

  getWindow() {
    if (!this.window || this.window.isDestroyed()) throw new Error('CaptureOverlay 窗口不可用');
    return this.window;
  }

  peekWindow() {
    return this.window && !this.window.isDestroyed() ? this.window : null;
  }

  destroy() {
    this.destroying = true;
    this.finishVisible(false);
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
    this.window = null;
  }

  private finishVisible(visible: boolean) {
    this.resolveVisible?.(visible);
    this.resolveVisible = null;
    this.visiblePromise = null;
  }
}
