import { app, BrowserWindow, clipboard, ClipboardItem, desktopCapturer, dialog, globalShortcut, ipcMain, Menu, nativeImage, powerMonitor, screen, shell, Tray, type IpcMainInvokeEvent, type NativeImage } from 'electron';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { writeFile, rename, unlink } from 'node:fs/promises';
import { cpus, release } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { captureFinishSchema, type Selection, type CaptureFramePayload, type CaptureFrameQuality, type CaptureFrameTransport, type Result, type Settings } from '../shared/contracts';
import { normalizeCaptureMode, type CaptureMode } from '../shared/capture-mode';
import { type ScreenshotItem } from '../shared/screenshot';
import { performanceMarkSchema, performanceSessionIdSchema } from '../shared/performance';
import { editorFinishSchema, validateEditorPng } from '../shared/screenshot-editor';
import { cropRectangle } from '../shared/geometry';
import { loadSettings, publicSettings } from './storage/settings';
import { CapturePreferencesStore } from './storage/CapturePreferencesStore';
import { capturePreferencesSchema } from '../shared/capture-preferences';
import { ScreenshotStore } from './storage/ScreenshotStore';
import { LegacyDataService } from './legacy/LegacyDataService';
import { AppearanceService } from './appearance';
import { platform, screenPermissionInfo } from './platform';
import { getLoginItemState, launchedAtLogin, setLoginItem } from './platform/login-item';
import { screenshotPerformance } from './performance/screenshot-performance';
import { CaptureOverlayWindow } from './windows/capture-overlay-window';
import { ScreenshotToAllWindow } from './windows/screenshot-to-all-window';
import { captureReadinessStrategies, type CaptureReadinessStrategy } from './capture/capture-readiness';
import { CaptureEngine } from './capture/capture-engine';
import { CaptureModeRouter } from './capture/CaptureModeRouter';
import { ElectronCaptureBackend } from './capture/electron-capture-backend';
import { ScreenCaptureKitBackend } from './capture/screen-capture-kit-backend';
import type { CapturedFrame } from './capture/types';
import { UpdateCheckService } from './updates/UpdateCheckService';
import { ElectronUpdateInstaller } from './updates/ElectronUpdateInstaller';
import { version as sourceVersion } from '../../package.json';

let mainWindow: BrowserWindow;
let updates: UpdateCheckService;
let capturePreferences: CapturePreferencesStore;
export const appearance = new AppearanceService(() => mainWindow);
let captureOverlayWindow: CaptureOverlayWindow | null = null;
let screenshotToAllWindow: ScreenshotToAllWindow | null = null;
let resolveCaptureOverlayReady: (() => void) | null = null;
let rejectCaptureOverlayReady: ((error: unknown) => void) | null = null;
const captureOverlayReady = new Promise<void>((resolve, reject) => { resolveCaptureOverlayReady = resolve; rejectCaptureOverlayReady = reject; });
let reusableWindowsReady: Promise<void> = Promise.resolve();
let startupPerformanceSessionId: string | null = null;
let tray: Tray;
let capturedFrame: CapturedFrame | null = null;
let view = { width: 1, height: 1 };
type CaptureDisplay = { bounds: Electron.Rectangle; workArea: Electron.Rectangle };
let captureDisplay: CaptureDisplay | null = null;
let activeCapturePerformanceSessionId: string | null = null;
let preparing = false;
let generation = 0;
let captureController: AbortController | null = null;
let capturePermissionGranted = false;
let quitting = false;
let shortcut = '';
let editorShortcut = '';
let localPin: { item: ScreenshotItem; performanceSessionId: string } | null = null;
const editorFinishing = new Set<string>();
let desktopCaptureWarmupPromise: Promise<void> | null = null;
let captureEngine: CaptureEngine | null = null;
let screenCaptureKitBackend: ScreenCaptureKitBackend | null = null;
const captureMemoryBefore = new Map<string, number>();
const captureBenchmarkFrames = new Map<string, { source: NativeImage; encoded: Buffer }>();
const developmentSession = !app.isPackaged && Boolean(process.env.ELECTRON_RENDERER_URL) && !process.argv.some(arg => arg.startsWith('--user-data-dir='));
const defaultCaptureReadinessStrategy: CaptureReadinessStrategy = 'hide-event-16';
const defaultCaptureFrameTransport: CaptureFrameTransport = 'jpeg-95';
const defaultCaptureVisibilityRafCount = 1 as const;

// Preserve the installed application's identity, data directory and permission grant.
if (developmentSession) {
  app.setName('截然 Dev');
  const developmentData = join(app.getPath('appData'), 'snipvia-dev');
  mkdirSync(developmentData, { recursive: true });
  app.setPath('userData', developmentData);
}
if (process.platform === 'win32') app.setAppUserModelId('com.snipvia.desktop');
const webPreferences = { preload: join(__dirname, '../preload/index.js'), sandbox: true, contextIsolation: true, nodeIntegration: false };
export const screenshots = new ScreenshotStore(join(app.getPath('userData'), 'screenshots'));
export const legacyData = new LegacyDataService(app.getPath('userData'));
type RoutedImage = { image: NativeImage; selection: Selection; display: CaptureDisplay; action?: 'copy' | 'save' | 'pin' };
const modeRouter = new CaptureModeRouter<RoutedImage>({
  quick: async (result, session) => {
    const { image, selection, display } = result.value;
    const png = image.toPNG();
    const item = screenshots.create(png, { ...image.getSize(), mimeType: 'image/png' });
    try {
      await copyScreenshot(item.id);
      session.signal.throwIfAborted();
      await presentLocalPin(item, selection, display, session.id);
    } catch (error) { screenshots.release(item.id); throw error; }
  },
  edit: async (result, session) => {
    const { image, selection, display, action } = result.value;
    if (!action) throw new Error('请从编辑工具栏完成截图');
    const png = image.toPNG();
    if (action === 'save') {
      const overlay = captureOverlayWindow!.getWindow();
      overlay.hide();
      try {
        const saved = await dialog.showSaveDialog({ title: '保存截图', defaultPath: join(app.getPath('pictures'), 'Snipvia-' + Date.now() + '.png'), filters: [{ name: 'PNG 图片', extensions: ['png'] }] });
        session.signal.throwIfAborted();
        if (saved.canceled || !saved.filePath) return false;
        await writeFile(saved.filePath, png);
        session.signal.throwIfAborted();
      } finally {
        if (captureOverlayWindow?.isSessionActive(session.id)) captureOverlayWindow.showRenderedSession(session.id);
      }
      cleanupOverlay(false);
    } else {
      const item = screenshots.create(png, { ...image.getSize(), mimeType: 'image/png' });
      try {
        if (action === 'pin') await presentLocalPin(item, selection, display, session.id);
        else { await copyScreenshot(item.id); session.signal.throwIfAborted(); cleanupOverlay(false); screenshots.release(item.id); }
      } catch (error) { screenshots.release(item.id); throw error; }
    }
  }
});

