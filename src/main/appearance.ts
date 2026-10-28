import { app, BrowserWindow, nativeTheme, type IpcMainEvent } from 'electron';
import { appearanceMode, saveAppearanceMode } from './storage/settings';
import { themeModeSchema, type ThemeMode, type ThemeSnapshot } from '../shared/appearance';
import tokens from '../shared/design-tokens.json';

/** Main owns the preference and resolution. No model settings or window roles are exposed. */
export class AppearanceService {
  private snapshot: ThemeSnapshot = { mode: 'system', resolved: 'light', revision: 0 };
  constructor(private readonly mainWindow: () => BrowserWindow | undefined) {}

  start() {
    this.snapshot.mode = appearanceMode();
    nativeTheme.themeSource = this.snapshot.mode;
    this.resolve();
    nativeTheme.on('updated', () => this.resolve());
    app.on('browser-window-created', (_event, window) => this.attach(window));
  }

  current(): ThemeSnapshot { return { ...this.snapshot }; }

  setMode(value: unknown) {
    const mode: ThemeMode = themeModeSchema.parse(value);
    saveAppearanceMode(mode); // Apply only after the existing atomic store succeeds.
    this.snapshot.mode = mode;
    nativeTheme.themeSource = mode;
    this.resolve();
    return this.current();
  }

  colors() { return tokens[this.snapshot.resolved]; }

  private resolve() {
    this.snapshot = { ...this.snapshot, resolved: nativeTheme.shouldUseDarkColors ? 'dark' : 'light', revision: this.snapshot.revision + 1 };
    for (const window of BrowserWindow.getAllWindows()) this.updateWindow(window);
  }

  private updateWindow(window: BrowserWindow) {
    if (window.isDestroyed()) return;
    // All owned transparent windows start at black/zero alpha. macOS getBackgroundColor
    // drops that alpha, so preserve both forms; opaque surfaces use the palette above.
    if (!/^#0{6}(?:00)?$/i.test(window.getBackgroundColor())) window.setBackgroundColor(this.colors()['bg-window']);
    if (process.platform !== 'darwin' && window === this.mainWindow()) {
      window.setTitleBarOverlay({ color: this.colors()['bg-chrome'], symbolColor: this.colors()['text-secondary'], height: 48 });
    }
    window.webContents.send('appearance:changed', this.current());
  }

  private attach(window: BrowserWindow) {
    this.updateWindow(window);
    // One synchronous, in-memory, read-only bootstrap prevents a theme flash in every preload.
    window.webContents.ipc.on('appearance:initial', (event: IpcMainEvent) => {
      event.returnValue = event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame ? this.current() : null;
    });
    window.webContents.on('did-finish-load', () => this.updateWindow(window));
  }
}
