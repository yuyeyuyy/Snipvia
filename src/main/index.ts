import { app, BrowserWindow, clipboard, ClipboardItem, desktopCapturer, dialog, globalShortcut, ipcMain, Menu, nativeImage, powerMonitor, screen, shell, Tray, type IpcMainInvokeEvent, type NativeImage } from 'electron';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { writeFile, rename, unlink } from 'node:fs/promises';
import { cpus, release } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { captureFinishSchema, type Selection, type CaptureFramePayload, type CaptureFrameQuality, type CaptureFrameTransport, type Result } from '../shared/contracts';
import { normalizeCaptureMode, type CaptureMode } from '../shared/capture-mode';
import { type ScreenshotItem } from '../shared/screenshot';
import { performanceMarkSchema, performanceSessionIdSchema } from '../shared/performance';
import { editorFinishSchema, validateEditorPng } from '../shared/screenshot-editor';
import { cropRectangle } from '../shared/geometry';
import { loadSettings, legacyCaptureShortcuts } from './storage/settings';
import { CapturePreferencesStore } from './storage/CapturePreferencesStore';
import { capturePreferencesSchema, captureShortcutKeys, acceleratorIdentity, type CapturePreferences } from '../shared/capture-preferences';
import { ScreenshotCollection } from './storage/ScreenshotCollection';
import { ShelfPreferencesStore } from './storage/ShelfPreferencesStore';
import { ScreenshotDragFiles } from './storage/ScreenshotDragFiles';
import { shelfResizeSchema, shelfPreferencesSchema } from '../shared/shelf-preferences';
import { ShelfWindow } from './windows/ShelfWindow';
import { QuickTargetWindow } from './windows/QuickTargetWindow';
import { QuickTargetService } from './quick-target/QuickTargetService';
import { ChromeTargetService } from './quick-target/ChromeTargetService';
import { QuickTargetPlatform } from './quick-target/QuickTargetPlatform';
import { QuickTargetRegistry } from './quick-target/QuickTargetRegistry';
import { WebsiteIconCache } from './quick-target/WebsiteIconCache';
import { fetchWebsiteIcon } from './quick-target/WebsiteIconFetch';
import { faviconImage } from './quick-target/FaviconImage';
import { QuickTargetPreferencesStore } from './storage/QuickTargetPreferencesStore';
import { clipboardMatchesQuickTarget, quickTargetClipboardMetadata } from './quick-target/clipboard-marker';
import { quickTargetId, quickTargetConfigureSchema, quickTargetPermissionSchema, quickTargetRenameSchema, quickTargetActivateSchema, quickTargetPresentationSchema, quickTargetInteractionSchema, type QuickTargetView } from '../shared/quick-target';
import { collectionOutputSchema, mergeOptionsSchema, mergeLayout, orderedOutputIds } from '../shared/collection-output';
import { exportCollectionPng } from './storage/CollectionExporter';
import { copyCollectionImages } from './storage/CollectionClipboard';
import { collectionOrderSchema } from '../shared/collection';
import { ScreenshotStore } from './storage/ScreenshotStore';
import { LegacyDataService } from './legacy/LegacyDataService';
import { AppearanceService } from './appearance';
import { platform, screenPermissionInfo } from './platform';
import { getLoginItemState, launchedAtLogin, setLoginItem } from './platform/login-item';
import { screenshotPerformance } from './performance/screenshot-performance';
import { DevCaptureLatencyLog } from './performance/DevCaptureLatencyLog';
import { CaptureOverlayWindow } from './windows/capture-overlay-window';
import { PinnedCaptureWindows } from './windows/PinnedCaptureWindows';
import { captureReadinessStrategies, type CaptureReadinessStrategy } from './capture/capture-readiness';
import { CaptureEngine } from './capture/capture-engine';
import { CaptureOutputQueue } from './capture/CaptureOutputQueue';
import { CapturePngEncoder } from './capture/CapturePngEncoder';
import { CaptureModeRouter } from './capture/CaptureModeRouter';
import { dispatchCaptureHotkey } from './capture/dispatch-capture-hotkey';
import { ElectronCaptureBackend } from './capture/electron-capture-backend';
import { ScreenCaptureKitBackend } from './capture/screen-capture-kit-backend';
import type { Rectangle } from 'electron';
import type { CaptureSession } from '../shared/capture-mode';
import type { CapturedFrame } from './capture/types';
import { UpdateCheckService } from './updates/UpdateCheckService';
import { ElectronUpdateInstaller } from './updates/ElectronUpdateInstaller';
import { version as sourceVersion } from '../../package.json';

let mainWindow: BrowserWindow;
let updates: UpdateCheckService;
let capturePreferences: CapturePreferencesStore;
let shelfPreferences: ShelfPreferencesStore;
let dragFiles: ScreenshotDragFiles | null = null;
export const appearance = new AppearanceService(() => mainWindow);
let captureOverlayWindow: CaptureOverlayWindow | null = null;
let shelfWindow: ShelfWindow | null = null;
let quickTargetWindow: QuickTargetWindow | null = null;
let quickTargetService: QuickTargetService | null = null;
let quickTargetRegistry: QuickTargetRegistry;
let websiteIcons: WebsiteIconCache;
let quickTargetViews: QuickTargetView[] = [];
let quickTargetSettingsEpoch = 0;
let quickTargetPickerBusy = false;
let quickTargetPermissionBusy = false;
let screenshotToAllWindow: PinnedCaptureWindows | null = null;
let captureOverlayPreloaded = false;
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
let activeShortcuts: CapturePreferences | null = null;
const localPins = new Map<string, { item: ScreenshotItem; performanceSessionId: string }>();
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
const captureLatencyLog = developmentSession && (process.env.SNIPVIA_CAPTURE_LATENCY_LOG === '1'
  || existsSync(join(app.getAppPath(), '.dev-runtime/capture-latency.enabled')))
  ? new DevCaptureLatencyLog(join(app.getAppPath(), '.dev-runtime/capture-latency.json')) : null;