async function copyScreenshot(id: string) {
  const { bytes, item } = screenshots.image(id);
  await clipboard.write([new ClipboardItem({ [item.mimeType]: new Blob([new Uint8Array(bytes)], { type: item.mimeType }) })]);
}
function closePinnedFlow() {
  const pin = localPin;
  localPin = null;
  screenshotToAllWindow?.hide();
  if (pin) { screenshots.release(pin.item.id); screenshotPerformance.mark(pin.performanceSessionId, 'capture_closed'); }
}
async function presentLocalPin(item: ScreenshotItem, selection: Selection, display: CaptureDisplay, sessionId: string) {
  if (!screenshotToAllWindow || !modeRouter.current(sessionId)) throw new Error('截图会话已结束');
  closePinnedFlow();
  const { bytes } = screenshots.image(item.id);
  localPin = { item, performanceSessionId: sessionId };
  const preview = { id: item.id, width: item.width, height: item.height, createdAt: item.createdAt, dataUrl: 'data:' + item.mimeType + ';base64,' + bytes.toString('base64'), performanceSessionId: sessionId };
  cleanupOverlay(false);
  await screenshotToAllWindow.present(sessionId, pinnedBounds(selection, display), { capture: preview, localOnly: true, chatActive: false, performanceSessionId: sessionId });
}
function webPreferencesFor(performanceSessionId?: string | null): Electron.WebPreferences {
  return performanceSessionId
    ? { ...webPreferences, additionalArguments: [`--snipvia-performance-session=${performanceSessionId}`] }
    : webPreferences;
}

function captureDelayMs() {
  if (app.isPackaged || !process.env.SNIPVIA_CAPTURE_DELAY) return 200;
  const configured = Number(process.env.SNIPVIA_CAPTURE_DELAY);
  return [0, 16, 32, 50, 75, 100, 150, 200].includes(configured) ? configured : 200;
}

function captureReadinessStrategy(): CaptureReadinessStrategy {
  if (app.isPackaged) return defaultCaptureReadinessStrategy;
  const configured = process.env.SNIPVIA_CAPTURE_READINESS_VARIANT;
  return captureReadinessStrategies.find((strategy) => strategy === configured) ?? defaultCaptureReadinessStrategy;
}

function captureFrameTransport(): CaptureFrameTransport {
  if (app.isPackaged) return defaultCaptureFrameTransport;
  const configured = process.env.SNIPVIA_CAPTURE_TRANSPORT;
  return ['data-url', 'png-base64', 'png-binary', 'jpeg-90', 'jpeg-95'].includes(configured ?? '')
    ? configured as CaptureFrameTransport
    : defaultCaptureFrameTransport;
}

function captureVisibilityRafCount(): 1 | 2 {
  if (app.isPackaged) return defaultCaptureVisibilityRafCount;
  return process.env.SNIPVIA_CAPTURE_RAF_COUNT === '2' ? 2 : defaultCaptureVisibilityRafCount;
}

function captureBackendPreference() {
  if (app.isPackaged) return 'auto' as const;
  const configured = process.env.SNIPVIA_CAPTURE_BACKEND;
  return configured === 'electron' || configured === 'sck' ? configured : 'auto';
}

function screenCaptureKitFormat() {
  if (!app.isPackaged && process.env.SNIPVIA_SCK_FORMAT === 'bgra') return 'bgra' as const;
  if (!app.isPackaged && process.env.SNIPVIA_SCK_FORMAT === 'comparison') return 'comparison' as const;
  return 'jpeg' as const;
}

function screenCaptureKitHelperPath() {
  if (!app.isPackaged && process.env.SNIPVIA_SCK_HELPER_PATH) return process.env.SNIPVIA_SCK_HELPER_PATH;
  return app.isPackaged
    ? join(process.resourcesPath, 'native', 'snipvia-capture-helper')
    : join(app.getAppPath(), 'build', 'native', 'snipvia-capture-helper');
}

function loadWindow(window: BrowserWindow, hash = '') {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  if (packagedTestInstance) {
    window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
      writePackagedTestResult({ stage: 'renderer-load-failed', errorCode, errorDescription, validatedURL });
    });
    window.webContents.on('render-process-gone', (_event, details) => {
      writePackagedTestResult({ stage: 'renderer-process-gone', reason: details.reason, exitCode: details.exitCode });
    });
  }
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) return window.loadURL(`${process.env.ELECTRON_RENDERER_URL}${hash ? `#${hash}` : ''}`);
  return window.loadFile(join(__dirname, '../renderer/index.html'), { hash });
}

function processMemorySnapshot() {
  const metrics = app.getAppMetrics();
  return {
    workingSetKb: metrics.reduce((total, metric) => total + metric.memory.workingSetSize, 0),
    privateBytesKb: metrics.reduce((total, metric) => total + (metric.memory.privateBytes ?? 0), 0),
    rendererProcessCount: metrics.filter((metric) => metric.type === 'Tab').length,
    processCount: metrics.length
  };
}

function processMemoryDetails() {
  return app.getAppMetrics().map((metric) => ({
    pid: metric.pid,
    type: metric.type,
    workingSetKb: metric.memory.workingSetSize,
    privateBytesKb: metric.memory.privateBytes ?? 0
  }));
}

function scheduleDesktopCaptureWarmup() {
  if (process.platform !== 'darwin') return;
  if (desktopCaptureWarmupPromise || platform.capturePermission() !== 'granted') return;
  if (!app.isPackaged && process.env.SNIPVIA_CAPTURE_WARMUP === '0') return;
  const sessionId = startupPerformanceSessionId;
  desktopCaptureWarmupPromise = (async () => {
    const memoryBefore = processMemorySnapshot().workingSetKb;
    screenshotPerformance.mark(sessionId, 'capture_engine_warmup_start', 'main', { thumbnailWidthPx: 0, thumbnailHeightPx: 0 });
    const sources = await desktopCapturer.getSources({
      types: ['screen'], fetchWindowIcons: false, thumbnailSize: { width: 0, height: 0 }
    });
    const memoryAfter = processMemorySnapshot().workingSetKb;
    screenshotPerformance.mark(sessionId, 'capture_engine_warmup_end', 'main', { sourceCount: sources.length });
    screenshotPerformance.updateMetadata(sessionId, {
      captureEngineWarmup: 'screen-enumeration-zero-thumbnail',
      captureEngineWarmupSourceCount: sources.length,
      captureEngineWarmupMemoryDeltaKb: memoryAfter - memoryBefore
    });
  })().catch((error: unknown) => {
    screenshotPerformance.updateMetadata(sessionId, {
      captureEngineWarmupError: error instanceof Error ? error.message : 'unknown'
    });
  });
}

function setupCaptureEngine() {
  capturePermissionGranted = platform.capturePermission() === 'granted';
  const primaryEnabled = () => captureBackendPreference() !== 'electron'
    && process.platform === 'darwin'
    && capturePermissionGranted;
  const electronBackend = new ElectronCaptureBackend({
    getMainWindow: () => mainWindow,
    permissionHelp: () => platform.permissionHelp,
    readinessDelayMs: captureDelayMs,
    readinessStrategy: captureReadinessStrategy,
    waitForWarmup: async () => { if (desktopCaptureWarmupPromise) await desktopCaptureWarmupPromise; },
    mark: (sessionId, event, metadata) => screenshotPerformance.mark(sessionId, event, 'main', metadata)
  });
  screenCaptureKitBackend = new ScreenCaptureKitBackend({
    helperPath: screenCaptureKitHelperPath(),
    systemVersion: process.getSystemVersion(),
    timeoutMs: !app.isPackaged && process.env.SNIPVIA_SCK_TIMEOUT_MS ? Number(process.env.SNIPVIA_SCK_TIMEOUT_MS) : 500,
    outputFormat: screenCaptureKitFormat,
    enabled: primaryEnabled,
    processStrategy: () => !app.isPackaged && process.env.SNIPVIA_SCK_PROCESS_STRATEGY === 'per-capture' ? 'per-capture' : 'persistent',
    mark: (sessionId, event, metadata) => screenshotPerformance.mark(sessionId, event, 'main', metadata),
    updateMetadata: (sessionId, metadata) => screenshotPerformance.updateMetadata(sessionId, metadata)
  });
  captureEngine = new CaptureEngine({
    primary: screenCaptureKitBackend,
    fallback: electronBackend,
    primaryEnabled,
    beforeFallback: () => {
      // The native path may already be showing a transparent response overlay.
      // Hide it before desktopCapturer runs so the fallback never captures Snipvia itself.
      captureOverlayWindow?.suspendForCapture();
      if (screenshotToAllWindow?.isActive()) closePinnedFlow();
    },
    onFallback: (sessionId, reason) => {
      screenshotPerformance.mark(sessionId, 'capture_backend_fallback', 'main', { from: 'screen-capture-kit', to: 'electron', reason });
      screenshotPerformance.updateMetadata(sessionId, { captureFallbackUsed: true, captureFallbackReason: reason });
    }
  });
  void captureEngine.initialize();
}

