import { BrowserWindow, type Rectangle, type WebPreferences } from 'electron';
import type { PinnedCaptureState } from '../../shared/contracts';
import { screenshotPerformance } from '../performance/screenshot-performance';

type RendererLoader = (window: BrowserWindow, route: string) => Promise<void>;

export class ScreenshotToAllWindow {
  private window: BrowserWindow | null = null;
  private rendererReady = false;
  private readyPromise: Promise<void> | null = null;
  private resolveReady: (() => void) | null = null;
  private activeSessionId: string | null = null;
  private renderedSessionId: string | null = null;
  private visiblePromise: Promise<boolean> | null = null;
  private resolveVisible: ((visible: boolean) => void) | null = null;
  private destroying = false;

  constructor(
    private readonly webPreferences: WebPreferences,
    private readonly loadRenderer: RendererLoader,
    private readonly preloadSessionId: string,
    private readonly onMove: () => void,
    private readonly onClose: () => void
  ) {}

  async create(initialBounds: Rectangle) {
    if (this.window && !this.window.isDestroyed()) return this.ensureReady();
    this.rendererReady = false;
    this.destroying = false;
    screenshotPerformance.mark(this.preloadSessionId, 'window_preload_start', 'main', { window: 'screenshot-to-all' });
    screenshotPerformance.mark(this.preloadSessionId, 'pin_window_create_start');
    const window = new BrowserWindow({
      ...initialBounds,
      frame: false,
      transparent: true,
      show: false,
      resizable: false,
      maximizable: false,
      fullscreenable: false,
      movable: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: true,
      backgroundColor: '#00000000',
      webPreferences: { ...this.webPreferences, backgroundThrottling: false }
    });
    this.window = window;
    screenshotPerformance.mark(this.preloadSessionId, 'pin_window_create_end');
    window.setAlwaysOnTop(true, 'floating');
    if (process.platform === 'darwin') window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    window.on('move', this.onMove);
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
    screenshotPerformance.mark(this.preloadSessionId, 'pin_load_start');
    window.webContents.once('did-finish-load', () => screenshotPerformance.mark(this.preloadSessionId, 'pin_did_finish_load'));
    await this.loadRenderer(window, 'pin');
    await this.ensureReady();
    screenshotPerformance.mark(this.preloadSessionId, 'window_preload_ready', 'main', { window: 'screenshot-to-all' });
  }

  markRendererReady() {
    if (this.rendererReady) return;
    this.rendererReady = true;
    this.resolveReady?.();
    this.resolveReady = null;
  }

  ensureReady() {
    if (this.rendererReady) return Promise.resolve();
    if (!this.readyPromise) throw new Error('ScreenshotToAll 尚未创建');
    return this.readyPromise;
  }

  async present(sessionId: string, bounds: Rectangle, state: PinnedCaptureState) {
    await this.ensureReady();
    const window = this.getWindow();
    this.hide();
    this.activeSessionId = sessionId;
    window.setBounds(bounds);
    window.setAlwaysOnTop(true, 'floating');
    screenshotPerformance.mark(sessionId, 'screenshot_window_reuse_start');
    this.visiblePromise = new Promise((resolve) => { this.resolveVisible = resolve; });
    window.webContents.send('pin:new-session', state);
    return this.visiblePromise;
  }

  update(sessionId: string, state: PinnedCaptureState) {
    if (sessionId !== this.activeSessionId) return false;
    this.getWindow().webContents.send('pin:new-session', state);
    return true;
  }

  showRenderedSession(sessionId: string) {
    if (sessionId !== this.activeSessionId) return false;
    if (this.renderedSessionId === sessionId) return true;
    this.renderedSessionId = sessionId;
    const window = this.getWindow();
    window.show();
    window.focus();
    // The chat must not depend on two renderer animation frames being delivered
    // while macOS is switching spaces or the screenshot is temporarily occluded.
    // The later visibility acknowledgement still records its performance marks.
    this.finishVisible(true);
    return true;
  }

  markSessionVisible(sessionId: string) {
    if (sessionId !== this.activeSessionId) return false;
    this.finishVisible(true);
    return true;
  }

  hide() {
    this.finishVisible(false);
    this.activeSessionId = null;
    this.renderedSessionId = null;
    const window = this.window;
    if (!window || window.isDestroyed()) return;
    window.hide();
    window.webContents.send('pin:reset-session');
  }

  isSessionActive(sessionId: string) {
    return this.activeSessionId === sessionId;
  }

  isActive() {
    return this.activeSessionId !== null;
  }

  getWindow() {
    if (!this.window || this.window.isDestroyed()) throw new Error('ScreenshotToAll 窗口不可用');
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