function logCaptureLatency(sessionId: string | null | undefined, stage: string) {
  if (sessionId && captureLatencyLog) captureLatencyLog.record(screenshotPerformance.report(sessionId), stage);
}
if (process.platform === 'win32') app.setAppUserModelId('com.snipvia.desktop');
const webPreferences = { preload: join(__dirname, '../preload/index.js'), sandbox: true, contextIsolation: true, nodeIntegration: false };
export const screenshots = new ScreenshotStore(join(app.getPath('userData'), 'screenshots'));
export const collection = new ScreenshotCollection(screenshots);
export const legacyData = new LegacyDataService(app.getPath('userData'));
const captureDiagnostics = process.env.SNIPVIA_CAPTURE_DIAGNOSTICS === '1' || ['1', 'trace'].includes(process.env.SNIPVIA_PERF ?? '');
const captureLoopDelay = captureDiagnostics ? monitorEventLoopDelay({ resolution: 10 }) : null;
captureLoopDelay?.enable();
const captureDeviceMetadata = { platform: process.platform, architecture: process.arch, osRelease: release(), cpu: cpus()[0]?.model ?? 'unknown', electron: process.versions.electron };
const pngEncoder = new CapturePngEncoder();
const outputQueue = new CaptureOutputQueue({
  changed: state => { if (tray && !quitting) tray.setToolTip(state.failed ? '截然 — 复制/收纳失败，请在菜单中重试' : state.pending ? '截然 — 正在处理 ' + state.pending + ' 张截图' : '截然 — 轻量截图'); },
  failed: (id, error) => {
    screenshotPerformance.mark(id, 'output_failed');
    if (mainWindow && !quitting && !mainWindow.isDestroyed()) mainWindow.webContents.send('capture:error', (error instanceof Error ? error.message : '截图输出失败') + '；任务已保留，可在菜单中重试或放弃；原始帧失效时需重新截图');
  }
});
type RoutedImage = ({ image: NativeImage; action?: 'copy' | 'save' | 'pin' } | { frame: CapturedFrame; rect: Rectangle }) & { selection: Selection; display: CaptureDisplay };
const modeRouter = new CaptureModeRouter<RoutedImage>({
  quick: async (result, session) => { enqueueOutput(result.value, session); },
  collect: async (result, session) => { enqueueOutput(result.value, session); },
  edit: async (result, session) => {
    if (!('image' in result.value)) throw new Error('编辑截图数据无效');
    const { image, selection, display, action } = result.value;
    if (!action) throw new Error('请从编辑工具栏完成截图');
    const png = image.toPNG();
    if (action === 'save') {
      captureOverlayWindow!.pauseForDialog(session.id);
      try {
        const saved = await dialog.showSaveDialog({ title: '保存截图', defaultPath: join(app.getPath('pictures'), 'Snipvia-' + Date.now() + '.png'), filters: [{ name: 'PNG 图片', extensions: ['png'] }] });
        session.signal.throwIfAborted();
        if (saved.canceled || !saved.filePath) return false;
        await writeFile(saved.filePath, png);
        session.signal.throwIfAborted();
      } finally {
        captureOverlayWindow?.resumeAfterDialog(session.id);
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

function enqueueOutput(value: RoutedImage, session: CaptureSession) {
  session.signal.throwIfAborted();
  if (!('frame' in value)) throw new Error('截图原始帧无效');
  const { frame, rect, selection, display } = value;
  const pixels = frame.width * frame.height, selectedPixels = rect.width * rect.height;
  const bytes = pixels * (frame.original ? 4 : 8) + selectedPixels * 8 + 1024 * 1024;
  outputQueue.assertCapacity(bytes);
  let png: Buffer | undefined, originalReleased = false, feedbackGeneration = 0;
  const releaseOriginal = () => {
    if (originalReleased) return; originalReleased = true; frame.original?.release();
    frame.buffer = undefined; frame.image = undefined; frame.preview = undefined;
  };
  outputQueue.enqueue({
    id: session.id, bytes,
    run: async signal => {
      signal.throwIfAborted();
      if (!png) {
        screenshotPerformance.mark(session.id, 'output_encode_start');
        if (frame.original) png = await frame.original.png(rect, signal);
        else {
          const bitmap = frame.format === 'bgra' && frame.buffer ? frame.buffer : resolveCapturedFrameImage(frame, session.id).toBitmap();
          png = await pngEncoder.encode({ bytes: bitmap, width: frame.width, height: frame.height, rect }, signal);
        }
        screenshotPerformance.mark(session.id, 'output_encode_end'); releaseOriginal();
      }
      signal.throwIfAborted();
      if (session.mode === 'quick') {
        screenshotPerformance.mark(session.id, 'clipboard_write_start');
        const marker = quickTargetService?.enabled() ? randomUUID() : undefined;
        await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }),
          ...quickTargetClipboardMetadata(marker) })]);
        screenshotPerformance.mark(session.id, 'clipboard_committed');
        if (marker) quickTargetService?.copied(session.id, marker, display.workArea);
      } else {
        const item = screenshots.create(png, { width: rect.width, height: rect.height, mimeType: 'image/png' });
        try { collection.append(item.id); } catch (error) { screenshots.release(item.id); throw error; }
        screenshotPerformance.mark(session.id, 'collection_updated');
        if (generation === feedbackGeneration) shelfWindow?.collected(display, selection, item.id, session.id); else shelfWindow?.publish();
      }
    },
    release: () => { releaseOriginal(); png = undefined; }
  });
  // Transfer frame ownership to the accepted output before resetting the live session.
  capturedFrame = null;
  screenshotPerformance.mark(session.id, 'output_queued');
  const timing = cleanupOverlay(false, session.mode !== 'collect');
  screenshotPerformance.updateMetadata(session.id, timing);
  modeRouter.detach(session.id);
  feedbackGeneration = generation;
}