function compareCaptureFrame(source: NativeImage, encoded: Buffer): CaptureFrameQuality {
  const decoded = nativeImage.createFromBuffer(encoded);
  if (decoded.isEmpty() || decoded.getSize().width !== source.getSize().width || decoded.getSize().height !== source.getSize().height) {
    throw new Error('编码后的截图尺寸不匹配');
  }
  const sourceBitmap = source.toBitmap();
  const decodedBitmap = decoded.toBitmap();
  const pixelCount = source.getSize().width * source.getSize().height;
  const stride = Math.max(1, Math.floor(pixelCount / 120_000));
  let absoluteError = 0;
  let squaredError = 0;
  let maximumChannelError = 0;
  let sampledPixels = 0;
  for (let pixel = 0; pixel < pixelCount; pixel += stride) {
    const offset = pixel * 4;
    for (let channel = 0; channel < 3; channel++) {
      const error = Math.abs(sourceBitmap[offset + channel] - decodedBitmap[offset + channel]);
      absoluteError += error;
      squaredError += error * error;
      maximumChannelError = Math.max(maximumChannelError, error);
    }
    sampledPixels++;
  }
  const channelSamples = sampledPixels * 3;
  const meanSquaredError = squaredError / channelSamples;
  return {
    meanAbsoluteError: absoluteError / channelSamples,
    peakSignalToNoiseRatio: meanSquaredError === 0 ? null : 10 * Math.log10((255 * 255) / meanSquaredError),
    maximumChannelError,
    sampledPixels
  };
}

function resolveCapturedFrameImage(frame: CapturedFrame, performanceSessionId?: string | null) {
  if (frame.image) return frame.image;
  const image = frame.preview
    ? nativeImage.createFromBuffer(frame.preview.bytes)
    : frame.buffer && frame.format === 'bgra'
      ? nativeImage.createFromBitmap(frame.buffer, { width: frame.width, height: frame.height, scaleFactor: 1 })
      : nativeImage.createEmpty();
  const size = image.getSize();
  if (image.isEmpty() || size.width !== frame.width || size.height !== frame.height) {
    throw new Error('截图帧解码失败');
  }
  frame.image = image;
  screenshotPerformance.updateMetadata(performanceSessionId, { nativeImageConstructed: true });
  return image;
}

function restoreDock() {
  if (process.platform !== 'darwin' || quitting) return;
  if (app.dock?.isVisible()) { applyDevelopmentDockIcon(); return; }
  // setVisibleOnAllWorkspaces can temporarily change the macOS process type.
  // Restore a normal Dock application after the capture overlay goes away.
  app.setActivationPolicy('regular');
  void app.dock?.show().then(applyDevelopmentDockIcon).catch(() => { /* The tray remains available if Dock activation fails. */ });
}

function trayIconImage() {
  const directory = process.platform === 'win32' ? 'UI' : 'build';
  const roots = app.isPackaged
    ? [process.resourcesPath]
    : [join(app.getAppPath(), directory), join(process.cwd(), directory)];
  for (const root of roots) {
    if (process.platform === 'win32') {
      const image = nativeImage.createFromPath(join(root, app.isPackaged ? 'Snipvia.ico' : 'Snipvia-Win.ico'));
      if (!image.isEmpty()) return image;
      continue;
    }
    // Use the monochrome overlapping tiles; template tinting follows macOS appearance.
    const image = nativeImage.createFromPath(join(root, 'TrayTemplate.png'));
    if (image.isEmpty()) continue;
    const retina = nativeImage.createFromPath(join(root, 'TrayTemplate@2x.png'));
    if (!retina.isEmpty()) image.addRepresentation({ scaleFactor: 2, dataURL: retina.toDataURL({ scaleFactor: 2 }) });
    image.setTemplateImage(true);
    return image;
  }
  throw new Error('菜单栏图标资源缺失');
}

function applyDevelopmentDockIcon() {
  if (process.platform !== 'darwin' || app.isPackaged) return;
  // NativeImage cannot decode ICNS; use the PNG exported from the same Mac source.
  // System permission dialogs use bundle resources, independently of this Dock override.
  const icon = nativeImage.createFromPath(join(app.getAppPath(), 'src', 'renderer', 'src', 'assets', 'snipvia-app-icon.png'));
  if (!icon.isEmpty()) app.dock?.setIcon(icon);
}

function showMain() { restoreDock(); mainWindow.show(); mainWindow.focus(); }
function cleanupOverlay(cancelSession = true) {
  const performanceSessionId = activeCapturePerformanceSessionId;
  generation++;
  captureController?.abort(new Error('截图已取消'));
  captureController = null;
  if (performanceSessionId) {
    captureMemoryBefore.delete(performanceSessionId);
    captureBenchmarkFrames.delete(performanceSessionId);
    if (cancelSession) modeRouter.cancel(performanceSessionId);
  }
  captureOverlayWindow?.hide();
  capturedFrame = null;
  captureDisplay = null;
  preparing = false;
  restoreDock();
}
function announceError(error: unknown) {
  const message = error instanceof Error ? error.message : '截图失败';
  cleanupOverlay();
  mainWindow.webContents.send('capture:error', message);
}

function pinnedBounds(selection: { x: number; y: number; width: number; height: number }, display: { bounds: Electron.Rectangle; workArea: Electron.Rectangle }) {
  const maximumWidth = Math.min(760, display.workArea.width - 28);
  const maximumImageHeight = Math.min(620, display.workArea.height - 28);
  const scale = Math.min(1, maximumWidth / selection.width, maximumImageHeight / selection.height);
  const imageWidth = Math.max(1, Math.round(selection.width * scale));
  const imageHeight = Math.max(1, Math.round(selection.height * scale));
  const width = Math.min(maximumWidth, imageWidth);
  const height = Math.min(display.workArea.height - 20, imageHeight);
  const preferredX = display.bounds.x + selection.x;
  const preferredY = display.bounds.y + selection.y;
  return {
    x: Math.round(Math.max(display.workArea.x, Math.min(preferredX, display.workArea.x + display.workArea.width - width))),
    y: Math.round(Math.max(display.workArea.y, Math.min(preferredY, display.workArea.y + display.workArea.height - height))),
    width: Math.round(width), height: Math.round(height)
  };
}

type CaptureTrigger = 'hotkey' | 'menu' | 'tray' | 'main';

