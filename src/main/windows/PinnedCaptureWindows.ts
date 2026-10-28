import type { Rectangle, WebContents, WebPreferences } from 'electron';
import type { BrowserWindow } from 'electron';
import type { PinnedCaptureState } from '../../shared/contracts';
import { ScreenshotToAllWindow } from './screenshot-to-all-window';

/** One preloaded idle window; additional pins own independent sessions and renderers. */
export class PinnedCaptureWindows {
  private readonly windows = new Set<ScreenshotToAllWindow>();
  private readonly sessions = new Map<ScreenshotToAllWindow, string>();
  private readonly primary: ScreenshotToAllWindow;
  private suspended = false;

  constructor(
    private readonly webPreferences: WebPreferences,
    private readonly loadRenderer: (window: BrowserWindow, route: string) => Promise<void>,
    private readonly preloadSessionId: string,
    private readonly onClose: (sessionId: string) => void
  ) { this.primary = this.allocate(preloadSessionId); }

  private allocate(sessionId: string) {
    const window = new ScreenshotToAllWindow(
      { ...this.webPreferences, additionalArguments: ['--snipvia-performance-session=' + sessionId] },
      this.loadRenderer, sessionId, () => {}, () => {
        const active = this.sessions.get(window);
        if (active) this.onClose(active);
      }
    );
    this.windows.add(window);
    return window;
  }

  create(bounds: Rectangle) { return this.primary.create(bounds); }
  peekWindow() { return this.primary.peekWindow(); }
  forSender(sender: WebContents) {
    return [...this.windows].find(window => window.peekWindow()?.webContents === sender);
  }
  sessionForSender(sender: WebContents) {
    const window = this.forSender(sender);
    return window ? this.sessions.get(window) : undefined;
  }
  markRendererReady(sender: WebContents) { this.forSender(sender)?.markRendererReady(); }

  async present(sessionId: string, bounds: Rectangle, state: PinnedCaptureState) {
    if (this.sessions.size >= 32) throw new Error('最多同时保留 32 张钉图，请先关闭部分钉图');
    const window = !this.sessions.has(this.primary) ? this.primary : this.allocate(sessionId);
    this.sessions.set(window, sessionId);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        window.create(bounds),
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('钉图窗口加载超时，请重试')), 15000); })
      ]);
      if (this.sessions.get(window) !== sessionId) throw new Error('钉图已关闭');
      if (this.suspended) window.suspend();
      return await window.present(sessionId, bounds, state);
    } catch (error) {
      this.onClose(sessionId);
      throw error;
    } finally { clearTimeout(timer); }
  }

  showRenderedSession(sessionId: string, sender: WebContents) {
    const window = this.forSender(sender);
    if (!window || this.sessionForSender(sender) !== sessionId) return false;
    if (this.suspended) window.suspend();
    return window.showRenderedSession(sessionId);
  }
  markSessionVisible(sessionId: string, sender: WebContents) {
    return this.sessionForSender(sender) === sessionId && (this.forSender(sender)?.markSessionVisible(sessionId) ?? false);
  }
  close(sessionId: string) {
    const window = [...this.sessions].find(([, id]) => id === sessionId)?.[0];
    if (!window) return;
    this.sessions.delete(window);
    if (window === this.primary) window.hide();
    else { this.windows.delete(window); window.destroy(); }
  }
  suspend() {
    if (this.suspended || !this.sessions.size) return;
    this.suspended = true;
    for (const window of this.sessions.keys()) window.suspend();
  }
  resume() {
    if (!this.suspended) return;
    this.suspended = false;
    for (const window of this.sessions.keys()) window.resume();
  }
  hasPointerInteraction() {
    return [...this.sessions.keys()].some(window => window.peekWindow()?.isFocused());
  }
  isActive() { return this.sessions.size > 0; }
  destroy() {
    for (const sessionId of [...this.sessions.values()]) this.onClose(sessionId);
    for (const window of this.windows) window.destroy();
    this.sessions.clear(); this.windows.clear();
  }
}