async function copyScreenshot(id: string, marker?: string) {
  const { bytes, item } = screenshots.image(id);
  await clipboard.write([new ClipboardItem({ [item.mimeType]: new Blob([new Uint8Array(bytes)], { type: item.mimeType }), ...quickTargetClipboardMetadata(marker) })]);
}
async function copyShelfOutput(write: (marker?: string) => Promise<void>) {
  const service = quickTargetService, id = randomUUID();
  service?.beginCopy(id);
  const marker = service?.enabled() ? randomUUID() : undefined;
  const bounds = shelfWindow?.peekWindow()?.getBounds();
  const area = (bounds ? screen.getDisplayMatching(bounds) : screen.getDisplayNearestPoint(screen.getCursorScreenPoint())).workArea;
  await write(marker);
  // Optional UI never joins the clipboard transaction or prepares a window here.
  if (marker) service?.copied(id, marker, area);
}
function closePinnedFlow(sessionId?: string) {
  const ids = sessionId ? [sessionId] : [...localPins.keys()];
  for (const id of ids) {
    const pin = localPins.get(id);
    localPins.delete(id);
    screenshotToAllWindow?.close(id);
    if (pin) { screenshots.unretain(pin.item.id, 'pin:' + id); screenshotPerformance.mark(id, 'capture_closed'); }
  }
}
async function presentPin(item: ScreenshotItem, selection: Selection, display: CaptureDisplay, sessionId: string) {
  if (!screenshotToAllWindow) throw new Error('钉图窗口尚未就绪');
  const { bytes } = screenshots.image(item.id);
  screenshots.retain(item.id, 'pin:' + sessionId);
  localPins.set(sessionId, { item, performanceSessionId: sessionId });
  try {
    await screenshotToAllWindow.present(sessionId, pinnedBounds(selection, display), {
      performanceSessionId: sessionId,
      capture: { id: item.id, width: item.width, height: item.height, createdAt: item.createdAt, dataUrl: 'data:' + item.mimeType + ';base64,' + bytes.toString('base64') }
    });
  } catch (error) { closePinnedFlow(sessionId); throw error; }
}
async function presentLocalPin(item: ScreenshotItem, selection: Selection, display: CaptureDisplay, sessionId: string) {
  if (!modeRouter.current(sessionId)) throw new Error('截图会话已结束');
  cleanupOverlay(false);
  await presentPin(item, selection, display, sessionId);
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
      screenshotToAllWindow?.suspend();
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
  developmentDockIconApplied = false;
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

let developmentDockIconApplied = false;
function applyDevelopmentDockIcon() {
  if (developmentDockIconApplied) return;
  if (process.platform !== 'darwin' || app.isPackaged) return;
  // NativeImage cannot decode ICNS; use the PNG exported from the same Mac source.
  // System permission dialogs use bundle resources, independently of this Dock override.
  const icon = nativeImage.createFromPath(join(app.getAppPath(), 'src', 'renderer', 'src', 'assets', 'snipvia-app-icon.png'));
  if (!icon.isEmpty() && app.dock) { app.dock.setIcon(icon); developmentDockIconApplied = true; }
}

function showMain() { restoreDock(); mainWindow.show(); mainWindow.focus(); }
function cleanupOverlay(cancelSession = true, resumeShelf = true) {
  const performanceSessionId = activeCapturePerformanceSessionId;
  const captureMode = performanceSessionId ? modeRouter.current(performanceSessionId)?.mode : undefined;
  const overlayWasActive = captureOverlayWindow?.isActive();
  generation++;
  captureController?.abort(new Error('截图已取消'));
  captureController = null;
  if (performanceSessionId) {
    captureMemoryBefore.delete(performanceSessionId);
    captureBenchmarkFrames.delete(performanceSessionId);
    if (cancelSession) modeRouter.cancel(performanceSessionId);
  }
  const closeStarted = performance.now();
  // Hiding a window does not deactivate its macOS application. Quick/Collect
  // have no foreground surface after exit: release the app before showing
  // the non-activating Shelf feedback. Edit/Pin keep their existing focus path.
  if (process.platform === 'darwin' && !quitting && overlayWasActive
    && (captureMode === 'quick' || captureMode === 'collect') && !mainWindow.isVisible()) app.hide();
  else shelfWindow?.hideSuspendedWindow();
  const shelfHiddenAt = performance.now();
  captureOverlayWindow?.hide();
  const overlayHiddenAt = performance.now();
  capturedFrame?.original?.release();
  capturedFrame = null;
  captureDisplay = null;
  preparing = false;
  if (resumeShelf) shelfWindow?.resume();
  if (!quitting) screenshotToAllWindow?.resume();
  const frameReleasedAt = performance.now();
  restoreDock();
  screenshotPerformance.mark(performanceSessionId, 'overlay_closed');
  logCaptureLatency(performanceSessionId, 'closed');
  return { shelfNativeHideOnExitMs: shelfHiddenAt - closeStarted, overlayCloseMs: overlayHiddenAt - shelfHiddenAt, frameReleaseMs: frameReleasedAt - overlayHiddenAt, dockRestoreMs: performance.now() - frameReleasedAt };
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

async function startCapture(trigger: CaptureTrigger = 'main', mode: CaptureMode = 'quick', requestedAt = performance.now()) {
  const performanceSessionId = screenshotPerformance.startSession({
    trigger,
    captureMode: mode,
    ...captureDeviceMetadata,
    mode: process.env.ELECTRON_RENDERER_URL ? 'DEV' : app.isPackaged ? 'PROD' : 'PROD build preview'
  }, requestedAt);
  // Local capture never waits for model or network configuration.
  if (trigger === 'hotkey') screenshotPerformance.mark(performanceSessionId, 'hotkey_pressed');
  screenshotPerformance.mark(performanceSessionId, 'capture_start');
  screenshotPerformance.updateMetadata(performanceSessionId, { nativeHotkeyDispatchMs: performance.now() - requestedAt, overlayPreloadedAtEntry: captureOverlayPreloaded, applicationHiddenAtCaptureStart: process.platform === 'darwin' && app.isHidden() });
  logCaptureLatency(performanceSessionId, 'start');
  screenshotPerformance.updateMetadata(performanceSessionId, { captureMode: mode, ...(captureLoopDelay ? { mainEventLoopDelayMaxMs: captureLoopDelay.max / 1e6 } : {}) });
  captureLoopDelay?.reset();
  if (preparing || captureOverlayWindow?.isActive()) {
    screenshotPerformance.mark(activeCapturePerformanceSessionId, 'capture_cancelled', 'main', { reason: 'superseded' });
    cleanupOverlay();
  }
  quickTargetService?.beginCapture(performanceSessionId);
  screenshotToAllWindow?.suspend();
  const shelfTiming = shelfWindow?.suspend();
  if (shelfTiming) screenshotPerformance.updateMetadata(performanceSessionId, shelfTiming);
  modeRouter.begin(performanceSessionId, mode);
  activeCapturePerformanceSessionId = performanceSessionId;
  const overlayReadyStarted = performance.now();
  if (!captureOverlayPreloaded) await captureOverlayReady;
  screenshotPerformance.updateMetadata(performanceSessionId, { overlayReadyWaitMs: performance.now() - overlayReadyStarted });
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
    // Electron's unchanged readiness backend owns its hide + paint barrier.
    // Native exclusion still hides settings here, once, before the early shell.
    if (captureBackendPreference() !== 'electron' && process.platform === 'darwin' && mainWindowWasVisible) mainWindow.hide();
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
      retainOriginal: mode !== 'edit',
      mainWindowWasVisible,
      signal: activeCaptureController.signal
    });
    if (captureController === activeCaptureController) captureController = null;
    if (session !== generation) { result.frame.original?.release(); return; }
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
    if (mode === 'collect') void shelfWindow?.prepare();
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

function registerShortcuts(settings: CapturePreferences) {
  const previous = activeShortcuts, keys = captureShortcutKeys;
  if (previous && keys.every(key => settings[key] === previous[key])) return;
  if (new Set(keys.map(key => acceleratorIdentity(settings[key], process.platform))).size !== keys.length) throw new Error('快捷键不能相同（包含 Ctrl / Control 等别名）');
  const captureHotkey = (mode: CaptureMode) => dispatchCaptureHotkey(mode,
    (selectedMode, requestedAt) => startCapture('hotkey', selectedMode, requestedAt), announceError);
  const callbacks = {
    shortcut: () => captureHotkey('quick'),
    editorShortcut: () => captureHotkey('edit'),
    collectShortcut: () => captureHotkey('collect'),
    collectionShortcut: () => { void shelfWindow?.toggle().catch(error => mainWindow.webContents.send('capture:error', String(error))); },
    clearCollectionShortcut: () => { void confirmClearCollection().catch(error => mainWindow.webContents.send('capture:error', String(error))); }
  };
  for (const key of keys) if (previous?.[key]) globalShortcut.unregister(previous[key]);
  const registered: string[] = [];
  try {
    for (const key of keys) {
      if (!globalShortcut.register(settings[key], callbacks[key])) throw new Error('快捷键 ' + settings[key] + ' 注册失败，请选择其他组合');
      registered.push(settings[key]);
    }
  } catch (error) {
    for (const accelerator of registered) globalShortcut.unregister(accelerator);
    let restored = true;
    for (const key of keys) if (previous?.[key] && !globalShortcut.register(previous[key], callbacks[key])) restored = false;
    if (!restored) { activeShortcuts = null; throw new Error('快捷键恢复失败，请使用菜单截图并重新设置快捷键'); }
    throw error;
  }
  activeShortcuts = { ...settings };
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
type WindowRole = 'main' | 'overlay' | 'pin' | 'shelf' | 'quick-target';

function windowForRole(role: WindowRole) {
  if (role === 'main') return mainWindow;
  if (role === 'shelf') return shelfWindow?.peekWindow() ?? null;
  if (role === 'quick-target') return quickTargetWindow?.peekWindow() ?? null;
  if (role === 'overlay') return captureOverlayWindow?.peekWindow() ?? null;
  return screenshotToAllWindow?.peekWindow() ?? null;
}

function senderAllowed(event: IpcMainInvokeEvent | Electron.IpcMainEvent, role: WindowRole | WindowRole[]) {
  const roles = Array.isArray(role) ? role : [role];
  return roles.some((item) => {
    const window = item === 'pin' ? screenshotToAllWindow?.forSender(event.sender)?.peekWindow() : windowForRole(item);
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

function screenshotThumbnail(id: string) {
  const image = nativeImage.createFromBuffer(screenshots.image(id).bytes);
  if (image.isEmpty()) throw new Error('截图无法预览');
  const size = image.getSize(), scale = Math.min(1, 768 / size.width, 512 / size.height);
  return image.resize({ width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)) }).toDataURL();
}

async function confirmClearCollection() {
  const revision = collection.snapshot().revision;
  if (!collection.getCount()) return shelfWindow!.current();
  const result = await dialog.showMessageBox({ type: 'question', title: '清空收纳区', message: '清空全部 ' + collection.getCount() + ' 张截图？', detail: '未导出的临时截图将被移除。已保存或预览中的图片仍会保留。', buttons: ['取消', '清空'], defaultId: 0, cancelId: 0, noLink: true });
  if (result.response === 1) collection.clear(true, revision);
  shelfWindow?.publish(); return shelfWindow!.current();
}
function selectedCollection(value: unknown) {
  const request = collectionOutputSchema.parse(value), snapshot = collection.snapshot();
  if (request.revision !== snapshot.revision) throw new Error('收纳区已变化，请重试输出');
  return { ids: orderedOutputIds(snapshot.items.map(item => item.id), request.ids), revision: snapshot.revision };
}
async function refreshQuickTargets() {
  quickTargetService?.dismiss();
  const epoch = ++quickTargetSettingsEpoch;
  const state = await quickTargetRegistry.settings();
  if (epoch === quickTargetSettingsEpoch) {
    quickTargetViews = state.targets;
    websiteIcons.configure(state.enabled ? quickTargetRegistry.store.current().targets.flatMap(target => target.kind === 'website' ? [target.url] : []) : []);
    const needsChrome = state.enabled && quickTargetRegistry.store.current().targets.some(target => target.kind === 'website' && target.mode === 'existing-tab');
    if (needsChrome) void quickTargetRegistry.platform.prepareBrowser().catch(() => {});
    else quickTargetRegistry.platform.disposeBrowser();
    if (state.enabled && state.targets.length && !quitting) void quickTargetWindow?.prepare();
    else quickTargetWindow?.destroy();
  }
  return state;
}
async function publishQuickTargetArtwork() {
  const epoch = quickTargetSettingsEpoch, state = await quickTargetRegistry.settings();
  if (quitting || epoch !== quickTargetSettingsEpoch) return;
  quickTargetViews = state.targets;
  quickTargetService?.updateArtwork(state.targets);
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('quick-target:settings-changed', state);
}
function setupIPC() {
  handle('quick-target:settings', 'main', () => quickTargetRegistry.settings());
  handle('quick-target:configure', 'main', async value => { quickTargetRegistry.store.configure(quickTargetConfigureSchema.parse(value)); return refreshQuickTargets(); });
  handle('quick-target:add-application', 'main', async () => {
    if (quickTargetPickerBusy) throw new Error('应用选择器已打开');
    if (!quickTargetRegistry.platform.supported()) throw new Error('应用切换组件尚未就绪');
    quickTargetPickerBusy = true;
    try {
      const selected = await dialog.showOpenDialog(mainWindow, { title: '添加快速切换应用', defaultPath: '/Applications', filters: [{ name: '应用程序', extensions: ['app'] }], properties: ['openFile'] });
      if (!selected.canceled && selected.filePaths.length === 1) await quickTargetRegistry.addApplication(selected.filePaths[0]);
      return refreshQuickTargets();
    } finally { quickTargetPickerBusy = false; }
  });
  handle('quick-target:add-website', 'main', async value => { quickTargetRegistry.addWebsite(value); return refreshQuickTargets(); });
  handle('quick-target:configure-browser', 'main', async value => { quickTargetRegistry.store.configureBrowser(value); return refreshQuickTargets(); });
  handle('quick-target:permissions', 'main', () => quickTargetRegistry.platform.permissions());
  handle('quick-target:request-permission', 'main', async value => {
    const kind = quickTargetPermissionSchema.parse(value);
    if (quickTargetPermissionBusy) throw new Error('权限请求正在进行，请先完成系统弹窗');
    quickTargetPermissionBusy = true;
    try { return await quickTargetRegistry.platform.requestPermission(kind); }
    finally { quickTargetPermissionBusy = false; }
  });
  handle('quick-target:open-permission-settings', 'main', async value => {
    const kind = quickTargetPermissionSchema.parse(value);
    if (process.platform !== 'darwin') throw new Error('此权限入口仅支持 macOS');
    await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?' + (kind === 'automation' ? 'Privacy_Automation' : 'Privacy_Accessibility'));
  });
  handle('quick-target:rename', 'main', async value => { const request = quickTargetRenameSchema.parse(value); quickTargetRegistry.store.rename(request.id, request.label); return refreshQuickTargets(); });
  handle('quick-target:remove', 'main', async value => { quickTargetRegistry.store.remove(quickTargetId.parse(value)); return refreshQuickTargets(); });
  handle('quick-target:current', 'quick-target', () => quickTargetService!.current());
  handle('quick-target:activate', 'quick-target', value => { const request = quickTargetActivateSchema.parse(value); return quickTargetService!.activate(request.presentationId, request.targetId, request.choiceId); });
  handle('quick-target:rendered', 'quick-target', value => { const request = quickTargetPresentationSchema.parse(value); return quickTargetService!.current().visible && quickTargetService!.current().presentationId === request.presentationId && quickTargetWindow!.rendered(request.presentationId); });
  handle('quick-target:interaction', 'quick-target', value => { const request = quickTargetInteractionSchema.parse(value); quickTargetService!.interaction(request.presentationId, request.active); });
  handle('quick-target:dismiss', 'quick-target', value => { const request = quickTargetPresentationSchema.parse(value); quickTargetService!.dismissPresentation(request.presentationId); });
  handle('quick-target:focus', 'main', () => quickTargetService!.current().visible && quickTargetWindow!.focus());
  handle('collection:configure', 'main', async value => {
    const configuration = shelfPreferences.configure(shelfPreferencesSchema.parse(value));
    const state = await shelfWindow!.configure(configuration);
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send('collection:changed', state);
    return state;
  });
  handle('collection:widen', 'shelf', value => { z.undefined().parse(value); return shelfWindow!.widen(); });
  handle('collection:reveal', 'shelf', value => { z.undefined().parse(value); return shelfWindow!.reveal(); });
  handle('collection:edge-finished', 'shelf', value => shelfWindow!.edgeFinished(z.number().int().nonnegative().parse(value)));
  handle('collection:open-preview', 'shelf', value => {
    const request = z.strictObject({ id: z.string().uuid(), source: z.strictObject({
      x: z.number().finite().min(-20000).max(20000), y: z.number().finite().min(-20000).max(20000),
      width: z.number().finite().positive().max(20000), height: z.number().finite().positive().max(20000)
    }) }).parse(value);
    collection.getItem(request.id); return shelfWindow!.openPreview(request.id, request.source);
  });
  handle('collection:close-preview', 'shelf', value => { z.undefined().parse(value); return shelfWindow!.closePreview(); });
  handle('collection:preview-finished', 'shelf', value => shelfWindow!.previewFinished(z.number().int().nonnegative().parse(value)));
  handle('collection:interaction', 'shelf', value => shelfWindow!.setPointerInteraction(z.boolean().parse(value)));
  handle('collection:resize', 'shelf', value => {
    const { commit, ...size } = shelfResizeSchema.parse(value);
    if (commit) shelfPreferences.save(size);
    return shelfWindow!.resize(size);
  });
  handle('collection:image', 'shelf', value => {
    const id = z.string().uuid().parse(value); collection.getItem(id);
    const image = screenshots.image(id); return { bytes: new Uint8Array(image.bytes), mimeType: image.item.mimeType };
  });
  handle('collection:copy-all', 'shelf', async value => {
    const { revision } = z.strictObject({ revision: z.number().int().nonnegative() }).parse(value);
    const snapshot = collection.snapshot();
    if (revision !== snapshot.revision) throw new Error('收纳区已变化，请重试复制');
    await copyShelfOutput(marker => copyCollectionImages(screenshots, snapshot.items.map(item => item.id), join(app.getPath('userData'), 'clipboard-files'), marker));
  });
  handle('collection:copy-merged', 'shelf', async value => {
    const request = z.strictObject({ ids: z.array(z.string().uuid()).min(1).max(32), revision: z.number().int().nonnegative(), options: mergeOptionsSchema,
      png: z.instanceof(Uint8Array).refine(bytes => bytes.length > 0 && bytes.length <= 64 * 1024 * 1024, '合并图片过大') }).parse(value);
    const { ids } = selectedCollection({ ids: request.ids, revision: request.revision });
    const layout = mergeLayout(ids.map(id => collection.getItem(id)), request.options);
    validateEditorPng(request.png, layout);
    const image = nativeImage.createFromBuffer(Buffer.from(request.png));
    if (image.isEmpty() || image.getSize().width !== layout.width || image.getSize().height !== layout.height) throw new Error('合并图片无效');
    await copyShelfOutput(marker => clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(request.png)], { type: 'image/png' }), ...quickTargetClipboardMetadata(marker) })]));
  });
  handle('collection:export', 'shelf', async value => {
    const request = selectedCollection(value);
    const result = await dialog.showOpenDialog({ title: '选择导出位置（会新建独立文件夹）', properties: ['openDirectory', 'createDirectory'] });
    if (result.canceled || !result.filePaths[0]) return null;
    const fresh = selectedCollection(request);
    return exportCollectionPng(screenshots, fresh.ids, result.filePaths[0]);
  });
  handle('collection:rendered', 'shelf', value => shelfWindow!.rendered(z.number().int().nonnegative().parse(value)));
  handle('collection:feedback-finished', 'shelf', value => shelfWindow!.feedbackFinished(z.number().int().nonnegative().parse(value)));
  handle('collection:hit-regions', 'shelf', value => { shelfWindow!.setHitRegions(z.array(z.object({ x: z.number().finite().min(-10000).max(10000), y: z.number().finite().min(-10000).max(10000), width: z.number().finite().nonnegative().max(10000), height: z.number().finite().nonnegative().max(10000) }).strict()).max(100).parse(value)); });
  handle('collection:reduced-motion', 'shelf', value => shelfWindow!.setReducedMotion(z.boolean().parse(value)));
  handle('collection:current', ['main', 'shelf'], value => { z.undefined().parse(value); return shelfWindow!.current(); });
  handle('collection:toggle', ['main', 'shelf'], value => { z.undefined().parse(value); return shelfWindow!.toggle(); });
  handle('collection:collapse', 'shelf', value => { z.undefined().parse(value); return shelfWindow!.collapse(); });
  handle('collection:hide', 'shelf', value => { z.undefined().parse(value); return shelfWindow!.hide(); });
  handle('collection:remove', 'shelf', value => { collection.remove(z.string().uuid().parse(value)); shelfWindow?.publish(); return shelfWindow!.current(); });
  handle('collection:reorder', 'shelf', value => {
    const request = collectionOrderSchema.parse(value);
    const id = screenshotPerformance.startSession({ trigger: 'shelf-reorder' });
    screenshotPerformance.mark(id, 'shelf_reorder_start'); collection.reorder(request.ids, request.revision); screenshotPerformance.mark(id, 'shelf_reorder_updated');
    shelfWindow?.recordInteraction(id); shelfWindow?.publish(); return shelfWindow!.current();
  });
  handle('collection:clear', ['main', 'shelf'], value => { z.undefined().parse(value); return confirmClearCollection(); });
  handle('collection:copy', 'shelf', async value => { const id = z.string().uuid().parse(value); collection.getItem(id); await copyShelfOutput(marker => copyScreenshot(id, marker)); });
  handle('collection:start-drag', 'shelf', (value, event) => {
    const { id, revision } = z.strictObject({ id: z.string().uuid(), revision: z.number().int().nonnegative() }).parse(value);
    const state = shelfWindow!.current();
    if (!state.expanded || state.hidden || state.suspended || state.preview || state.feedback || state.edge !== 'shown') throw new Error('请先展开收纳区再拖出图片');
    if (revision !== state.collection.revision) throw new Error('收纳区已变化，请重新拖动');
    collection.getItem(id);
    const icon = nativeImage.createFromDataURL(screenshotThumbnail(id));
    if (icon.isEmpty()) throw new Error('截图无法拖出');
    const iconSize = icon.getSize(), scale = Math.min(1, 96 / iconSize.width, 96 / iconSize.height);
    const dragIcon = icon.resize({ width: Math.max(1, Math.round(iconSize.width * scale)), height: Math.max(1, Math.round(iconSize.height * scale)) });
    const file = dragFiles!.prepare(id, screenshots);
    shelfWindow!.setPointerInteraction(true);
    try { event.sender.startDrag({ file, icon: dragIcon }); }
    finally { shelfWindow!.setPointerInteraction(false); }
  });
  handle('collection:thumbnail', 'shelf', value => {
    const id = z.string().uuid().parse(value); collection.getItem(id); return screenshotThumbnail(id);
  });
  handle('collection:preview', 'shelf', async value => {
    const item = collection.getItem(z.string().uuid().parse(value));
    if (preparing || captureOverlayWindow?.isActive()) throw new Error('请先完成截图');
    const sessionId = screenshotPerformance.startSession({ trigger: 'collection-preview' });
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    await presentPin(item, { x: 40, y: 80, width: item.width, height: item.height }, display, sessionId);
  });
  handle('updates:current', 'main', value => { z.undefined().parse(value); return updates.current(); });
  handle('updates:check', 'main', value => { z.undefined().parse(value); return updates.check(); });
  handle('updates:open-release', 'main', value => { z.undefined().parse(value); return updates.openRelease(); });
  handle('updates:download', 'main', value => { z.undefined().parse(value); return updates.download(); });
  handle('updates:restart-install', 'main', value => { z.undefined().parse(value); return updates.restartAndInstall(); });
  handle('appearance:set', 'main', value => appearance.setMode(value));
  handle('settings:get', 'main', () => capturePreferences.current());
  handle('settings:save-shortcuts', 'main', value => {
    const request = capturePreferencesSchema.parse({ ...capturePreferences.current(), ...z.record(z.string(), z.unknown()).parse(value) });
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
    if (value === 'shelf' && senderAllowed(event, 'shelf')) shelfWindow?.markReady();
    if (value === 'quick-target' && senderAllowed(event, 'quick-target')) quickTargetWindow?.markReady();
    if (value === 'pin' && senderAllowed(event, 'pin')) screenshotToAllWindow?.markRendererReady(event.sender);
  });
  ipcMain.on('performance:mark', (event, value: unknown) => {
    if (!senderAllowed(event, ['main', 'overlay', 'pin', 'shelf'])) return;
    const parsed = performanceMarkSchema.safeParse(value);
    if (!parsed.success) return;
    screenshotPerformance.mark(parsed.data.sessionId, parsed.data.event, 'renderer', parsed.data.metadata, parsed.data.sourceTimestampMs);
    if (parsed.data.event === 'capture_overlay_shell_visible') logCaptureLatency(parsed.data.sessionId, 'shell-painted');
  });
  handle('performance:report', ['main', 'overlay', 'pin', 'shelf'], (value) => screenshotPerformance.report(performanceSessionIdSchema.parse(value)));
  handle('performance:startup-report', ['main', 'overlay', 'pin', 'shelf'], () => startupPerformanceSessionId ? screenshotPerformance.report(startupPerformanceSessionId) : null);
  handle('performance:capture-backend-status', ['main', 'overlay', 'pin', 'shelf'], () => ({
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
    const memoryBeforeEncode = captureDiagnostics ? processMemorySnapshot().workingSetKb : 0;
    captureMemoryBefore.set(performanceSessionId, memoryBeforeEncode);
    screenshotPerformance.updateMetadata(performanceSessionId, {
      captureProcessMetricsEnabled: captureDiagnostics,
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
    const memoryAfterEncode = captureDiagnostics ? processMemorySnapshot().workingSetKb : 0;
    screenshotPerformance.updateMetadata(performanceSessionId, {
      captureFrameEncodedBytes: encodedBytes,
      captureFrameMemoryAfterEncodeKb: memoryAfterEncode,
      captureFrameMemoryEncodeDeltaKb: memoryAfterEncode - memoryBeforeEncode
    });
    return payload;
  });
  handle('capture:session-shell-rendered', 'overlay', (value) => {
    const sessionId = performanceSessionIdSchema.parse(value);
    const shown = captureOverlayWindow?.showShellSession(sessionId) ?? false;
    if (shown) logCaptureLatency(sessionId, 'shell');
    return shown;
  });
  handle('capture:session-rendered', 'overlay', (value) => captureOverlayWindow?.showRenderedSession(performanceSessionIdSchema.parse(value)) ?? false);
  handle('capture:session-visible', 'overlay', (value) => {
    const sessionId = performanceSessionIdSchema.parse(value);
    const visible = captureOverlayWindow?.markSessionVisible(sessionId) ?? false;
    if (visible) {
      const memoryVisible = captureDiagnostics ? processMemorySnapshot().workingSetKb : 0;
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
      logCaptureLatency(sessionId, 'visible');
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
    const frame = capturedFrame;
    screenshotPerformance.mark(requestedSessionId, 'capture_finish_main_received');
    screenshotPerformance.mark(requestedSessionId, 'selection_validation_start');
    const request = captureFinishSchema.parse(value);
    screenshotPerformance.mark(request.sessionId, 'selection_validation_end');
    if (request.sessionId !== activeCapturePerformanceSessionId) throw new Error('截图会话已失效');
    const selection = request.selection;
    const display = captureDisplay;
    screenshotPerformance.mark(request.sessionId, 'coordinate_conversion_start');
    const rect = cropRectangle(selection, view, { width: frame.width, height: frame.height });
    screenshotPerformance.mark(request.sessionId, 'coordinate_conversion_end');

    screenshotPerformance.updateMetadata(request.sessionId, {
      selectionXDip: selection.x,
      selectionYDip: selection.y,
      selectionWidthDip: selection.width,
      selectionHeightDip: selection.height,
      selectionWidthPx: rect.width,
      selectionHeightPx: rect.height
    });
    const mode = modeRouter.current(request.sessionId)!.mode;
    if (mode !== 'edit') await modeRouter.complete({ sessionId: request.sessionId, value: { frame, rect, selection, display } });
    else {
      const sourceFrame = resolveCapturedFrameImage(frame, request.sessionId);
      screenshotPerformance.mark(request.sessionId, 'crop_start');
      const selected = sourceFrame.crop(rect);
      screenshotPerformance.mark(request.sessionId, 'crop_end', 'main', { width: rect.width, height: rect.height });
      await modeRouter.complete({ sessionId: request.sessionId, value: { image: selected, selection, display } });
    }
  });
  const requestingPin = (event: IpcMainInvokeEvent) => {
    const id = screenshotToAllWindow?.sessionForSender(event.sender);
    const pin = id ? localPins.get(id) : undefined;
    if (!pin) throw new Error('置顶截图已结束');
    return pin;
  };
  handle('pin:current', 'pin', (_value, event) => {
    const pin = requestingPin(event), { item, bytes } = screenshots.image(pin.item.id);
    return { performanceSessionId: pin.performanceSessionId,
      capture: { id: item.id, createdAt: item.createdAt, width: item.width, height: item.height, dataUrl: 'data:' + item.mimeType + ';base64,' + bytes.toString('base64') } };
  });
  handle('pin:session-rendered', 'pin', (value, event) => screenshotToAllWindow?.showRenderedSession(performanceSessionIdSchema.parse(value), event.sender) ?? false);
  handle('pin:session-visible', 'pin', (value, event) => screenshotToAllWindow?.markSessionVisible(performanceSessionIdSchema.parse(value), event.sender) ?? false);
  handle('pin:close', 'pin', (_value, event) => closePinnedFlow(requestingPin(event).performanceSessionId));
  handle('pin:move', 'pin', (value, event) => {
    const request = z.strictObject({
      sessionId: performanceSessionIdSchema,
      x: z.number().finite().min(-100000).max(100000),
      y: z.number().finite().min(-100000).max(100000)
    }).parse(value);
    const pin = requestingPin(event);
    if (pin.performanceSessionId !== request.sessionId || preparing || captureOverlayWindow?.isActive()) throw new Error('钉图暂时不可移动');
    const window = screenshotToAllWindow?.forSender(event.sender)?.peekWindow();
    if (!window) throw new Error('钉图已关闭');
    const bounds = window.getBounds(), area = screen.getDisplayMatching({ ...bounds, x: Math.round(request.x), y: Math.round(request.y) }).workArea;
    const visibleWidth = Math.min(32, bounds.width), visibleHeight = Math.min(32, bounds.height);
    window.setPosition(
      Math.round(Math.max(area.x - bounds.width + visibleWidth, Math.min(area.x + area.width - visibleWidth, request.x))),
      Math.round(Math.max(area.y - bounds.height + visibleHeight, Math.min(area.y + area.height - visibleHeight, request.y)))
    );
  });
  handle('pin:copy', 'pin', async (_value, event) => {
    const pin = requestingPin(event);
    await copyScreenshot(pin.item.id);
    if (localPins.get(pin.performanceSessionId) === pin) closePinnedFlow(pin.performanceSessionId);
  });
}
function senderMayAccessScreenshot(id: string, event: IpcMainInvokeEvent) {
  const sessionId = screenshotToAllWindow?.sessionForSender(event.sender);
  return Boolean(sessionId && localPins.get(sessionId)?.item.id === id) || senderAllowed(event, 'main') && screenshots.list().some(item => item.id === id);
}
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
    try { loadSettings(); } catch { startupError = '设置文件读取失败，已使用默认值；原文件未修改。'; }
    capturePreferences = new CapturePreferencesStore(join(app.getPath('userData'), 'capture-preferences.json'), legacyCaptureShortcuts() ?? { shortcut: 'Control+1', editorShortcut: 'Control+3' });
    try { capturePreferences.load(); } catch { startupError += 'V2 快捷键配置读取失败，使用旧快捷键；原文件未修改。'; }
    shelfPreferences = new ShelfPreferencesStore(join(app.getPath('userData'), 'shelf-preferences.json'));
    dragFiles = new ScreenshotDragFiles(app.getPath('temp'));
    try { shelfPreferences.load(); } catch { startupError += '收纳区尺寸配置损坏，原文件已保留，使用默认尺寸。'; }
    const quickTargetStore = new QuickTargetPreferencesStore(join(app.getPath('userData'), 'quick-target-preferences.json'));
    try { quickTargetStore.load(); } catch { /* Preserve damaged config; the independent feature stays disabled. */ }
    const quickTargetPlatform = new QuickTargetPlatform(app.isPackaged ? join(process.resourcesPath, 'native', 'snipvia-quick-target-helper') : join(app.getAppPath(), 'build/native/snipvia-quick-target-helper'), process.platform,
      developmentSession && existsSync(join(app.getAppPath(), '.dev-runtime/quick-target-timing.enabled'))
        ? value => { if (['permissions', 'browser-list', 'browser-select', 'browser-resolve'].includes(value.operation)) console.info('[QuickTargetTiming]', JSON.stringify(value)); } : undefined);
    app.once('before-quit', () => quickTargetPlatform.disposeBrowser());
    const chromeTargetService = new ChromeTargetService(quickTargetPlatform);
    websiteIcons = new WebsiteIconCache(join(app.getPath('userData'), 'website-icons'),
      (origin, signal) => fetchWebsiteIcon(origin, signal, bytes => {
        const source = faviconImage(bytes); if (!source) return undefined;
        const image = source.kind === 'png' ? nativeImage.createFromBuffer(source.bytes)
          : nativeImage.createFromBitmap(source.bytes, { width: source.width, height: source.height });
        if (image.isEmpty()) return undefined;
        const size = image.getSize(), ratio = Math.min(68 / size.width, 68 / size.height);
        return image.resize({ width: Math.max(1, Math.round(size.width * ratio)), height: Math.max(1, Math.round(size.height * ratio)), quality: 'best' }).toDataURL();
      }), () => { void publishQuickTargetArtwork().catch(() => {}); });
    app.once('before-quit', () => websiteIcons.dispose());
    quickTargetRegistry = new QuickTargetRegistry(quickTargetStore, quickTargetPlatform, async path => process.platform === 'darwin'
      ? quickTargetPlatform.icon(path)
      : (await app.getFileIcon(path, { size: 'normal' })).resize({ width: 68, height: 68 }).toDataURL(), {
      website: url => websiteIcons.current(url),
      browser: async mode => process.platform === 'darwin' ? quickTargetPlatform.browserIcon(mode)
        : mode !== 'chrome' ? (await app.getApplicationInfoForProtocol(mode === 'http' ? 'http://example.invalid/' : 'https://example.invalid/')).icon.resize({ width: 68, height: 68 }).toDataURL() : undefined
    });
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
    logCaptureLatency(startupPerformanceSessionId, 'app-ready');
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
    screenshotToAllWindow = new PinnedCaptureWindows(webPreferences, loadWindow, startupPerformanceSessionId, id => closePinnedFlow(id));
    shelfWindow = new ShelfWindow(webPreferences, loadWindow, () => collection.snapshot(), id => screenshotThumbnail(id), shelfPreferences.current(), shelfPreferences.configuration());
    quickTargetWindow = new QuickTargetWindow(webPreferences, loadWindow, () => quickTargetService?.dismiss());
    quickTargetService = new QuickTargetService({
      preferences: () => quickTargetRegistry.store.current(), views: () => quickTargetViews,
      clipboardMatches: clipboardMatchesQuickTarget, ready: () => quickTargetWindow!.isReady(),
      present: (state, area) => quickTargetWindow!.present(state, area), update: state => quickTargetWindow!.update(state),
      hide: forCapture => {
        chromeTargetService.clear();
        const wasFocused = quickTargetWindow?.peekWindow()?.isFocused(); if (forCapture) quickTargetWindow?.suspend(); else quickTargetWindow?.hide();
        if (wasFocused && process.platform === 'darwin' && !mainWindow.isVisible() && !quitting) { app.hide(); shelfWindow?.resume(); screenshotToAllWindow?.resume(); }
      },
      activate: async (target, launch, signal, presentation, choiceId) => {
        signal.throwIfAborted();
        if (target.kind === 'application') await quickTargetPlatform.activate(target, launch, signal);
        else if (target.mode === 'existing-tab') return chromeTargetService.activate(target, presentation, choiceId, signal);
        else { await shell.openExternal(target.url); signal.throwIfAborted(); }
      }
    });
    writePackagedTestResult({ stage: 'window-managers-ready' });
    updates = new UpdateCheckService({
      currentVersion: app.isPackaged ? app.getVersion() : sourceVersion,
      openExternal: url => shell.openExternal(url),
      installer: new ElectronUpdateInstaller({
        beforeInstall: () => {
          quitting = true;
          quickTargetService?.dispose(); quickTargetWindow?.destroy();
          // Native Mac quitAndInstall closes windows before before-quit. These
          // reusable capture windows intercept close, so release only the idle
          // windows after the user confirms installation.
          captureOverlayWindow?.destroy();
          screenshotToAllWindow?.destroy();
          shelfWindow?.destroy();
        },
        onInstallError: () => {
          if (!mainWindow.isDestroyed()) { quitting = false; }
          updates.installationFailed();
        }
      }),
      prepareInstall: async () => {
        if (outputQueue.state().pending || outputQueue.state().failed) throw new Error('请先等待截图输出完成，或处理失败输出');
        if (preparing || captureOverlayWindow?.isActive()) throw new Error('请先完成当前截图');
      },
      onChanged: state => {
        if (!quitting && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.send('updates:changed', state);
      }
    });
    setupIPC();
    writePackagedTestResult({ stage: 'ipc-ready' });
    const captureMenu = [
      { label: '重试失败输出', click: () => outputQueue.retryFailed() },
      { label: '放弃失败输出…', click: () => { void dialog.showMessageBox({ type: 'warning', message: '放弃未完成的截图输出？', detail: '仅清除本次运行中保留的失败任务，不删除已保存截图。', buttons: ['保留', '放弃'], defaultId: 0, cancelId: 0 }).then(r => { if (r.response === 1) outputQueue.discardFailed(); }); } },
      { label: '选择截图目标', click: () => { if (quickTargetService?.current().visible) quickTargetWindow?.focus(); } },
      { label: '快速截图', click: () => { void startCapture('menu', 'quick').catch(announceError); } },
      { label: '收集截图', click: () => { void startCapture('menu', 'collect').catch(announceError); } },
      { label: '截图收纳区', click: () => { void shelfWindow?.toggle(); } },
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
      quickTargetService?.dismiss();
      shelfWindow?.relocate();
      void captureEngine?.invalidateDisplays();
      if (preparing || captureOverlayWindow?.isActive()) cleanupOverlay();
    });
    screen.on('display-removed', () => {
      quickTargetService?.dismiss();
      shelfWindow?.relocate();
      void captureEngine?.invalidateDisplays();
      if (preparing || captureOverlayWindow?.isActive()) cleanupOverlay();
    });
    screen.on('display-metrics-changed', (_event, _display, metrics) => {
      if (!metrics.some((metric) => ['bounds', 'scaleFactor', 'rotation'].includes(metric))) return;
      quickTargetService?.dismiss();
      shelfWindow?.relocate();
      void captureEngine?.invalidateDisplays();
      if (preparing || captureOverlayWindow?.isActive()) cleanupOverlay();
    });
    powerMonitor.on('resume', () => { void captureEngine?.invalidateDisplays(); });
    powerMonitor.on('unlock-screen', () => { void captureEngine?.invalidateDisplays(); });
    writePackagedTestResult({ stage: 'before-main-window-load' });
    await loadWindow(mainWindow);
    if (quitting) return; // A settings-only restart can quit before reusable windows begin loading.
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
        captureOverlayPreloaded = true;
        logCaptureLatency(startupPerformanceSessionId, 'overlay-ready');
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
    void refreshQuickTargets().catch(() => { /* Optional UI must never block capture startup. */ });
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
      // Allow native focus to settle: clicking a floating card must not open Settings.
      setImmediate(() => {
        if (quitting || preparing || captureOverlayWindow?.isActive() || shelfWindow?.hasPointerInteraction() || screenshotToAllWindow?.hasPointerInteraction() || quickTargetWindow?.hasPointerInteraction() || quickTargetService?.protectsActivation()) return;
        showMain();
      });
    });
  }).catch((error: unknown) => {
    if (quitting) return;
    const message = error instanceof Error ? error.message : '未知错误';
    writePackagedTestResult({ stage: 'startup-failed', error: message });
    dialog.showErrorBox('截然启动失败', message);
    app.quit();
  });
}
app.on('before-quit', () => {
  quitting = true;
  updates?.dispose();
  quickTargetService?.dispose(); quickTargetWindow?.destroy();
  outputQueue.dispose(); pngEncoder.dispose(); captureLoopDelay?.disable();
  if (preparing || captureOverlayWindow?.isActive()) cleanupOverlay();
  modeRouter.cancel();
  closePinnedFlow();
  captureOverlayWindow?.destroy();
  screenshotToAllWindow?.destroy();
  shelfWindow?.destroy();
  screenshots.dispose(); dragFiles?.dispose();
  void captureEngine?.dispose();
});
app.on('will-quit', () => globalShortcut.unregisterAll());