async function startCapture(trigger: CaptureTrigger = 'main', mode: CaptureMode = 'quick') {
  if (mode === 'collect') throw new Error('连续收纳尚未实现');
  const performanceSessionId = screenshotPerformance.startSession({
    trigger,
    captureMode: mode,
    platform: process.platform,
    architecture: process.arch,
    osRelease: release(),
    cpu: cpus()[0]?.model ?? 'unknown',
    electron: process.versions.electron,
    mode: process.env.ELECTRON_RENDERER_URL ? 'DEV' : app.isPackaged ? 'PROD' : 'PROD build preview'
  });
  // Local capture never waits for model or network configuration.
  if (trigger === 'hotkey') screenshotPerformance.mark(performanceSessionId, 'hotkey_pressed');
  screenshotPerformance.mark(performanceSessionId, 'capture_start');
  screenshotPerformance.updateMetadata(performanceSessionId, { captureMode: mode });
  if (preparing || captureOverlayWindow?.isActive()) {
    screenshotPerformance.mark(activeCapturePerformanceSessionId, 'capture_cancelled', 'main', { reason: 'superseded' });
    cleanupOverlay();
  }
  modeRouter.begin(performanceSessionId, mode);
  activeCapturePerformanceSessionId = performanceSessionId;
  await captureOverlayReady;
  if (activeCapturePerformanceSessionId !== performanceSessionId) return;
  screenshotPerformance.mark(performanceSessionId, 'permission_check_start');
  const permissionCached = capturePermissionGranted;
  let permission = permissionCached ? 'granted' : platform.capturePermission();
  if (process.platform === 'darwin' && permission === 'not-determined') {
    try {
      await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 }, fetchWindowIcons: false });
    } catch { /* macOS exposes the final decision through getMediaAccessStatus below. */ }
    permission = platform.capturePermission();
  }
  capturePermissionGranted = permission === 'granted';
  screenshotPerformance.mark(performanceSessionId, 'permission_check_end', 'main', { status: permission, cached: permissionCached });
  if (permission !== 'granted') {
    screenshotPerformance.mark(performanceSessionId, 'capture_error', 'main', { stage: 'permission' });
    throw new Error(platform.permissionHelp);
  }
  preparing = true;
  const session = ++generation;
  const activeCaptureController = new AbortController();
  captureController = activeCaptureController;
  screenshotPerformance.mark(performanceSessionId, 'display_resolve_start');
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  screenshotPerformance.mark(performanceSessionId, 'display_resolve_end');
  screenshotPerformance.updateMetadata(performanceSessionId, {
    displayId: String(display.id),
    displayWidthDip: display.size.width,
    displayHeightDip: display.size.height,
    scaleFactor: display.scaleFactor,
    captureDelayMs: captureDelayMs(),
    captureReadinessStrategy: captureReadinessStrategy(),
    captureSourceTypes: 'screen',
    captureFetchWindowIcons: false,
    captureBackendPreference: captureBackendPreference(),
    captureThumbnailWidthPx: Math.round(display.size.width * display.scaleFactor),
    captureThumbnailHeightPx: Math.round(display.size.height * display.scaleFactor)
  });
  captureDisplay = { bounds: display.bounds, workArea: display.workArea };
  const mainWindowWasVisible = mainWindow.isVisible();
  try {
    // Native capture excludes our pixels but used to leave this window visible.
    // Both backends now keep it hidden until the user explicitly returns or opens it.
    mainWindow.hide();
    if (!captureEngine) throw new Error('截图引擎尚未初始化');
    if (!captureOverlayWindow) throw new Error('CaptureOverlay 尚未预加载');
    const canPresentImmediately = captureBackendPreference() !== 'electron'
      && process.platform === 'darwin'
      && capturePermissionGranted;
    let immediateOverlayVisible: Promise<boolean> | null = null;
    if (canPresentImmediately) {
      await captureOverlayWindow.prepare(performanceSessionId, display.bounds, mode);
      immediateOverlayVisible = captureOverlayWindow.waitUntilVisible(performanceSessionId);
    }
    const result = await captureEngine.captureDisplay({
      display: { id: String(display.id), bounds: display.bounds, size: display.size, scaleFactor: display.scaleFactor },
      performanceSessionId,
      mainWindowWasVisible,
      signal: activeCaptureController.signal
    });
    if (captureController === activeCaptureController) captureController = null;
    if (session !== generation) return;
    if (result.backend === 'screen-capture-kit' && screenshotToAllWindow?.isActive()) {
      closePinnedFlow();
    }
    capturedFrame = result.frame;
    view = display.size;
    screenshotPerformance.updateMetadata(performanceSessionId, {
      captureBackend: result.backend,
      captureFallbackUsed: result.fallbackUsed,
      ...(result.fallbackReason ? { captureFallbackReason: result.fallbackReason } : {}),
      frameWidthPx: result.frame.width,
      frameHeightPx: result.frame.height,
      frameCapturedAtEpochMs: result.frame.capturedAt,
      nativeImageConstructed: Boolean(result.frame.image)
    });
    const visible = immediateOverlayVisible
      && captureOverlayWindow.isSessionActive(performanceSessionId)
      ? (captureOverlayWindow.frameReady(performanceSessionId), await immediateOverlayVisible)
      : await captureOverlayWindow.present(performanceSessionId, display.bounds, true, mode);
    if (session !== generation || !visible) return;
    preparing = false;
  } catch (error) {
    if (captureController === activeCaptureController) captureController = null;
    // A cancelled session must never tear down a newer capture window.
    if (session !== generation) return;
    screenshotPerformance.mark(performanceSessionId, 'capture_error', 'main', { stage: 'capture' });
    cleanupOverlay();
    // Windows has no TCC prompt. Bring the existing error surface back when
    // desktopCapturer fails after hiding main, so an empty source is visible.
    if (process.platform === 'win32') showMain();
    throw error;
  }
}

type ShortcutSettings = Pick<Settings, 'shortcut' | 'editorShortcut'>;
function registerShortcuts(settings: ShortcutSettings) {
  const previous = { shortcut, editorShortcut };
  const keys = ['shortcut', 'editorShortcut'] as const;
  if (keys.every(key => settings[key] === previous[key])) return;
  if (settings.shortcut === settings.editorShortcut) throw new Error('截图快捷键不能相同');
  const callbacks = {
    shortcut: () => { void startCapture('hotkey', 'quick').catch(announceError); },
    editorShortcut: () => { void startCapture('hotkey', 'edit').catch(announceError); }
  };
  for (const key of keys) if (previous[key]) globalShortcut.unregister(previous[key]);
  const registered: string[] = [];
  try {
    for (const key of keys) {
      if (!globalShortcut.register(settings[key], callbacks[key])) throw new Error('快捷键注册失败，请选择其他组合');
      registered.push(settings[key]);
    }
  } catch (error) {
    for (const accelerator of registered) globalShortcut.unregister(accelerator);
    for (const key of keys) if (previous[key]) globalShortcut.register(previous[key], callbacks[key]);
    throw error;
  }
  ({ shortcut, editorShortcut } = settings);
}
function editorSource(value: unknown) {
  const request = captureFinishSchema.parse(value);
  if (!capturedFrame || !captureDisplay || request.sessionId !== activeCapturePerformanceSessionId
    || !captureOverlayWindow?.isSessionActive(request.sessionId)
    || modeRouter.current(request.sessionId)?.mode !== 'edit') throw new Error('普通截图会话已结束');
  const { selection } = request;
  if (selection.x + selection.width > view.width || selection.y + selection.height > view.height) throw new Error('选区超出屏幕');
  const image = resolveCapturedFrameImage(capturedFrame, request.sessionId);
  const rect = cropRectangle(selection, view, image.getSize());
  return { request, image, rect, display: captureDisplay };
}

async function finishEditor(value: unknown) {
  const request = editorFinishSchema.parse(value);
  const { rect, display } = editorSource(request);
  if (editorFinishing.has(request.sessionId)) throw new Error('正在完成截图');
  validateEditorPng(request.png, rect);
  const image = nativeImage.createFromBuffer(Buffer.from(request.png));
  if (image.isEmpty() || image.getSize().width !== rect.width || image.getSize().height !== rect.height) throw new Error('标注截图无效');
  editorFinishing.add(request.sessionId);
  try {
    const completed = await modeRouter.complete({ sessionId: request.sessionId, value: { image, selection: request.selection, display, action: request.action } });
    return { completed: completed !== false };
  } finally { editorFinishing.delete(request.sessionId); }
}
type WindowRole = 'main' | 'overlay' | 'pin';

function windowForRole(role: WindowRole) {
  if (role === 'main') return mainWindow;
  if (role === 'overlay') return captureOverlayWindow?.peekWindow() ?? null;
  return screenshotToAllWindow?.peekWindow() ?? null;
}

function senderAllowed(event: IpcMainInvokeEvent | Electron.IpcMainEvent, role: WindowRole | WindowRole[]) {
  const roles = Array.isArray(role) ? role : [role];
  return roles.some((item) => {
    const window = windowForRole(item);
    return window && !window.isDestroyed() && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame;
  });
}

function handle(channel: string, role: WindowRole | WindowRole[], action: (value: unknown, event: IpcMainInvokeEvent) => unknown) {
  ipcMain.handle(channel, async (event: IpcMainInvokeEvent, value: unknown): Promise<Result<unknown>> => {
    try {
      if (!senderAllowed(event, role)) throw new Error('不允许的窗口请求');
      return { ok: true, value: await action(value, event) };
    } catch (error) { return { ok: false, error: error instanceof Error ? error.message : '操作失败' }; }
  });
}

function setupIPC() {
  handle('updates:current', 'main', value => { z.undefined().parse(value); return updates.current(); });
  handle('updates:check', 'main', value => { z.undefined().parse(value); return updates.check(); });
  handle('updates:open-release', 'main', value => { z.undefined().parse(value); return updates.openRelease(); });
  handle('updates:download', 'main', value => { z.undefined().parse(value); return updates.download(); });
  handle('updates:restart-install', 'main', value => { z.undefined().parse(value); return updates.restartAndInstall(); });
  handle('appearance:set', 'main', value => appearance.setMode(value));
  handle('settings:get', 'main', () => capturePreferences.current());
  handle('settings:save-shortcuts', 'main', value => {
    const request = capturePreferencesSchema.parse(value);
    const previous = capturePreferences.current();
    registerShortcuts(request);
    try {
      const saved = capturePreferences.save(request);
      mainWindow.webContents.send('settings:changed', saved);
      return saved;
    } catch (error) { registerShortcuts(previous); throw error; }
  });
  handle('clipboard:write-text', 'main', async value => { await clipboard.writeText(z.string().max(100000).parse(value)); });
  handle('storage:reveal', 'main', async value => { z.undefined().parse(value); const error = await shell.openPath(app.getPath('userData')); if (error) throw new Error('无法打开本地数据目录'); });
  handle('screenshots:list', 'main', value => { z.undefined().parse(value); return screenshots.list(); });
  handle('screenshots:save', ['main', 'pin'], (value, event) => { const id = z.string().uuid().parse(value); if (!senderMayAccessScreenshot(id, event)) throw new Error('截图已失效'); return screenshots.save(id); });
  handle('screenshots:delete', 'main', value => screenshots.delete(z.string().uuid().parse(value)));
  handle('screenshots:copy', ['main', 'pin'], (value, event) => { const id = z.string().uuid().parse(value); if (!senderMayAccessScreenshot(id, event)) throw new Error('截图已失效'); return copyScreenshot(id); });
  handle('legacy:read', 'main', value => { z.undefined().parse(value); return legacyData.read(); });
  handle('legacy:import-screenshots', 'main', value => { z.undefined().parse(value); return legacyData.importScreenshots(screenshots); });
  handle('legacy:reveal-notebook', 'main', async value => { const path = await legacyData.notebookDirectory(z.string().uuid().parse(value)); if (await shell.openPath(path)) throw new Error('无法打开原笔记本目录'); });
  handle('legacy:export', 'main', async value => {
    z.undefined().parse(value);
    const result = await dialog.showSaveDialog(mainWindow, { title: '导出旧版记录', defaultPath: join(app.getPath('documents'), 'Snipvia-legacy-' + Date.now() + '.zip'), filters: [{ name: 'ZIP 备份', extensions: ['zip'] }] });
    if (result.canceled || !result.filePath) return false;
    const tmp = result.filePath + '.' + randomUUID() + '.tmp';
    try { await legacyData.exportTo(tmp); await rename(tmp, result.filePath); return true; }
    finally { await unlink(tmp).catch(() => {}); }
  });
  ipcMain.on('window:ready', (event, value: unknown) => {
    if (value === 'capture' && senderAllowed(event, 'overlay')) captureOverlayWindow?.markRendererReady();
    if (value === 'pin' && senderAllowed(event, 'pin')) screenshotToAllWindow?.markRendererReady();
  });
  ipcMain.on('performance:mark', (event, value: unknown) => {
    if (!senderAllowed(event, ['main', 'overlay', 'pin'])) return;
    const parsed = performanceMarkSchema.safeParse(value);
    if (!parsed.success) return;
    screenshotPerformance.mark(parsed.data.sessionId, parsed.data.event, 'renderer', parsed.data.metadata);
  });
  handle('performance:report', ['main', 'overlay', 'pin'], (value) => screenshotPerformance.report(performanceSessionIdSchema.parse(value)));
  handle('performance:startup-report', ['main', 'overlay', 'pin'], () => startupPerformanceSessionId ? screenshotPerformance.report(startupPerformanceSessionId) : null);
  handle('performance:capture-backend-status', ['main', 'overlay', 'pin'], () => ({
    preference: captureBackendPreference(),
    runtimeScreenshots: screenshots.runtimeUsage(),
    screenCaptureKit: screenCaptureKitBackend?.status() ?? null,
    processes: processMemoryDetails()
  }));
  handle('performance:frame-quality', 'overlay', (value) => {
    const sessionId = performanceSessionIdSchema.parse(value);
    const benchmark = captureBenchmarkFrames.get(sessionId);
    if (!benchmark) throw new Error('当前未启用截图质量基准');
    return compareCaptureFrame(benchmark.source, benchmark.encoded);
  });
  handle('settings:login-item', 'main', () => getLoginItemState());
  handle('settings:set-login-item', 'main', (value) => setLoginItem(z.boolean().parse(value)));
  handle('permissions:screen', 'main', () => {
    const info = screenPermissionInfo();
    capturePermissionGranted = info.status === 'granted';
    return info;
  });
  handle('permissions:open-screen-settings', 'main', async () => {
    if (process.platform !== 'darwin') throw new Error('当前系统无需配置此权限');
    await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
  });
  handle('permissions:reveal-application', 'main', () => {
    const { applicationPath, supported } = screenPermissionInfo();
    if (!supported) throw new Error('当前系统无需配置此权限');
    shell.showItemInFolder(applicationPath);
  });
  handle('permissions:copy-application-path', 'main', () => {
    const { applicationPath, supported } = screenPermissionInfo();
    if (!supported) throw new Error('当前系统无需配置此权限');
    clipboard.writeText(applicationPath);
  });
  handle('browser:open-external', 'main', async (value) => {
    if (typeof value !== 'string' || value.length > 2048) throw new Error('链接无效');
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('只允许打开安全的网页链接');
    await shell.openExternal(url.toString());
  });
  handle('capture:start', 'main', value => startCapture('main', normalizeCaptureMode(value)));
  handle('capture:frame', 'overlay', () => {
    const performanceSessionId = activeCapturePerformanceSessionId;
    if (!capturedFrame || !performanceSessionId) throw new Error('截图会话已结束');
    const sourceImage = () => resolveCapturedFrameImage(capturedFrame!, performanceSessionId);
    const transport = captureFrameTransport();
    const visibilityRafCount = captureVisibilityRafCount();
    const size = { width: capturedFrame.width, height: capturedFrame.height };
    const memoryBeforeEncode = processMemorySnapshot().workingSetKb;
    captureMemoryBefore.set(performanceSessionId, memoryBeforeEncode);
    screenshotPerformance.updateMetadata(performanceSessionId, {
      captureFrameTransport: transport,
      captureVisibilityRafCount: visibilityRafCount,
      captureFrameMemoryBeforeEncodeKb: memoryBeforeEncode
    });
    screenshotPerformance.mark(performanceSessionId, 'frame_encode_start', 'main', { transport });
    let payload: CaptureFramePayload;
    let benchmarkBuffer: Buffer | null = null;
    if (transport === 'jpeg-95' && capturedFrame.preview) {
      screenshotPerformance.mark(performanceSessionId, 'frame_to_jpeg_start', 'main', { quality: 95, reusedNativePreview: true });
      const bytes = capturedFrame.preview.bytes;
      screenshotPerformance.mark(performanceSessionId, 'frame_to_jpeg_end', 'main', { bytes: bytes.byteLength, quality: 95, reusedNativePreview: true });
      payload = { transport, mimeType: 'image/jpeg', bytes, performanceSessionId, visibilityRafCount, ...size };
      benchmarkBuffer = bytes;
    } else if (transport === 'data-url') {
      screenshotPerformance.mark(performanceSessionId, 'frame_to_data_url_start');
      const dataUrl = sourceImage().toDataURL();
      screenshotPerformance.mark(performanceSessionId, 'frame_to_data_url_end', 'main', { characters: dataUrl.length });
      payload = { transport, mimeType: 'image/png', dataUrl, performanceSessionId, visibilityRafCount, ...size };
      if (process.env.SNIPVIA_CAPTURE_BENCHMARK === '1') benchmarkBuffer = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
    } else if (transport === 'png-base64') {
      screenshotPerformance.mark(performanceSessionId, 'frame_to_png_start');
      const png = sourceImage().toPNG();
      screenshotPerformance.mark(performanceSessionId, 'frame_to_png_end', 'main', { bytes: png.byteLength });
      screenshotPerformance.mark(performanceSessionId, 'frame_base64_start');
      const dataUrl = `data:image/png;base64,${png.toString('base64')}`;
      screenshotPerformance.mark(performanceSessionId, 'frame_base64_end', 'main', { characters: dataUrl.length });
      payload = { transport, mimeType: 'image/png', dataUrl, performanceSessionId, visibilityRafCount, ...size };
      benchmarkBuffer = png;
    } else {
      const jpeg = transport === 'jpeg-90' || transport === 'jpeg-95';
      const quality = transport === 'jpeg-90' ? 90 : 95;
      screenshotPerformance.mark(performanceSessionId, jpeg ? 'frame_to_jpeg_start' : 'frame_to_png_start', 'main', jpeg ? { quality } : undefined);
      const bytes = jpeg ? sourceImage().toJPEG(quality) : sourceImage().toPNG();
      screenshotPerformance.mark(performanceSessionId, jpeg ? 'frame_to_jpeg_end' : 'frame_to_png_end', 'main', { bytes: bytes.byteLength, ...(jpeg ? { quality } : {}) });
      payload = { transport, mimeType: jpeg ? 'image/jpeg' : 'image/png', bytes, performanceSessionId, visibilityRafCount, ...size };
      benchmarkBuffer = bytes;
    }
    if (process.env.SNIPVIA_CAPTURE_BENCHMARK === '1' && benchmarkBuffer) {
      captureBenchmarkFrames.clear();
      captureBenchmarkFrames.set(performanceSessionId, { source: sourceImage(), encoded: benchmarkBuffer });
    }
    const encodedBytes = 'dataUrl' in payload ? payload.dataUrl.length * 2 : payload.bytes.byteLength;
    screenshotPerformance.mark(performanceSessionId, 'frame_encode_end', 'main', { transport, encodedBytes });
    const memoryAfterEncode = processMemorySnapshot().workingSetKb;
    screenshotPerformance.updateMetadata(performanceSessionId, {
      captureFrameEncodedBytes: encodedBytes,
      captureFrameMemoryAfterEncodeKb: memoryAfterEncode,
      captureFrameMemoryEncodeDeltaKb: memoryAfterEncode - memoryBeforeEncode
    });
    return payload;
  });
  handle('capture:session-shell-rendered', 'overlay', (value) => captureOverlayWindow?.showShellSession(performanceSessionIdSchema.parse(value)) ?? false);
  handle('capture:session-rendered', 'overlay', (value) => captureOverlayWindow?.showRenderedSession(performanceSessionIdSchema.parse(value)) ?? false);
  handle('capture:session-visible', 'overlay', (value) => {
    const sessionId = performanceSessionIdSchema.parse(value);
    const visible = captureOverlayWindow?.markSessionVisible(sessionId) ?? false;
    if (visible) {
      const memoryVisible = processMemorySnapshot().workingSetKb;
      const memoryBeforeEncode = captureMemoryBefore.get(sessionId);
      const report = screenshotPerformance.report(sessionId);
      const captured = report?.marks.find((mark) => mark.event === 'frame_capture_end');
      const shown = report?.marks.find((mark) => mark.event === 'capture_overlay_visible');
      const overlayVisibleAtEpochMs = Date.now();
      screenshotPerformance.updateMetadata(sessionId, {
        captureFrameMemoryVisibleKb: memoryVisible,
        overlayVisibleAtEpochMs,
        ...(capturedFrame ? { frameAgeMs: overlayVisibleAtEpochMs - capturedFrame.capturedAt } : {}),
        ...(captured && shown ? { framePipelineAgeMs: shown.atMs - captured.atMs } : {}),
        ...(memoryBeforeEncode === undefined ? {} : { captureFrameMemoryVisibleDeltaKb: memoryVisible - memoryBeforeEncode })
      });
      captureMemoryBefore.delete(sessionId);
    }
    return visible;
  });
  handle('capture:cancel', 'overlay', () => {
    screenshotPerformance.mark(activeCapturePerformanceSessionId, 'capture_cancelled');
    cleanupOverlay();
  });
  handle('capture:editor-crop', 'overlay', (value) => {
    const { image, rect } = editorSource(value);
    const size = image.getSize();
    return { bytes: new Uint8Array(image.crop(rect).toPNG()), width: rect.width, height: rect.height,
      originX: rect.x, originY: rect.y, scaleX: size.width / view.width, scaleY: size.height / view.height };
  });
  handle('capture:editor-finish', 'overlay', finishEditor);
  handle('capture:finish', 'overlay', async (value) => {
    if (!capturedFrame || !captureDisplay) throw new Error('截图会话已结束');
    const requestValue = typeof value === 'object' && value !== null ? value as { sessionId?: unknown } : null;
    const requestedSessionId = typeof requestValue?.sessionId === 'string' ? requestValue.sessionId : activeCapturePerformanceSessionId;
    if (!modeRouter.current(requestedSessionId!) || requestedSessionId !== activeCapturePerformanceSessionId) throw new Error('截图会话已失效');
    const sourceFrame = resolveCapturedFrameImage(capturedFrame, requestedSessionId);
    screenshotPerformance.mark(requestedSessionId, 'capture_finish_main_received');
    screenshotPerformance.mark(requestedSessionId, 'selection_validation_start');
    const request = captureFinishSchema.parse(value);
    screenshotPerformance.mark(request.sessionId, 'selection_validation_end');
    if (request.sessionId !== activeCapturePerformanceSessionId) throw new Error('截图会话已失效');
    const selection = request.selection;
    const display = captureDisplay;
    screenshotPerformance.mark(request.sessionId, 'coordinate_conversion_start');
    const rect = cropRectangle(selection, view, sourceFrame.getSize());
    screenshotPerformance.mark(request.sessionId, 'coordinate_conversion_end');
    screenshotPerformance.mark(request.sessionId, 'crop_start');
    const selected = sourceFrame.crop(rect);
    screenshotPerformance.mark(request.sessionId, 'crop_end', 'main', { width: rect.width, height: rect.height });
    screenshotPerformance.updateMetadata(request.sessionId, {
      selectionXDip: selection.x,
      selectionYDip: selection.y,
      selectionWidthDip: selection.width,
      selectionHeightDip: selection.height,
      selectionWidthPx: rect.width,
      selectionHeightPx: rect.height
    });
    await modeRouter.complete({ sessionId: request.sessionId, value: { image: selected, selection, display } });
  });
  handle('pin:current', 'pin', () => {
    if (!localPin) throw new Error('置顶截图已结束');
    const { item, bytes } = screenshots.image(localPin.item.id);
    return { localOnly: true, chatActive: false, performanceSessionId: localPin.performanceSessionId,
      capture: { id: item.id, createdAt: item.createdAt, width: item.width, height: item.height, dataUrl: 'data:' + item.mimeType + ';base64,' + bytes.toString('base64') } };
  });
  handle('pin:session-rendered', 'pin', value => screenshotToAllWindow?.showRenderedSession(performanceSessionIdSchema.parse(value)) ?? false);
  handle('pin:session-visible', 'pin', value => screenshotToAllWindow?.markSessionVisible(performanceSessionIdSchema.parse(value)) ?? false);
  handle('pin:close', 'pin', () => closePinnedFlow());
  handle('pin:copy', 'pin', async () => {
    const pin = localPin;
    if (!pin) throw new Error('置顶截图已结束');
    await copyScreenshot(pin.item.id);
    if (localPin === pin) closePinnedFlow();
  });
}
function senderMayAccessScreenshot(id: string, event: IpcMainInvokeEvent) { return localPin?.item.id === id || senderAllowed(event, 'main') && screenshots.list().some(item => item.id === id); }
const packagedTestInstance = app.isPackaged && process.argv.includes('--snipvia-packaged-test');
const packagedTestResultPath = packagedTestInstance
  ? process.argv.find((argument) => argument.startsWith('--snipvia-packaged-test-result='))?.slice('--snipvia-packaged-test-result='.length)
  : undefined;
function writePackagedTestResult(value: Record<string, unknown>) {
  if (packagedTestResultPath) writeFileSync(packagedTestResultPath, JSON.stringify(value));
}
if (!packagedTestInstance && !app.requestSingleInstanceLock()) {
  if (developmentSession) console.error('Snipvia 开发版已在运行；请切换到现有窗口，或先退出它再运行 pnpm dev。');
  app.quit();
}
else {
  if (!packagedTestInstance) app.on('second-instance', () => { if (mainWindow) showMain(); });
  app.whenReady().then(async () => {
    writePackagedTestResult({ stage: 'app-ready' });
    if (!developmentSession) app.setName('截然');
    restoreDock();
    let startupError = '';
    try { loadSettings({ migrateCredentials: false }); } catch { startupError = '设置文件读取失败，已使用默认值；原文件未修改。'; }
    capturePreferences = new CapturePreferencesStore(join(app.getPath('userData'), 'capture-preferences.json'), publicSettings());
    try { capturePreferences.load(); } catch { startupError += 'V2 快捷键配置读取失败，使用旧快捷键；原文件未修改。'; }
    appearance.start();
    writePackagedTestResult({ stage: 'storage-loaded' });
    startupPerformanceSessionId = screenshotPerformance.startSession({
      trigger: 'startup-preload',
      platform: process.platform,
      architecture: process.arch,
      osRelease: release(),
      cpu: cpus()[0]?.model ?? 'unknown',
      electron: process.versions.electron,
      mode: process.env.ELECTRON_RENDERER_URL ? 'DEV' : app.isPackaged ? 'PROD' : 'PROD build preview'
    });
    writePackagedTestResult({ stage: 'before-main-window-create' });
    mainWindow = new BrowserWindow({
      width: 920, height: 760, minWidth: 700, minHeight: 560, show: !launchedAtLogin(), title: '截然', backgroundColor: appearance.colors()['bg-window'],
      titleBarStyle: 'hidden',
      ...(process.platform === 'darwin'
        ? { trafficLightPosition: { x: 16, y: 18 } }
        : { titleBarOverlay: { color: appearance.colors()['bg-chrome'], symbolColor: appearance.colors()['text-secondary'], height: 48 } }),
      ...(process.platform === 'win32' ? { icon: trayIconImage() } : {}),
      webPreferences
    });
    writePackagedTestResult({ stage: 'main-window-created' });
    mainWindow.on('close', (event) => { if (!quitting) { event.preventDefault(); mainWindow.hide(); } });
    mainWindow.webContents.on('render-process-gone', () => { if (preparing || captureOverlayWindow?.isActive()) cleanupOverlay(); });
    writePackagedTestResult({ stage: 'main-window-handlers-ready' });
    captureOverlayWindow = new CaptureOverlayWindow(webPreferencesFor(startupPerformanceSessionId), loadWindow, startupPerformanceSessionId, () => cleanupOverlay());
    screenshotToAllWindow = new ScreenshotToAllWindow(webPreferencesFor(startupPerformanceSessionId), loadWindow, startupPerformanceSessionId, () => {}, () => closePinnedFlow());
    writePackagedTestResult({ stage: 'window-managers-ready' });
    updates = new UpdateCheckService({
      currentVersion: app.isPackaged ? app.getVersion() : sourceVersion,
      openExternal: url => shell.openExternal(url),
      installer: new ElectronUpdateInstaller({
        beforeInstall: () => {
          quitting = true;
          // Native Mac quitAndInstall closes windows before before-quit. These
          // reusable capture windows intercept close, so release only the idle
          // windows after the user confirms installation.
          captureOverlayWindow?.destroy();
          screenshotToAllWindow?.destroy();
        },
        onInstallError: () => {
          if (!mainWindow.isDestroyed()) { quitting = false; }
          updates.installationFailed();
        }
      }),
      prepareInstall: async () => {
        if (preparing || captureOverlayWindow?.isActive()) throw new Error('请先完成当前截图');
      },
      onChanged: state => {
        if (!quitting && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.send('updates:changed', state);
      }
    });
    setupIPC();
    writePackagedTestResult({ stage: 'ipc-ready' });
    const captureMenu = [
      { label: '快速截图', click: () => { void startCapture('menu', 'quick').catch(announceError); } },
      { label: '截图与标注', click: () => { void startCapture('menu', 'edit').catch(announceError); } }
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: '截然', submenu: [{ label: '设置…', accelerator: 'CommandOrControl+,', click: showMain }, ...captureMenu, { type: 'separator' }, { role: 'quit', label: '退出截然' }] },
      { label: '编辑', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
      { label: '窗口', submenu: [{ role: 'minimize' }, { role: 'toggleDevTools' }] }
    ]));
    if (process.platform === 'win32') { mainWindow.setAutoHideMenuBar(true); mainWindow.setMenuBarVisibility(false); }
    if (process.platform === 'darwin') app.dock?.setMenu(Menu.buildFromTemplate([{ label: '设置…', click: showMain }, ...captureMenu]));
    writePackagedTestResult({ stage: 'menus-ready' });
    tray = new Tray(trayIconImage());
    tray.setToolTip('截然 — 轻量截图');
    tray.setContextMenu(Menu.buildFromTemplate([...captureMenu, { label: '设置…', click: showMain }, { type: 'separator' }, { label: '退出', role: 'quit' }]));
    if (process.platform === 'win32') tray.on('click', showMain);
    writePackagedTestResult({ stage: 'tray-ready' });
    if (!packagedTestInstance) {
      try { registerShortcuts(capturePreferences.current()); } catch { startupError = '全局快捷键被占用，请在设置中修改；仍可使用菜单或截图按钮。'; }
    }
    writePackagedTestResult({ stage: 'shortcut-ready' });
    screen.on('display-added', () => {
      void captureEngine?.invalidateDisplays();
      if (preparing || captureOverlayWindow?.isActive()) cleanupOverlay();
    });
    screen.on('display-removed', () => {
      void captureEngine?.invalidateDisplays();
      if (preparing || captureOverlayWindow?.isActive()) cleanupOverlay();
    });
    screen.on('display-metrics-changed', (_event, _display, metrics) => {
      if (!metrics.some((metric) => ['bounds', 'scaleFactor', 'rotation'].includes(metric))) return;
      void captureEngine?.invalidateDisplays();
      if (preparing || captureOverlayWindow?.isActive()) cleanupOverlay();
    });
    powerMonitor.on('resume', () => { void captureEngine?.invalidateDisplays(); });
    powerMonitor.on('unlock-screen', () => { void captureEngine?.invalidateDisplays(); });
    writePackagedTestResult({ stage: 'before-main-window-load' });
    await loadWindow(mainWindow);
    updates.scheduleStartup(app.isPackaged && !packagedTestInstance);
    writePackagedTestResult({ stage: 'main-window-loaded' });
    const memoryBefore = processMemorySnapshot();
    screenshotPerformance.updateMetadata(startupPerformanceSessionId, {
      memoryBeforeWorkingSetKb: memoryBefore.workingSetKb,
      memoryBeforePrivateBytesKb: memoryBefore.privateBytesKb,
      memoryBeforeRendererProcesses: memoryBefore.rendererProcessCount,
      memoryBeforeProcesses: memoryBefore.processCount
    });
    const primaryDisplay = screen.getPrimaryDisplay();
    const initialPinBounds = {
      x: primaryDisplay.workArea.x,
      y: primaryDisplay.workArea.y,
      width: Math.min(320, primaryDisplay.workArea.width),
      height: Math.min(200, primaryDisplay.workArea.height)
    };
    const reusableWindowTimeout = <T>(promise: Promise<T>, label: string) => Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error(`${label} 预加载超时`)), 15_000))
    ]);
    const overlayReady = reusableWindowTimeout(captureOverlayWindow.create(primaryDisplay.bounds), 'CaptureOverlay')
      .then(() => {
        resolveCaptureOverlayReady?.();
        resolveCaptureOverlayReady = null;
        rejectCaptureOverlayReady = null;
        writePackagedTestResult({ stage: 'capture-overlay-ready' });
      }).catch((error) => {
        rejectCaptureOverlayReady?.(error);
        rejectCaptureOverlayReady = null;
        throw error;
      });
    const pinReady = reusableWindowTimeout(screenshotToAllWindow.create(initialPinBounds), 'ScreenshotToAll')
      .then(() => { writePackagedTestResult({ stage: 'screenshot-to-all-ready' }); });
    reusableWindowsReady = Promise.all([overlayReady, pinReady]).then(async () => {
      await new Promise<void>((resolve) => setImmediate(resolve));
      const memoryAfter = processMemorySnapshot();
      screenshotPerformance.updateMetadata(startupPerformanceSessionId, {
        memoryAfterWorkingSetKb: memoryAfter.workingSetKb,
        memoryAfterPrivateBytesKb: memoryAfter.privateBytesKb,
        memoryAfterRendererProcesses: memoryAfter.rendererProcessCount,
        memoryAfterProcesses: memoryAfter.processCount,
        memoryDeltaWorkingSetKb: memoryAfter.workingSetKb - memoryBefore.workingSetKb,
        memoryDeltaPrivateBytesKb: memoryAfter.privateBytesKb - memoryBefore.privateBytesKb,
        memoryDeltaRendererProcesses: memoryAfter.rendererProcessCount - memoryBefore.rendererProcessCount
      });
      if (process.env.SNIPVIA_PERF) {
        console.info('[Snipvia Performance] CaptureOverlay ready');
        console.info('[Snipvia Performance] ScreenshotToAll ready');
      }
    });
    // Enumeration-only warm-up overlaps reusable renderer preload and never requests pixels.
    scheduleDesktopCaptureWarmup();
    setupCaptureEngine();
    await reusableWindowsReady;
    writePackagedTestResult({ stage: 'reusable-windows-ready' });
    if (packagedTestInstance && process.env.SNIPVIA_PACKAGED_TEST_CAPTURE === '1') {
      try {
        await startCapture('main');
        const sessionId = activeCapturePerformanceSessionId;
        const report = sessionId ? screenshotPerformance.report(sessionId) : null;
        const packagedResult = {
          stage: 'capture-complete',
          ok: report?.metadata.captureBackend === 'screen-capture-kit' && report.metadata.captureFallbackUsed === false,
          sessionId,
          backend: report?.metadata.captureBackend,
          fallbackUsed: report?.metadata.captureFallbackUsed,
          helper: screenCaptureKitBackend?.status()
        };
        writePackagedTestResult(packagedResult);
        console.info(`[Snipvia Packaged Test] ${JSON.stringify(packagedResult)}`);
        cleanupOverlay();
        app.quit();
        return;
      } catch (error) {
        const packagedResult = { stage: 'capture-failed', ok: false, error: error instanceof Error ? error.message : 'unknown' };
        writePackagedTestResult(packagedResult);
        console.error(`[Snipvia Packaged Test] ${JSON.stringify(packagedResult)}`);
        app.exit(1);
        return;
      }
    }
    if (startupError) await dialog.showMessageBox(mainWindow, { type: 'warning', message: startupError });
    app.on('activate', () => {
      // An activation queued before capture must not reopen the hidden window.
      if (preparing || captureOverlayWindow?.isActive()) return;
      showMain();
    });
  }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : '未知错误';
    writePackagedTestResult({ stage: 'startup-failed', error: message });
    dialog.showErrorBox('截然启动失败', message);
    app.quit();
  });
}
app.on('before-quit', () => {
  quitting = true;
  updates?.dispose();
  if (preparing || captureOverlayWindow?.isActive()) cleanupOverlay();
  modeRouter.cancel();
  closePinnedFlow();
  captureOverlayWindow?.destroy();
  screenshotToAllWindow?.destroy();
  screenshots.dispose();
  void captureEngine?.dispose();
});
app.on('will-quit', () => globalShortcut.unregisterAll());
