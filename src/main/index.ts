import { EditingProposals } from './agent/editing/EditingProposals';
import { editingReferenceSchema, editingSelectionSchema, editingProposalSchema, editingApplySchema } from '../shared/agent/editing';
import { app, BrowserWindow, clipboard, ClipboardItem, desktopCapturer, dialog, globalShortcut, ipcMain, Menu, nativeImage, Notification, powerMonitor, screen, shell, Tray, type IpcMainInvokeEvent, type NativeImage } from 'electron';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { stat, writeFile, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { cpus, release } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { calendarSaveSchema, captureFinishSchema, chatSchema, reminderSaveSchema, saveSettingsSchema, scheduleSaveSchema, type Capture, type CaptureMode, type Selection, type CaptureFramePayload, type CaptureFrameQuality, type CaptureFrameTransport, type Message, type ModelProfile, type Result, type Settings } from '../shared/contracts';
import { performanceMarkSchema, performanceSessionIdSchema } from '../shared/performance';
import { chatStreamRequestSchema, type AutoActionSnapshot, type ChatStreamEvent, type ScreenshotActionId } from '../shared/screenshot-understanding';
import { editorFinishSchema, validateEditorPng } from '../shared/screenshot-editor';
import { cropRectangle } from '../shared/geometry';
import { renameConversation, clearConversations, createConversation, deleteConversation, listConversations, capturedConversations, loadHistory, readConversation, readWorkspaceConversation, createTextConversation, replaceConversationCapture, recordAppliedProposal, saveConversationAnswer, saveConversationMessages } from './storage/history';
import { PredictionSettingsStore } from './storage/prediction-settings';
import { savePredictionSettingsSchema } from '../shared/prediction-settings';
import { loadSettings, publicSettings, readKey, saveSettings, savePredictionBranches } from './storage/settings';
import { AppearanceService } from './appearance';
import { ModelCatalog } from './ai/models/ModelCatalog';
import { modelAddRequestSchema, modelListRequestSchema, modelTestRequestSchema } from '../shared/models';
import { askModel, extractScheduleEvents, streamModel } from './ai/provider';
import { PredictionService } from './analysis/PredictionService';
import { PredictionError } from './analysis/PredictionError';
import { platform, screenPermissionInfo } from './platform';
import { getLoginItemState, launchedAtLogin, setLoginItem } from './platform/login-item';
import { completeScheduleJob, createScheduleJob, deleteScheduleJob, failScheduleJob, listScheduleJobs, loadSchedule, markMacReminderSaved, markMacSaved, readScheduleJob, saveScheduleEvent } from './storage/schedule';
import { createMacCalendarEvent, createMacReminder, listMacCalendars, listMacReminderLists } from './calendar/mac-calendar';
import { screenshotPerformance } from './performance/screenshot-performance';
import { CaptureOverlayWindow } from './windows/capture-overlay-window';
import { ScreenshotToAllWindow } from './windows/screenshot-to-all-window';
import { quickChatBounds, quickWorkspaceBounds } from './windows/quick-chat-placement';
import { captureReadinessStrategies, type CaptureReadinessStrategy } from './capture/capture-readiness';
import { CaptureEngine } from './capture/capture-engine';
import { ElectronCaptureBackend } from './capture/electron-capture-backend';
import { ScreenCaptureKitBackend } from './capture/screen-capture-kit-backend';
import type { CapturedFrame } from './capture/types';
import { ScreenshotAnalyzer } from './analysis/screenshot-analyzer';
import { autoActionRouter } from './analysis/auto-action-router';
import { createFileToolSystem } from './agent/createFileToolSystem';
import { createPermissionPrompt } from './agent/approval/createPermissionPrompt';
import { FilePermissionGrantStore } from './agent/permissions/PermissionGrantStore';
import { registerWebTools } from './agent/registerWebTools';
import { defaultSearchProvider } from './agent/web/defaultSearchProvider';
import { WebIconService } from './agent/web/WebIconService';
import { MCPManager } from './agent/mcp/MCPManager';
import { loadMCPConfig } from './agent/mcp/config';
import { AgentExecutionService } from './agent/ui/AgentExecutionService';
import { ChatCompletionsAgentProvider } from './ai/llm/ChatCompletionsAgentProvider';
import { agentWorkspaceSchema, agentWorkspaceStartSchema, agentWorkspaceStopSchema, agentNotebookSchema, agentCaptureSchema, agentDecisionSchema, agentDiffSchema, agentRunSchema, agentStartSchema, agentSourceIconSchema } from '../shared/agent/execution';
import { NotebookService } from './notes/NotebookService';
import { registerNotesIPC } from './notes/registerNotesIPC';
import { NotebookWriter } from './agent/notes/NotebookWriter';
import { NoteCheckpointStore, checkpointDiff, undoCheckpoint, undoState } from './agent/notes/NoteCheckpoints';
import { AgentSessionStore } from './agent/AgentSessionStore';
import { ToolError, throwIfAborted } from './agent/ToolError';
import { agentNoteChangeSchema } from '../shared/agent/execution';
import { UpdateCheckService } from './updates/UpdateCheckService';
import { ElectronUpdateInstaller } from './updates/ElectronUpdateInstaller';
import { version as sourceVersion } from '../../package.json';
import { ChatImages } from './chat/ChatImages';
import { normalizeChatImage } from './chat/image-validation';
import { providerImages } from './chat/provider-images';
import { conversationRenameSchema } from '../shared/history';
import { chatImageLimits, chatImageBindSchema, chatImageScopeSchema, chatImageReferenceSchema, chatImageImportSchema, chatImageCaptureSchema } from '../shared/chat-images';

export const chatImages = new ChatImages(normalizeChatImage);

let mainWindow: BrowserWindow;
let updates: UpdateCheckService;
let modelCatalog: ModelCatalog;
export const appearance = new AppearanceService(() => mainWindow);
let captureOverlayWindow: CaptureOverlayWindow | null = null;
let screenshotToAllWindow: ScreenshotToAllWindow | null = null;
let quickChatWindow: BrowserWindow | null = null;
let quickChatLoading: Promise<void> | null = null;
let quickChatReady: { windowId: number; resolve: () => void } | null = null;
const noteFlushRequests = new Map<string, (success: boolean) => void>();
let quickChatExpanded = false;
let quickChatCompactSize = { width: 440, height: 400 };
let quickChatUserSize: { width: number; height: number } | null = null;
let positioningQuickChat = false;
let resolveCaptureOverlayReady: (() => void) | null = null;
let rejectCaptureOverlayReady: ((error: unknown) => void) | null = null;
const captureOverlayReady = new Promise<void>((resolve, reject) => {
  resolveCaptureOverlayReady = resolve;
  rejectCaptureOverlayReady = reject;
});
let reusableWindowsReady: Promise<void> = Promise.resolve();
let startupPerformanceSessionId: string | null = null;
let tray: Tray;
let capturedFrame: CapturedFrame | null = null;
let view = { width: 1, height: 1 };
let captureDisplay: { bounds: Electron.Rectangle; workArea: Electron.Rectangle } | null = null;
let capture: Capture | null = null;
let pinnedCaptureId: string | null = null;
let pinnedJpeg: Buffer | null = null;
let pinnedScheduleJobId: string | null = null;
let activeCapturePerformanceSessionId: string | null = null;
let pinnedPerformanceSessionId: string | null = null;
let conversationMessages: Message[] = [];
let currentConversationId: string | null = null;
let controller: AbortController | null = null;
let autoActionController: AbortController | null = null;
let autoActionSnapshot: AutoActionSnapshot | null = null;
let autoActionOcrText = '';
let preparing = false;
let generation = 0;
let captureController: AbortController | null = null;
let capturePermissionGranted = false;
let quitting = false;
let notesQuitReady = false;
let notesQuitRequest: string | null = null;
let notesQuitTimer: NodeJS.Timeout | undefined;
let shortcut = '';
let continueShortcut = '';
let editorShortcut = '';
let localPin: { capture: Capture; png: Buffer } | null = null;
const editorFinishing = new Set<string>();
type CaptureIntent = { kind: 'standard' } | { kind: 'new' } | { kind: 'continue'; conversationId: string };
const captureIntents = new Map<string, CaptureIntent>();
let desktopCaptureWarmupPromise: Promise<void> | null = null;
let captureEngine: CaptureEngine | null = null;
let screenCaptureKitBackend: ScreenCaptureKitBackend | null = null;
const scheduleControllers = new Map<string, AbortController>();
const captureMemoryBefore = new Map<string, number>();
const captureBenchmarkFrames = new Map<string, { source: NativeImage; encoded: Buffer }>();
const developmentSession = !app.isPackaged && Boolean(process.env.ELECTRON_RENDERER_URL) && !process.argv.some((arg) => arg.startsWith('--user-data-dir='));
const defaultCaptureReadinessStrategy: CaptureReadinessStrategy = 'hide-event-16';
const defaultCaptureFrameTransport: CaptureFrameTransport = 'jpeg-95';
const defaultCaptureVisibilityRafCount = 1 as const;

// Keep the live development build separate from an installed Snipvia app.
// Preserve the packaged app's original name and stable userData location.
if (developmentSession) {
  app.setName('截然 Dev');
  const developmentData = join(app.getPath('appData'), 'snipvia-dev');
  mkdirSync(developmentData, { recursive: true });
  app.setPath('userData', developmentData);
}

if (process.platform === 'win32') app.setAppUserModelId('com.snipvia.desktop');

const webPreferences = { preload: join(__dirname, '../preload/index.js'), sandbox: true, contextIsolation: true, nodeIntegration: false };
export const notebooks = new NotebookService(join(app.getPath('userData'), 'notebooks.json'), (path) => shell.trashItem(path), (id) => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('notes:changed', id);
});
// Main owns tools, workspace capabilities and execution; Renderer only sends chat intent and approval decisions.
const predictionSettingsStore = new PredictionSettingsStore(join(app.getPath('userData'), 'prediction-settings.json'));
const agentPermissionDirectory = join(app.getPath('userData'), 'agent-permissions');
const agentMCPDirectory = join(app.getPath('userData'), 'mcp');
// Old account data is never read or decrypted, but stays protected from Agent tools.
const legacyAccountDirectory = join(app.getPath('userData'), 'account');
const agentCheckpointDirectory = join(app.getPath('userData'), 'agent-checkpoints');
export const noteCheckpoints = new NoteCheckpointStore(agentCheckpointDirectory);
export const agentFileTools = createFileToolSystem({
  readOnly: true, editing: true,
  ...(process.platform === 'darwin' ? { commands: { protectedPaths: [app.getPath('userData'), app.getAppPath()] } } : {}),
  notebookWriter: (workspaces) => new NotebookWriter({ workspaces,
    notebook: (id) => notebooks.authorizedNotebook(id),
    beforeWrite: async (_id, signal) => {
      await flushNotesForAgent(signal);
    },
    review: async (preview, signal, options) => {
      const receipt = await agentFileTools.permissions.request(preview, signal, { ...options, singleUse: true, toolName: 'edit_note' });
      agentFileTools.permissions.consume(receipt, preview);
    },
    changed: (id) => notebooks.notifyChanged(id)
  }),
  store: new FilePermissionGrantStore(join(agentPermissionDirectory, 'grants.json')),
  protectedDirectories: [agentPermissionDirectory, agentMCPDirectory, legacyAccountDirectory, agentCheckpointDirectory],
  prompt: (request, signal) => agentExecution?.permissionPrompt(request, signal) ?? createPermissionPrompt({
    webPreferences, parent: () => mainWindow, load: (window) => loadWindow(window, 'agent-permission'),
    clearRemembered: async () => { await agentFileTools.permissions.clearRemembered(); }
  })(request, signal)
});
export const agentWebTools = registerWebTools(agentFileTools.registry, {
  searchProvider: defaultSearchProvider()
});
export const agentSourceIcons = new WebIconService((bytes) => {
  const image = nativeImage.createFromBuffer(bytes);
  const size = image.getSize();
  if (image.isEmpty() || size.width > 256 || size.height > 256) return null;
  return image.resize({ width: 32, height: 32 }).toDataURL();
});
export const agentMCP = new MCPManager(agentFileTools.registry, agentFileTools.permissions, {
  onStatus: (status) => {
    if (status.state === 'failed') console.warn('[Snipvia MCP]', status.server, status.errorCode);
    else if (status.state === 'connected' && status.rejectedTools) console.warn('[Snipvia MCP]', status.server, `已跳过 ${status.rejectedTools} 个不支持的工具`);
  }
});
export const editingProposals = new EditingProposals({
  workspaces: agentFileTools.workspaces,
  book: id => notebooks.authorizedNotebook(id), books: async () => (await notebooks.state()).notebooks.map(({ id, name }) => ({ id, name })),
  profile: () => profileFrom(publicSettings()), branches: () => publicSettings().predictionBranches,
  exists: id => { readWorkspaceConversation(id, false); },
  busy: () => agentExecution?.busy || !!controller || !!autoActionController,
  beforeWrite: async signal => { await flushNotesForAgent(signal); },
  saveBranches: (before, after) => {
    if (agentExecution.busy || controller || autoActionController) throw new Error('截图预测或对话正在执行，请稍后保存规则');
    const settings = savePredictionBranches(before, after);
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send('settings:changed', settings);
    if (quickChatWindow && !quickChatWindow.isDestroyed()) quickChatWindow.webContents.send('settings:changed', settings);
  },
  notify: (conversationId, snapshot) => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('editing:changed', { conversationId, snapshot }); },
  applied: async (conversationId, summary, change, sides) => {
    const next = recordAppliedProposal(conversationId, summary, change ? [change] : undefined);
    if (conversationId === currentConversationId) conversationMessages = next;
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send('history:changed');
    if (sides && change) {
      notebooks.notifyChanged(change.notebookId);
      await noteCheckpoints.save({ id: summary.id, conversationId, notebookId: sides.book.id, notebookDirectory: sides.book.directory,
        files: [{ summary: change, before: { path: sides.before.path, content: sides.before.content, bom: sides.before.bom }, after: { path: sides.after.path, content: sides.after.content, bom: sides.after.bom }, restorable: true, diff: { path: sides.before.path, diff: sides.diff, truncated: false } }] });
    }
  }
});
const agentExecution: AgentExecutionService = new AgentExecutionService({
  ...agentFileTools, editing: editingProposals,
  context: (captureId) => {
    if (typeof captureId !== 'string') {
      const conversation = readWorkspaceConversation(captureId.conversationId, false);
      return { conversationId: conversation.id, readOnly: true, profile: profileFrom(publicSettings()), messages: conversation.messages };
    }
    if (!capture || capture.id !== captureId || !currentConversationId) throw new Error('截图已失效，请重新选择');
    const prediction = autoActionSnapshot?.captureId === captureId && autoActionSnapshot.analysis
      ? { contentType: autoActionSnapshot.analysis.contentType, actionId: autoActionSnapshot.actionId } : undefined;
    return { captureId, conversationId: currentConversationId, image: capture.dataUrl, profile: profileFrom(publicSettings()), messages: conversationMessages.map((message) => ({ ...message })), prediction };
  },
  provider: context => {
    if (!context.readOnly) return new ChatCompletionsAgentProvider({ ...publicSettings(), ...context.profile }, readKey(context.profile), context.image);
    const vision = modelCatalog.vision(context.profile, context.profile.model);
    const input = providerImages(context.images ?? [], context.messages, vision, image => chatImages.data(image));
    context.imageNotice = input.notice;
    const source = vision !== 'unsupported' && !input.images.current.length && !context.messages.some(message => message.images?.length) ? readWorkspaceConversation(context.conversationId).capture?.dataUrl : undefined;
    return new ChatCompletionsAgentProvider({ ...publicSettings(), ...context.profile }, readKey(context.profile), source, fetch, input.images);
  },
  finished: context => chatImages.release(context.images ?? []),
  beforeStart: () => {
    if (editingProposals.isApplying) throw new Error('请等待修改保存完成');
    if (controller) throw new Error('请先停止当前回答');
    if (autoActionController || autoActionSnapshot?.state === 'awaiting_input') abortAutoAction('用户开始 Agent 任务');
  },
  save: (context, question, answer, sources, noteChanges) => {
    const rollback = chatImages.persist(context.images ?? []);
    let next: Message[];
    try {
      next = saveConversationAnswer(context.conversationId, question, answer, context.profile,
        { images: context.images, sources, noteChanges, editProposals: context.editProposals, ...(context.regenerate ? { replaceMessages: context.originalMessages } : {}) });
    } catch (error) { rollback(); throw error; }
    chatImages.committed(context.images ?? []);
    if (currentConversationId === context.conversationId) conversationMessages = next;
    if (!mainWindow?.isDestroyed()) mainWindow.webContents.send('history:changed');
  },
  checkpoint: (input) => noteCheckpoints.save(input),
  sessions: new AgentSessionStore(join(app.getPath('userData'), 'agent-sessions'))
});
export { agentExecution };
const conversationIdSchema = z.string().uuid();

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

function profileFrom(settings: Settings): ModelProfile {
  return { provider: settings.provider, endpoint: settings.endpoint, model: settings.model };
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
      if (screenshotToAllWindow?.isActive()) closePinnedFlow(true);
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
function showSchedule() { showMain(); mainWindow.webContents.send('schedule:navigate'); }
function cleanupOverlay() {
  const performanceSessionId = activeCapturePerformanceSessionId;
  generation++;
  captureController?.abort(new Error('截图已取消'));
  captureController = null;
  if (performanceSessionId) {
    captureMemoryBefore.delete(performanceSessionId);
    captureBenchmarkFrames.delete(performanceSessionId);
    captureIntents.delete(performanceSessionId);
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

async function flushNotesForAgent(signal: AbortSignal) {
  throwIfAborted(signal);
  if (!mainWindow || mainWindow.isDestroyed()) throw new ToolError('FILE_BUSY', '笔记编辑器不可用');
  await new Promise<void>((resolve, reject) => {
    const id = randomUUID();
    const cleanup = () => { clearTimeout(timer); noteFlushRequests.delete(id); signal.removeEventListener('abort', aborted); };
    const aborted = () => { cleanup(); reject(new ToolError('ABORTED', '笔记写入已取消')); };
    const timer = setTimeout(() => { cleanup(); reject(new ToolError('FILE_BUSY', '未能确认笔记保存，请先处理编辑器中的未保存内容')); }, 8000);
    noteFlushRequests.set(id, (success) => { cleanup(); if (success) resolve(); else reject(new ToolError('FILE_CONFLICT', '笔记存在保存冲突，请先处理当前编辑')); });
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) { aborted(); return; }
    mainWindow.webContents.send('notes:flush-request', id);
  });
}

function prepareImage(image: NativeImage, performanceSessionId?: string) {
  if (image.isEmpty()) throw new Error('图片为空或格式不支持');
  const size = image.getSize();
  screenshotPerformance.mark(performanceSessionId, 'resize_start', 'main', { width: size.width, height: size.height });
  const bounded = Math.max(size.width, size.height) > 2400
    ? image.resize(size.width >= size.height ? { width: 2400 } : { height: 2400 }) : image;
  const boundedSize = bounded.getSize();
  screenshotPerformance.mark(performanceSessionId, 'resize_end', 'main', {
    applied: bounded !== image,
    width: boundedSize.width,
    height: boundedSize.height
  });
  screenshotPerformance.mark(performanceSessionId, 'jpeg_encode_start');
  const jpeg = bounded.toJPEG(90);
  screenshotPerformance.mark(performanceSessionId, 'jpeg_encode_end', 'main', { bytes: jpeg.byteLength });
  screenshotPerformance.mark(performanceSessionId, 'base64_check_start');
  const dataUrl = `data:image/jpeg;base64,${jpeg.toString('base64')}`;
  screenshotPerformance.mark(performanceSessionId, 'base64_check_end', 'main', { characters: dataUrl.length });
  if (dataUrl.length > 12 * 1024 * 1024) throw new Error('图片过大，请缩小选区');
  return { bounded, jpeg, dataUrl, captureData: { id: randomUUID(), ...boundedSize, createdAt: new Date().toISOString() } };
}

function acceptImage(image: NativeImage, notifyMain = true, performanceSessionId?: string, continuationConversationId?: string) {
  controller?.abort();
  agentExecution?.cancelAll();
  const { jpeg, captureData } = prepareImage(image, performanceSessionId);
  screenshotPerformance.mark(performanceSessionId, 'history_create_start');
  const conversation = continuationConversationId
    ? replaceConversationCapture(continuationConversationId, captureData, jpeg, performanceSessionId)
    : createConversation(captureData, jpeg, profileFrom(publicSettings()), performanceSessionId);
  screenshotPerformance.mark(performanceSessionId, 'history_create_end');
  capture = { ...conversation.capture, ...(performanceSessionId ? { performanceSessionId } : {}) };
  conversationMessages = conversation.messages.map((message) => ({ ...message }));
  currentConversationId = conversation.id;
  activeCapturePerformanceSessionId = performanceSessionId ?? null;
  if (notifyMain) mainWindow.webContents.send('capture:changed', capture);
  return { capture, jpeg };
}

function discardPinnedConversation(force = false) {
  if (!pinnedCaptureId || capture?.id !== pinnedCaptureId || (!force && conversationMessages.length > 0)) return;
  if (capture.continuesConversation) return;
  if (currentConversationId) {
    try { deleteConversation(currentConversationId); } catch { /* The transient capture can still be cleared from memory. */ }
  }
  capture = null;
  currentConversationId = null;
  conversationMessages = [];
  if (activeCapturePerformanceSessionId === pinnedPerformanceSessionId) activeCapturePerformanceSessionId = null;
}

function clearPinnedFlow(discardEmpty: boolean) {
  autoActionController?.abort(new Error('截图流程已结束'));
  autoActionController = null;
  const chat = quickChatWindow;
  quickChatWindow = null;
  quickChatExpanded = false;
  quickChatCompactSize = { width: 440, height: 400 };
  quickChatUserSize = null;
  if (chat && !chat.isDestroyed()) chat.destroy();
  if (discardEmpty) discardPinnedConversation();
  pinnedCaptureId = null;
  pinnedJpeg = null;
  localPin = null;
  pinnedScheduleJobId = null;
  pinnedPerformanceSessionId = null;
  autoActionSnapshot = null;
  autoActionOcrText = '';
}

function closePinnedFlow(discardEmpty = true) {
  const performanceSessionId = pinnedPerformanceSessionId;
  controller?.abort(new Error('截图流程已结束'));
  autoActionController?.abort(new Error('截图流程已结束'));
  autoActionController = null;
  screenshotToAllWindow?.hide();
  clearPinnedFlow(discardEmpty);
  screenshotPerformance.mark(performanceSessionId, 'capture_closed');
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

function positionQuickChat() {
  const pinnedWindow = screenshotToAllWindow?.peekWindow();
  if (!pinnedWindow || !screenshotToAllWindow?.isActive() || !quickChatWindow || quickChatWindow.isDestroyed()) return;
  const pinned = pinnedWindow.getBounds();
  const workArea = screen.getDisplayMatching(pinned).workArea;
  const chat = quickChatWindow;
  const current = chat.getBounds();
  const target = quickChatExpanded
    ? quickWorkspaceBounds(workArea, quickChatUserSize ?? current)
    : quickChatBounds(pinned, workArea, quickChatUserSize ?? current);
  if (current.x !== target.x || current.y !== target.y || current.width !== target.width || current.height !== target.height) {
    // On Windows with fractional display scaling, even setPosition() can grow
    // a frameless window. Reapply the last user-selected size on every move.
    positioningQuickChat = true;
    try { chat.setBounds(target); } finally { positioningQuickChat = false; }
  }
}

async function ensureQuickChatWindow() {
  if (quickChatWindow && !quickChatWindow.isDestroyed()) {
    const existing = quickChatWindow;
    await quickChatLoading;
    if (quickChatWindow !== existing || existing.isDestroyed()) throw new Error('对话窗口已关闭');
    return existing;
  }
  const performanceSessionId = pinnedPerformanceSessionId ?? activeCapturePerformanceSessionId ?? startupPerformanceSessionId;
  screenshotPerformance.mark(performanceSessionId, 'quick_chat_window_create_start');
  quickChatWindow = new BrowserWindow({ width: 440, height: 400, minWidth: 340, minHeight: 360, frame: false, transparent: true, show: false, resizable: true,
    maximizable: false, fullscreenable: false, alwaysOnTop: true, skipTaskbar: true, hasShadow: true,
    backgroundColor: '#00000000', webPreferences: webPreferencesFor(performanceSessionId) });
  screenshotPerformance.mark(performanceSessionId, 'quick_chat_window_create_end');
  quickChatWindow.setAlwaysOnTop(true, 'floating');
  if (process.platform === 'darwin') quickChatWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  const chat = quickChatWindow;
  const owner = chat.webContents.id;
  chat.webContents.once('destroyed', () => agentExecution.detach(owner));
  const initialSize = chat.getBounds();
  quickChatUserSize = { width: initialSize.width, height: initialSize.height };
  chat.on('will-resize', (_event, newBounds) => {
    if (quickChatWindow === chat && !positioningQuickChat) quickChatUserSize = { width: newBounds.width, height: newBounds.height };
  });
  chat.webContents.on('render-process-gone', () => {
    controller?.abort(new Error('对话窗口已关闭'));
    abortAutoAction('对话窗口已关闭');
  });
  chat.on('closed', () => {
    if (quickChatWindow !== chat) return;
    quickChatWindow = null;
    quickChatUserSize = null;
    const currentPinnedWindow = screenshotToAllWindow?.peekWindow();
    if (currentPinnedWindow && screenshotToAllWindow?.isActive()) {
      if (quickChatExpanded) currentPinnedWindow.showInactive();
      currentPinnedWindow.webContents.send('pin:chat-state', false);
    }
    quickChatExpanded = false;
  });
  screenshotPerformance.mark(performanceSessionId, 'quick_chat_load_start');
  chat.webContents.once('did-finish-load', () => screenshotPerformance.mark(performanceSessionId, 'quick_chat_did_finish_load'));
  const ready = new Promise<void>(resolve => { quickChatReady = { windowId: chat.id, resolve }; });
  chat.once('closed', () => { if (quickChatReady?.windowId === chat.id) { quickChatReady.resolve(); quickChatReady = null; } });
  const loading = loadWindow(chat, 'quick-chat').then(() => ready);
  quickChatLoading = loading;
  try { await loading; }
  catch (error) { if (!chat.isDestroyed()) chat.destroy(); throw error; }
  finally { if (quickChatLoading === loading) quickChatLoading = null; }
  if (quickChatWindow !== chat || chat.isDestroyed()) throw new Error('对话窗口已关闭');
  return chat;
}

async function showQuickChat(focus = true) {
  const pinnedWindow = screenshotToAllWindow?.peekWindow();
  const captureId = pinnedCaptureId;
  if (!pinnedWindow || !screenshotToAllWindow?.isActive() || !capture || capture.id !== captureId) throw new Error('置顶截图已结束');
  const chat = await ensureQuickChatWindow();
  if (!screenshotToAllWindow?.isActive() || capture?.id !== captureId || pinnedCaptureId !== captureId) return;
  chat.webContents.send('capture:changed', capture);
  positionQuickChat();
  if (focus) { chat.show(); chat.focus(); } else chat.showInactive();
  screenshotPerformance.mark(pinnedPerformanceSessionId, 'quick_chat_visible');
  pinnedWindow.webContents.send('pin:chat-state', true);
}

function emitAutoAction() {
  if (!autoActionSnapshot || !quickChatWindow || quickChatWindow.isDestroyed() || quickChatWindow.webContents.isDestroyed()) return;
  quickChatWindow.webContents.send('auto-action:changed', { ...autoActionSnapshot });
}

function setAutoAction(snapshot: AutoActionSnapshot) {
  autoActionSnapshot = snapshot;
  emitAutoAction();
}

function abortAutoAction(reason: string, resetState = true) {
  autoActionController?.abort(new Error(reason));
  autoActionController = null;
  if (resetState && autoActionSnapshot && capture?.id === autoActionSnapshot.captureId) {
    setAutoAction({ ...autoActionSnapshot, operationId: randomUUID(), state: 'idle', content: '', error: undefined });
  }
}

function delayWithSignal(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, milliseconds);
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    signal.addEventListener('abort', abort, { once: true });
  });
}

function saveAssistantExchange(question: string, answer: string, profile: ModelProfile, performanceSessionId?: string) {
  if (!currentConversationId) throw new Error('历史对话状态无效');
  const createdAt = new Date().toISOString();
  const userMessage: Message = { role: 'user', content: question, createdAt };
  const assistantMessage: Message = {
    role: 'assistant', content: answer, createdAt: new Date().toISOString(),
    provider: profile.provider, model: profile.model
  };
  conversationMessages.push(userMessage, assistantMessage);
  screenshotPerformance.mark(performanceSessionId, 'assistant_message_save_start');
  saveConversationMessages(currentConversationId, conversationMessages, profile);
  screenshotPerformance.mark(performanceSessionId, 'assistant_message_save_end');
  return assistantMessage;
}

async function executeAutoAction(actionId: ScreenshotActionId, captureId: string, active: AbortController, operationId: string, activeSettings: Settings) {
  if (!capture || capture.id !== captureId || autoActionController !== active) return;
  const action = autoActionRouter.getAction(actionId, activeSettings.predictionBranches);
  if (action.id === 'ask-ai') {
    setAutoAction({ ...autoActionSnapshot!, actionId, operationId, state: 'idle', content: '', error: undefined });
    return;
  }
  const base = { ...autoActionSnapshot!, actionId, operationId, state: 'executing' as const, content: '', error: undefined };
  setAutoAction(base);
  screenshotPerformance.mark(capture.performanceSessionId, 'auto_action_start', 'main', { actionId });
  try {
    const boundNotebook = activeSettings.predictionBranches.find((branch) => branch.id === action.id)?.notebookId;
    if (boundNotebook) {
      try {
        const notebook = await notebooks.authorizedNotebook(boundNotebook);
        if (active.signal.aborted || autoActionController !== active || capture?.id !== captureId) return;
        await agentExecution.selectNotebook(quickChatWindow?.webContents.id ?? mainWindow.webContents.id, captureId, notebook);
      } catch {
        if (active.signal.aborted || autoActionController !== active || capture?.id !== captureId) return;
        await agentExecution.selectNotebook(mainWindow.webContents.id, captureId, null);
        agentExecution.notebookUnavailable(captureId);
      }
    }
    if (active.signal.aborted || autoActionController !== active || capture?.id !== captureId) return;
    const activeProfile = profileFrom(activeSettings);
    let answer = '';
    if (action.id === 'create-schedule') {
      if (!pinnedJpeg || capture.id !== pinnedCaptureId) throw new Error('截图已结束，无法创建日程草稿');
      if (!pinnedScheduleJobId) {
        const key = readKey(activeSettings);
        pinnedScheduleJobId = createScheduleJob({
          id: capture.id, width: capture.width, height: capture.height, createdAt: capture.createdAt
        }, pinnedJpeg, activeProfile);
        mainWindow.webContents.send('schedule:changed');
        void processSchedule(pinnedScheduleJobId, capture.dataUrl, activeSettings, key, capture.createdAt, action.prompt);
      }
      answer = '已识别到明确的日期或时间信息，正在后台生成截然日程草稿。完成后会通知你核对，再由你决定是否写入 Mac 日历或提醒事项。';
      setAutoAction({ ...base, state: 'streaming', content: answer });
    } else if (action.local) {
      answer = autoActionOcrText.trim() || '未在截图中识别到可提取的文字。';
      setAutoAction({ ...base, state: 'streaming', content: answer });
    } else {
      // Prediction remains the first stage; its AI task now uses the same Agent runtime as follow-up questions.
      if (!quickChatWindow || quickChatWindow.isDestroyed()) await showQuickChat(false);
      if (active.signal.aborted || autoActionController !== active || capture?.id !== captureId || !quickChatWindow) return;
      autoActionController = null;
      setAutoAction({ ...base, state: 'done', content: '' });
      agentExecution.start(quickChatWindow.webContents.id, captureId, action.prompt, `自动 · ${action.label}`);
      return;
    }
    if (active.signal.aborted || autoActionController !== active || capture?.id !== captureId) return;
    if (action.id === 'create-schedule') {
      setAutoAction({ ...base, state: 'done', content: answer });
      return;
    }
    const assistant = saveAssistantExchange(`自动 · ${action.label}`, answer, activeProfile, capture.performanceSessionId);
    setAutoAction({ ...base, state: 'done', content: assistant.content });
  } catch (error) {
    if (active.signal.aborted || capture?.id !== captureId || (autoActionController && autoActionController !== active)) return;
    const message = error instanceof Error ? error.message : '自动操作失败';
    setAutoAction({ ...base, state: 'error', content: '', error: message });
  } finally {
    if (autoActionController === active) autoActionController = null;
  }
}

async function beginAutoUnderstanding(captureId: string, jpeg: Buffer) {
  const current = capture;
  if (!current || current.id !== captureId || !pinnedPerformanceSessionId) return;
  abortAutoAction('新的自动分析已开始', false);
  const active = new AbortController();
  autoActionController = active;
  const operationId = randomUUID();
  setAutoAction({ captureId, operationId, state: 'analyzing', actionId: 'ask-ai', content: '' });
  screenshotPerformance.mark(current.performanceSessionId, 'auto_analysis_start');
  if (!quickChatWindow || quickChatWindow.isDestroyed()) void showQuickChat(false).catch((error: unknown) => {
    if (autoActionController !== active) return;
    setAutoAction({ captureId, operationId, state: 'error', actionId: 'ask-ai', content: '', error: error instanceof Error ? error.message : '无法打开截图理解窗口' });
  });
  const predictionSettings = structuredClone(publicSettings());
  const branches = predictionSettings.predictionBranches;
  const predictionKey = () => { try { return readKey(predictionSettings); } catch { throw new PredictionError({ stage: 'vision', reason: 'configuration' }); } };
  const prediction = new PredictionService({ jev: () => predictionSettingsStore.snapshot() });
  const analyzer = new ScreenshotAnalyzer({
    recognizeText: async (_image, signal) => {
      screenshotPerformance.mark(current.performanceSessionId, 'local_ocr_start');
      try { return await (screenCaptureKitBackend?.recognizeText(jpeg, signal, current.performanceSessionId) ?? null); }
      finally { screenshotPerformance.mark(current.performanceSessionId, 'local_ocr_end'); }
    },
    classifyWithVision: async (image, signal) => {
      screenshotPerformance.mark(current.performanceSessionId, 'vision_classification_start');
      try { return await prediction.predict(predictionSettings, predictionKey, image, signal); }
      finally { screenshotPerformance.mark(current.performanceSessionId, 'vision_classification_end'); }
    }
  });
  try {
    const result = await analyzer.analyze({ image: current.dataUrl, width: current.width, height: current.height, predictionBranches: branches }, active.signal);
    if (active.signal.aborted || autoActionController !== active || capture?.id !== captureId) return;
    autoActionOcrText = result.ocrText;
    screenshotPerformance.mark(current.performanceSessionId, 'auto_analysis_end', 'main', {
      contentType: result.analysis.contentType, confidence: result.analysis.confidence, layer: result.layer
    });
    if (result.predictionError) {
      setAutoAction({ captureId, operationId, state: 'error', actionId: 'ask-ai', content: '', error: result.predictionError });
      autoActionController = null; return;
    }
    const action = autoActionRouter.getAutoAction(result.analysis, branches);
    const recommendedDelay = action.id !== 'ask-ai' && result.analysis.confidence >= 0.65 && result.analysis.confidence < 0.82;
    setAutoAction({
      captureId, operationId, state: action.id === 'ask-ai' ? 'idle' : recommendedDelay ? 'recommended' : 'executing',
      actionId: action.id, analysis: result.analysis, content: ''
    });
    screenshotPerformance.mark(current.performanceSessionId, 'auto_action_selected', 'main', {
      actionId: action.id, confidence: result.analysis.confidence
    });
    if (recommendedDelay) await delayWithSignal(700, active.signal);
    await executeAutoAction(action.id, captureId, active, operationId, predictionSettings);
  } catch (error) {
    if (active.signal.aborted || autoActionController !== active) return;
    setAutoAction({
      captureId, operationId, state: 'error', actionId: autoActionSnapshot?.actionId ?? 'ask-ai', content: '',
      error: error instanceof Error ? error.message : '无法理解截图'
    });
    autoActionController = null;
  }
}

function startManualChatStream(request: z.infer<typeof chatStreamRequestSchema>) {
  if (agentExecution?.busy) throw new Error('请先停止当前 Agent 任务');
  if (!capture || request.captureId !== capture.id) throw new Error('截图已失效，请重新选择');
  if (controller) throw new Error('请等待当前回答结束或停止回答');
  abortAutoAction('用户开始了新的问题');
  const currentId = capture.id;
  const performanceSessionId = request.performanceSessionId ?? capture.performanceSessionId;
  if (request.performanceSessionId && request.performanceSessionId !== capture.performanceSessionId) throw new Error('性能会话与截图不匹配');
  const requestId = randomUUID();
  const active = new AbortController();
  controller = active;
  const send = (event: Omit<ChatStreamEvent, 'captureId' | 'requestId'>) => {
    if (quickChatWindow && !quickChatWindow.isDestroyed()) {
      quickChatWindow.webContents.send('chat:stream-event', { captureId: currentId, requestId, ...event } satisfies ChatStreamEvent);
    }
  };
  send({ type: 'start' });
  void (async () => {
    const timeout = setTimeout(() => active.abort(new Error('请求超过 120 秒，请重试')), 120_000);
    try {
      const activeSettings = publicSettings();
      const activeProfile = profileFrom(activeSettings);
      screenshotPerformance.mark(performanceSessionId, 'message_history_prepare_start');
      const recentMessages = conversationMessages.slice(-12);
      screenshotPerformance.mark(performanceSessionId, 'message_history_prepare_end', 'main', { messageCount: recentMessages.length });
      const answer = await streamModel(activeSettings, readKey(), capture!.dataUrl, recentMessages, request.question, active.signal,
        (delta) => send({ type: 'delta', delta }), performanceSessionId, !!capture?.continuesConversation);
      if (active.signal.aborted || capture?.id !== currentId) throw new Error('请求已取消');
      const assistant = saveAssistantExchange(request.question, answer, activeProfile, performanceSessionId);
      send({ type: 'complete', message: assistant });
    } catch (error) {
      const message = active.signal.aborted && active.signal.reason instanceof Error
        ? active.signal.reason.message : error instanceof Error ? error.message : '请求失败';
      send({ type: 'error', error: message === '已切换截图操作' ? '' : message });
    } finally {
      clearTimeout(timeout);
      if (controller === active) controller = null;
    }
  })();
  return { requestId };
}

function returnPinnedConversationToMain() {
  if (!currentConversationId || !capture || capture.id !== pinnedCaptureId) throw new Error('当前对话已结束');
  const conversationId = currentConversationId;
  if (quickChatWindow && mainWindow) agentExecution?.transfer(quickChatWindow.webContents.id, mainWindow.webContents.id);
  controller?.abort(new Error('已返回截然'));
  closePinnedFlow(false);
  showMain();
  mainWindow.webContents.send('capture:resume-conversation', conversationId);
}

async function startContinuationCapture(trigger: 'continue-hotkey' | 'continue-menu') {
  const latest = listConversations()[0];
  controller?.abort(new Error('正在追加新截图'));
  if (screenshotToAllWindow?.isActive()) closePinnedFlow(false);
  await startCapture(trigger, latest?.id);
}

function notifySchedule(title: string, body: string) {
  if (!Notification.isSupported()) return;
  const notification = new Notification({ title, body, silent: false });
  notification.on('click', showSchedule);
  notification.show();
}

async function processSchedule(jobId: string, image: string, settings: Settings, key: string, capturedAt: string, instructions = '') {
  const active = new AbortController(); scheduleControllers.set(jobId, active);
  const timeout = setTimeout(() => active.abort(new Error('日程识别超过 120 秒，请重试')), 120_000);
  try {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai';
    const drafts = await extractScheduleEvents(settings, key, image, capturedAt, timezone, active.signal, instructions);
    completeScheduleJob(jobId, drafts);
    mainWindow.webContents.send('schedule:changed');
    notifySchedule('日程已识别', `已生成 ${drafts.length} 条草稿，点击查看并确认`);
  } catch (error) {
    const message = active.signal.aborted && active.signal.reason instanceof Error
      ? active.signal.reason.message : error instanceof Error ? error.message : '日程识别失败';
    try { failScheduleJob(jobId, message); } catch { /* Preserve the original extraction error. */ }
    mainWindow.webContents.send('schedule:changed');
    notifySchedule('日程识别失败', message);
  } finally { clearTimeout(timeout); scheduleControllers.delete(jobId); }
}

type CaptureTrigger = 'hotkey' | 'continue-hotkey' | 'continue-menu' | 'menu' | 'tray' | 'main';

async function startCapture(trigger: CaptureTrigger = 'main', continuationConversationId?: string, mode: CaptureMode = 'ai') {
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
  if (trigger === 'hotkey' || trigger === 'continue-hotkey') screenshotPerformance.mark(performanceSessionId, 'hotkey_pressed');
  screenshotPerformance.mark(performanceSessionId, 'capture_start');
  screenshotPerformance.updateMetadata(performanceSessionId, { captureMode: mode });
  if (preparing || captureOverlayWindow?.isActive()) {
    screenshotPerformance.mark(activeCapturePerformanceSessionId, 'capture_cancelled', 'main', { reason: 'superseded' });
    cleanupOverlay();
  }
  captureIntents.set(performanceSessionId, continuationConversationId
    ? { kind: 'continue', conversationId: continuationConversationId }
    : { kind: mode === 'standard' ? 'standard' : 'new' });
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
      closePinnedFlow(true);
    }
    if (mode === 'ai') void ensureQuickChatWindow().catch(() => { /* A later explicit open retries failed preload. */ });
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

async function presentAiCapture(image: NativeImage, selection: Selection, display: NonNullable<typeof captureDisplay>, sessionId: string, captureIntent: CaptureIntent) {
  if (!captureOverlayWindow?.isSessionActive(sessionId)) throw new Error('截图会话已结束');
  if (!screenshotToAllWindow) throw new Error('ScreenshotToAll 尚未预加载');
  if (screenshotToAllWindow.isActive()) closePinnedFlow(true);
  const png = image.toPNG();
  const pinned: Capture = {
    id: randomUUID(), conversationId: randomUUID(), ...image.getSize(), createdAt: new Date().toISOString(),
    dataUrl: `data:image/png;base64,${png.toString('base64')}`, performanceSessionId: sessionId
  };
  localPin = { capture: pinned, png };
  pinnedCaptureId = pinned.id;
  pinnedPerformanceSessionId = sessionId;
  const bounds = pinnedBounds(selection, display);
  cleanupOverlay();
  const visible = await screenshotToAllWindow.present(sessionId, bounds, {
    capture: pinned, chatActive: false, localOnly: true, performanceSessionId: sessionId
  });
  const current = () => pinnedCaptureId === pinned.id && screenshotToAllWindow?.isSessionActive(sessionId);
  if (!visible || !current()) return;
  try {
    const accepted = acceptImage(image, false, sessionId, captureIntent.kind === 'continue' ? captureIntent.conversationId : undefined);
    localPin = null;
    pinnedCaptureId = accepted.capture.id;
    pinnedJpeg = accepted.jpeg;
    autoActionSnapshot = {
      captureId: accepted.capture.id, operationId: randomUUID(),
      state: captureIntent.kind === 'continue' ? 'idle' : 'awaiting_input', actionId: 'ask-ai', content: ''
    };
    autoActionOcrText = '';
    screenshotToAllWindow.update(sessionId, { capture: accepted.capture, chatActive: false, performanceSessionId: sessionId });
    await showQuickChat(true);
  } catch (error) {
    if (pinnedPerformanceSessionId === sessionId) screenshotToAllWindow.getWindow().webContents.send('capture:error', error instanceof Error ? error.message : '无法打开截图对话窗口');
    throw error;
  }
}

type ShortcutSettings = Pick<Settings, 'shortcut' | 'continueShortcut' | 'editorShortcut'>;
function registerShortcuts(settings: ShortcutSettings) {
  const previous = { shortcut, continueShortcut, editorShortcut };
  const keys = ['shortcut', 'continueShortcut', 'editorShortcut'] as const;
  if (keys.every((key) => settings[key] === previous[key])) return;
  if (new Set(keys.map((key) => settings[key])).size !== keys.length) throw new Error('三个快捷键不能相同');
  const callbacks = {
    shortcut: () => { void startCapture('hotkey').catch(announceError); },
    continueShortcut: () => { void startContinuationCapture('continue-hotkey').catch(announceError); },
    editorShortcut: () => { void startCapture('hotkey', undefined, 'standard').catch(announceError); }
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
  ({ shortcut, continueShortcut, editorShortcut } = settings);
}

function editorSource(value: unknown) {
  const request = captureFinishSchema.parse(value);
  if (!capturedFrame || !captureDisplay || request.sessionId !== activeCapturePerformanceSessionId
    || !captureOverlayWindow?.isSessionActive(request.sessionId)
    || captureIntents.get(request.sessionId)?.kind !== 'standard') throw new Error('普通截图会话已结束');
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
  const png = Buffer.from(request.png);
  const image = nativeImage.createFromBuffer(png);
  if (image.isEmpty() || image.getSize().width !== rect.width || image.getSize().height !== rect.height) throw new Error('标注截图无效');
  editorFinishing.add(request.sessionId);
  try {
    if (request.action === 'save') {
      const overlay = captureOverlayWindow!.getWindow();
      overlay.hide();
      try {
        const result = await dialog.showSaveDialog({
          title: '保存截图', defaultPath: join(app.getPath('pictures'), `Snipvia-${Date.now()}.png`),
          filters: [{ name: 'PNG 图片', extensions: ['png'] }]
        });
        editorSource(request);
        if (result.canceled || !result.filePath) return { completed: false };
        await writeFile(result.filePath, png);
        editorSource(request);
      } finally {
        if (captureOverlayWindow?.isSessionActive(request.sessionId)) captureOverlayWindow.showRenderedSession(request.sessionId);
      }
      cleanupOverlay();
    } else if (request.action === 'copy') {
      await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) })]);
      if (captureOverlayWindow?.isSessionActive(request.sessionId)) cleanupOverlay();
    } else if (request.action === 'ai') {
      await presentAiCapture(image, request.selection, display, request.sessionId, { kind: 'new' });
    } else {
      if (!screenshotToAllWindow) throw new Error('贴图窗口尚未准备好');
      closePinnedFlow(true);
      const pinned: Capture = {
        id: randomUUID(), conversationId: randomUUID(), ...image.getSize(), createdAt: new Date().toISOString(),
        dataUrl: `data:image/png;base64,${png.toString('base64')}`, performanceSessionId: request.sessionId
      };
      localPin = { capture: pinned, png };
      pinnedCaptureId = pinned.id;
      pinnedPerformanceSessionId = request.sessionId;
      cleanupOverlay();
      const visible = await screenshotToAllWindow.present(request.sessionId, pinnedBounds(request.selection, display), {
        capture: pinned, chatActive: false, localOnly: true, performanceSessionId: request.sessionId
      });
      if (!visible && pinnedPerformanceSessionId === request.sessionId) clearPinnedFlow(true);
    }
    return { completed: true };
  } finally { editorFinishing.delete(request.sessionId); }
}

type WindowRole = 'main' | 'overlay' | 'pin' | 'quickChat';

function windowForRole(role: WindowRole) {
  if (role === 'main') return mainWindow;
  if (role === 'overlay') return captureOverlayWindow?.peekWindow() ?? null;
  if (role === 'pin') return screenshotToAllWindow?.peekWindow() ?? null;
  return quickChatWindow;
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

function setupAgentIPC() {
  const attached = new Set<number>();
  const attach = (event: Electron.IpcMainInvokeEvent) => {
    const owner = event.sender.id;
    if (attached.has(owner)) return;
    attached.add(owner);
    event.sender.once('destroyed', () => { attached.delete(owner); agentExecution.detach(owner); editingProposals.detach(owner); chatImages.detach(owner); });
    event.sender.on('render-process-gone', () => { agentExecution.detach(owner); editingProposals.detach(owner); chatImages.detach(owner); });
    event.sender.on('did-start-navigation', (_navigation, _url, _inPlace, isMainFrame) => { if (isMainFrame) { agentExecution.detach(owner); editingProposals.detach(owner); chatImages.detach(owner); } });
  };
  for (const operation of ['choose', 'import', 'paste', 'capture', 'preview', 'remove', 'bind', 'capability', 'sources'] as const) {
    ipcMain.handle(`chat-images:${operation}`, async (event, value: unknown): Promise<Result<unknown>> => {
      try {
        const check = (scope: string | null) => { if (!senderAllowed(event, 'main')) throw new Error('不允许的窗口请求'); if (scope) readWorkspaceConversation(scope, false); };
        check(null); attach(event); const owner = event.sender.id;
        if (operation === 'sources') { z.undefined().parse(value); return { ok: true, value: capturedConversations() }; }
        if (operation === 'capability') { z.undefined().parse(value); const profile = profileFrom(publicSettings()); return { ok: true, value: modelCatalog.vision(profile, profile.model) }; }
        if (operation === 'bind') { const input = chatImageBindSchema.parse(value); const conversation = readWorkspaceConversation(input.conversationId, false); if (conversation.messages.length) throw new Error('只能将新草稿关联到空对话'); chatImages.bind(owner, input.conversationId, input.imageIds); return { ok: true, value: undefined }; }
        if (operation === 'preview' || operation === 'remove') {
          const input = chatImageReferenceSchema.parse(value); check(input.conversationId);
          if (operation === 'remove') { chatImages.remove(owner, input.conversationId, input.imageId); return { ok: true, value: undefined }; }
          const saved = input.conversationId ? readWorkspaceConversation(input.conversationId, false).messages.flatMap(message => message.images ?? []) : [];
          return { ok: true, value: { bytes: new Uint8Array(chatImages.preview(owner, input.conversationId, input.imageId, saved)), mimeType: 'image/png' } };
        }
        if (operation === 'import') { const input = chatImageImportSchema.parse(value); check(input.conversationId); return { ok: true, value: chatImages.add(owner, input.conversationId, input.files) }; }
        if (operation === 'capture') { const input = chatImageCaptureSchema.parse(value); check(input.conversationId); const source = readConversation(input.sourceConversationId).capture; return { ok: true, value: chatImages.add(owner, input.conversationId, [{ name: '截图.png', bytes: Buffer.from(source.dataUrl.slice(source.dataUrl.indexOf(',') + 1), 'base64') }]) }; }
        const input = chatImageScopeSchema.parse(value); check(input.conversationId);
        if (operation === 'paste') {
          const files = [];
          for (const item of await clipboard.read()) { const type = item.types.find(type => ['image/png', 'image/jpeg'].includes(type)); if (!type) continue; const blob = await item.getType(type); if (!(blob instanceof Blob) || blob.size > chatImageLimits.sourceBytes) throw new Error('剪贴板图片需小于 10 MiB'); files.push({ name: '剪贴板图片.png', bytes: new Uint8Array(await blob.arrayBuffer()) }); if (files.length > chatImageLimits.perTurn) throw new Error('每条消息最多 4 张图片'); }
          if (!files.length) throw new Error('剪贴板里没有 PNG / JPEG 图片');
          check(input.conversationId); return { ok: true, value: chatImages.add(owner, input.conversationId, files) };
        }
        const choice = await dialog.showOpenDialog(mainWindow, { title: '添加图片', properties: ['openFile', 'multiSelections'], filters: [{ name: 'PNG / JPEG 图片', extensions: ['png', 'jpg', 'jpeg'] }] });
        if (choice.canceled) return { ok: true, value: [] }; if (choice.filePaths.length > chatImageLimits.perTurn) throw new Error('每条消息最多 4 张图片');
        const files = [];
        for (const path of choice.filePaths) { const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW); try { const info = await file.stat(); if (!info.isFile() || info.size > chatImageLimits.sourceBytes) throw new Error('请选择小于 10 MiB 的图片文件'); const bytes = await file.readFile(); files.push({ name: path.split(/[\\/]/).at(-1)!, bytes }); } finally { await file.close(); } }
        check(input.conversationId); return { ok: true, value: chatImages.add(owner, input.conversationId, files) };
      } catch (error) { return { ok: false, error: error instanceof z.ZodError ? '图片参数无效，请使用 PNG / JPEG，每条消息最多 4 张，每张小于 10 MiB' : error instanceof Error ? error.message : '添加图片失败' }; }
    });
  }
  for (const operation of ['state', 'select', 'preview', 'apply', 'cancel', 'open-note'] as const) {
    ipcMain.handle(`editing:${operation}`, async (event, value: unknown): Promise<Result<unknown>> => {
      try {
        if (!senderAllowed(event, 'main')) throw new Error('不允许的窗口请求');
        attach(event); const owner = event.sender.id;
        if (operation === 'state') { const input = editingReferenceSchema.parse(value); return { ok: true, value: editingProposals.state(owner, input.conversationId) }; }
        if (operation === 'select') {
          const input = editingSelectionSchema.parse(value);
          if (input.context?.kind === 'note') await flushNotesForAgent(new AbortController().signal);
          if (!senderAllowed(event, 'main')) throw new Error('窗口已变化');
          return { ok: true, value: await editingProposals.select(owner, input.conversationId, input.context) };
        }
        if (operation === 'apply') { const input = editingApplySchema.parse(value); return { ok: true, value: await editingProposals.apply(owner, input.conversationId, input.proposalId, input.digest) }; }
        const input = editingProposalSchema.parse(value);
        if (operation === 'preview') return { ok: true, value: editingProposals.preview(owner, input.conversationId, input.proposalId) };
        if (operation === 'cancel') return { ok: true, value: editingProposals.cancel(owner, input.conversationId, input.proposalId) };
        let note: { notebookId: string; path: string };
        try { note = editingProposals.note(owner, input.conversationId, input.proposalId); }
        catch { const change = agentExecution.noteChange({ conversationId: input.conversationId }, input.proposalId); note = { notebookId: change.notebookId, path: change.path }; }
        await flushNotesForAgent(new AbortController().signal); await notebooks.read(note.notebookId, note.path);
        if (!senderAllowed(event, 'main')) throw new Error('窗口已变化');
        showMain(); mainWindow.webContents.send('notes:open-requested', { id: randomUUID(), ...note });
        return { ok: true, value: undefined };
      } catch (error) { return { ok: false, error: error instanceof z.ZodError ? '上下文或修改提案格式无效' : error instanceof Error ? error.message : '修改操作失败' }; }
    });
  }
  for (const operation of ['state', 'start', 'stop'] as const) {
    ipcMain.handle(`agent:workspace-${operation}`, async (event, value: unknown): Promise<Result<unknown>> => {
      try {
        if (!senderAllowed(event, 'main')) throw new Error('不允许的窗口请求');
        const request = operation === 'start' ? { kind: 'start' as const, ...agentWorkspaceStartSchema.parse(value) } : operation === 'stop' ? { kind: 'stop' as const, ...agentWorkspaceStopSchema.parse(value) } : { kind: 'state' as const, ...agentWorkspaceSchema.parse(value) };
        attach(event);
        const target = { conversationId: request.conversationId };
        const snapshot = agentExecution.subscribe(event.sender.id, target, state => { if (!event.sender.isDestroyed()) event.sender.send('agent:changed', state); });
        if (request.kind === 'state') return { ok: true, value: snapshot };
        if (request.kind === 'stop') { agentExecution.stop(event.sender.id, target, request.runId); return { ok: true, value: undefined }; }
        if (request.kind === 'start') {

          if (!senderAllowed(event, 'main')) throw new Error('窗口已变化');
          const lease = chatImages.begin(event.sender.id, request.conversationId, request.imageIds);
          try { return { ok: true, value: agentExecution.start(event.sender.id, target, request.question, request.question, request.regenerate, lease.images) }; }
          catch (error) { lease.release(); throw error; }
        }
        throw new Error('请求格式无效');
      } catch (error) { return { ok: false, error: error instanceof z.ZodError ? '对话请求格式无效' : error instanceof Error ? error.message : '对话操作失败' }; }
    });
  }
  for (const operation of ['state', 'notebooks', 'notebook', 'start', 'stop', 'decide', 'diff'] as const) {
    ipcMain.handle(`agent:${operation}`, async (event, value: unknown): Promise<Result<unknown>> => {
      try {
        if (!senderAllowed(event, ['main', 'quickChat']) || !agentExecution) throw new Error('不允许的窗口请求');
        const owner = event.sender.id;
        const { captureId } = agentCaptureSchema.parse({ captureId: value && typeof value === 'object' && 'captureId' in value ? value.captureId : undefined });
        attach(event);
        const snapshot = agentExecution.subscribe(owner, captureId, (state) => {
          if (!event.sender.isDestroyed()) event.sender.send('agent:changed', state);
        });
        let result: unknown;
        if (operation === 'state') { agentCaptureSchema.parse(value); result = snapshot; }
        else if (operation === 'notebooks') {
          agentCaptureSchema.parse(value);
          result = (await notebooks.state()).notebooks.map(({ id, name }) => ({ id, name }));
        } else if (operation === 'notebook') {
          const request = agentNotebookSchema.parse(value);
          const book = request.notebookId ? await notebooks.authorizedNotebook(request.notebookId) : null;
          if (!senderAllowed(event, ['main', 'quickChat'])) throw new Error('窗口已变化');
          result = await agentExecution.selectNotebook(owner, captureId, book);
        } else if (operation === 'start') {
          const request = agentStartSchema.parse(value);

          if (!senderAllowed(event, ['main', 'quickChat'])) throw new Error('窗口已变化');
          result = agentExecution.start(owner, captureId, request.question);
        } else if (operation === 'stop') {
          const request = agentRunSchema.parse(value); agentExecution.stop(owner, captureId, request.runId);
        } else if (operation === 'decide') {
          const request = agentDecisionSchema.parse(value); agentExecution.decide(owner, captureId, request.runId, request.requestId, request.decision);
        } else {
          const request = agentDiffSchema.parse(value); result = agentExecution.diff(owner, captureId, request.runId, request.stepId);
        }
        return { ok: true, value: result };
      } catch (error) { return { ok: false, error: error instanceof z.ZodError ? 'Agent 请求格式无效' : error instanceof Error ? error.message : 'Agent 操作失败' }; }
    });
  }
}

function setupIPC() {
  handle('updates:current', 'main', value => { z.undefined().parse(value); return updates.current(); });
  handle('updates:check', 'main', value => { z.undefined().parse(value); return updates.check(); });
  handle('updates:open-release', 'main', value => { z.undefined().parse(value); return updates.openRelease(); });
  handle('updates:download', 'main', value => { z.undefined().parse(value); return updates.download(); });
  handle('updates:restart-install', 'main', value => { z.undefined().parse(value); return updates.restartAndInstall(); });
  handle('appearance:set', 'main', (mode) => appearance.setMode(mode));
  setupAgentIPC();
  registerNotesIPC((channel, action) => handle(channel, 'main', action), notebooks, () => mainWindow,
    (id) => { if (editingProposals.isApplying) throw new Error('请等待修改保存完成'); return agentExecution.unlinkNotebook(id, () => notebooks.unlink(id)); });
  handle('notes:request-creation', ['main', 'quickChat'], (value) => {
    const request = z.strictObject({ captureId: z.string().uuid().optional() }).parse(value);
    if (agentExecution.busy || controller || autoActionController) throw new Error('请先等待当前回答完成');
    if (request.captureId && capture?.id !== request.captureId) throw new Error('截图已失效，请重新选择');
    const intent = { id: randomUUID(), captureId: request.captureId };
    // Reply before closing the sender. The conversation stays in Main and can resume after creation.
    setTimeout(() => {
      if (mainWindow.isDestroyed()) return;
      if (request.captureId && capture?.id !== request.captureId) return;
      if (screenshotToAllWindow?.isActive()) closePinnedFlow(false);
      showMain(); mainWindow.webContents.send('notes:creation-requested', intent);
    }, 30);
  });
  handle('notes:finish-flush', 'main', (value) => {
    const input = z.strictObject({ requestId: z.string().uuid(), success: z.boolean() }).parse(value);
    const pending = noteFlushRequests.get(input.requestId);
    if (pending) { pending(input.success); return; }
    if (input.requestId !== notesQuitRequest) throw new Error('退出保存请求已过期');
    clearTimeout(notesQuitTimer); notesQuitRequest = null;
    if (input.success) { notesQuitReady = true; setImmediate(() => app.quit()); }
    else showMain();
  });
  handle('agent:source-icon', ['main', 'quickChat'], (value) => {
    const request = agentSourceIconSchema.parse(value);
    if (!agentExecution.hasSource(request.captureId, request.url)) throw new Error('该网页不属于当前对话来源');
    return agentSourceIcons.get(request.url);
  });
  handle('agent:note-diff', ['main', 'quickChat'], async (value, event) => {
    const request = agentNoteChangeSchema.parse(value);
    const target = 'captureId' in request ? request.captureId : { conversationId: request.conversationId };
    if (typeof target !== 'string' && !senderAllowed(event, 'main')) throw new Error('不允许的窗口请求');
    const change = agentExecution.noteChange(target, request.changeId);
    await notebooks.authorizedNotebook(change.notebookId);
    try { return agentFileTools.noteWriter!.diff(change.id); }
    catch (error) {
      // In-memory previews expire on restart; the conversation's checkpoint keeps the diff.
      const checkpoint = await noteCheckpoints.findByChange(change.id);
      const diff = checkpoint?.conversationId === agentExecution.conversationId(target) ? checkpointDiff(checkpoint, change.id) : undefined;
      if (!diff) throw error;
      return diff;
    }
  });
  handle('agent:note-undo-state', ['main', 'quickChat'], async (value, event) => {
    const request = agentNoteChangeSchema.parse(value);
    const target = 'captureId' in request ? request.captureId : { conversationId: request.conversationId };
    if (typeof target !== 'string' && !senderAllowed(event, 'main')) throw new Error('不允许的窗口请求');
    const change = agentExecution.noteChange(target, request.changeId);
    const checkpoint = await noteCheckpoints.findByChange(change.id);
    return undoState(checkpoint?.conversationId === agentExecution.conversationId(target) ? checkpoint : undefined);
  });
  handle('agent:note-undo', ['main', 'quickChat'], async (value, event) => {
    const request = agentNoteChangeSchema.parse(value);
    const target = 'captureId' in request ? request.captureId : { conversationId: request.conversationId };
    if (typeof target !== 'string' && !senderAllowed(event, 'main')) throw new Error('不允许的窗口请求');
    const change = agentExecution.noteChange(target, request.changeId);
    if (agentExecution.busy) throw new Error('请先等待当前 Agent 任务完成');
    const checkpoint = await noteCheckpoints.findByChange(change.id);
    if (!checkpoint || checkpoint.conversationId !== agentExecution.conversationId(target)) throw new Error('这次修改没有可用的检查点');
    const result = await undoCheckpoint(checkpoint, { workspaces: agentFileTools.workspaces, notebook: (id) => notebooks.authorizedNotebook(id),
      flush: flushNotesForAgent, changed: (id) => notebooks.notifyChanged(id) }, new AbortController().signal);
    await noteCheckpoints.markReverted(checkpoint.id);
    return result;
  });
  handle('agent:note-open', ['main', 'quickChat'], async (value, event) => {
    const request = agentNoteChangeSchema.parse(value);
    const target = 'captureId' in request ? request.captureId : { conversationId: request.conversationId };
    if (typeof target !== 'string' && !senderAllowed(event, 'main')) throw new Error('不允许的窗口请求');
    const change = agentExecution.noteChange(target, request.changeId);
    await flushNotesForAgent(new AbortController().signal);
    await notebooks.read(change.notebookId, change.path);
    if (agentExecution.busy) throw new Error('请先等待当前任务完成');
    const intent = { id: randomUUID(), notebookId: change.notebookId, path: change.path };
    // Let the sender receive the result before closing its QuickChat window.
    setTimeout(() => {
      if (mainWindow.isDestroyed() || typeof target === 'string' && capture?.id !== target || agentExecution.busy) return;
      if (screenshotToAllWindow?.isActive()) closePinnedFlow(false);
      showMain(); mainWindow.webContents.send('notes:open-requested', intent);
    }, 30);
  });
  ipcMain.on('window:ready', (event, value: unknown) => {
    if (value === 'capture' && senderAllowed(event, 'overlay')) captureOverlayWindow?.markRendererReady();
    if (value === 'pin' && senderAllowed(event, 'pin')) screenshotToAllWindow?.markRendererReady();
    if (value === 'quick-chat' && senderAllowed(event, 'quickChat') && quickChatReady && quickChatReady.windowId === quickChatWindow?.id) { quickChatReady.resolve(); quickChatReady = null; }
  });
  ipcMain.on('performance:mark', (event, value: unknown) => {
    if (!senderAllowed(event, ['main', 'overlay', 'pin', 'quickChat'])) return;
    const parsed = performanceMarkSchema.safeParse(value);
    if (!parsed.success) return;
    screenshotPerformance.mark(parsed.data.sessionId, parsed.data.event, 'renderer', parsed.data.metadata);
  });
  handle('performance:report', ['main', 'overlay', 'pin', 'quickChat'], (value) => screenshotPerformance.report(performanceSessionIdSchema.parse(value)));
  handle('performance:startup-report', ['main', 'overlay', 'pin', 'quickChat'], () => startupPerformanceSessionId ? screenshotPerformance.report(startupPerformanceSessionId) : null);
  handle('performance:capture-backend-status', ['main', 'overlay', 'pin', 'quickChat'], () => ({
    preference: captureBackendPreference(),
    screenCaptureKit: screenCaptureKitBackend?.status() ?? null,
    processes: processMemoryDetails()
  }));
  handle('performance:frame-quality', 'overlay', (value) => {
    const sessionId = performanceSessionIdSchema.parse(value);
    const benchmark = captureBenchmarkFrames.get(sessionId);
    if (!benchmark) throw new Error('当前未启用截图质量基准');
    return compareCaptureFrame(benchmark.source, benchmark.encoded);
  });
  handle('prediction-settings:get', 'main', value => { z.undefined().parse(value); return predictionSettingsStore.public(); });
  handle('prediction-settings:save', 'main', value => {
    const parsed = savePredictionSettingsSchema.safeParse(value);
    if (!parsed.success) throw new Error('Jev 配置无效，请检查模型和 API Key');
    const saved = predictionSettingsStore.save(parsed.data);
    if (autoActionController) abortAutoAction('预测配置已改变，请重新开始分析');
    return saved;
  });
  handle('prediction-settings:open-console', 'main', async value => {
    z.undefined().parse(value);
    await shell.openExternal('https://console.typesafe.ai/');
  });
  handle('settings:get', ['main', 'quickChat'], () => publicSettings());
  modelCatalog = new ModelCatalog({ file: join(app.getPath('userData'), 'model-catalog.json'), readKey });
  handle('models:list', 'main', value => modelCatalog.list(modelListRequestSchema.parse(value)));
  handle('models:add', 'main', value => modelCatalog.add(modelAddRequestSchema.parse(value)));
  handle('models:test-vision', 'main', async value => {
    const parsed = modelTestRequestSchema.parse(value);
    const approval = await dialog.showMessageBox(mainWindow, {
      type: 'question', title: '测试图片理解能力',
      message: '此测试会向你配置的模型服务发送固定合成图片，可能产生少量 API 费用。',
      detail: `模型：${parsed.model}\n目标：${new URL(parsed.endpoint).origin}\n不会使用你的截图、笔记或聊天记录。`,
      buttons: ['取消', '确认并测试'], defaultId: 0, cancelId: 0, noLink: true
    });
    if (approval.response !== 1) throw new Error('已取消图片能力测试');
    return modelCatalog.testVision(parsed);
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
  handle('browser:open-external', ['main', 'quickChat'], async (value) => {
    if (typeof value !== 'string' || value.length > 2048) throw new Error('链接无效');
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('只允许打开安全的网页链接');
    await shell.openExternal(url.toString());
  });
  handle('settings:save', ['main', 'quickChat'], (value) => {
    const parsed = saveSettingsSchema.safeParse(value);
    if (!parsed.success) throw new Error(parsed.error.issues.find((issue) => issue.code === 'custom')?.message ?? '模型配置无效，请检查厂商、接口、模型名称和快捷键');
    const { apiKey, ...settings } = parsed.data;
    const previous = { shortcut, continueShortcut, editorShortcut };
    registerShortcuts(settings);
    try {
      const saved = saveSettings(settings, apiKey);
      if (autoActionController) abortAutoAction('模型配置已改变，请重新开始分析');
      mainWindow.webContents.send('settings:changed', saved);
      if (quickChatWindow && !quickChatWindow.isDestroyed()) quickChatWindow.webContents.send('settings:changed', saved);
      return saved;
    } catch (error) { if (previous.shortcut && previous.continueShortcut) registerShortcuts(previous); throw error; }
  });
  handle('capture:start', 'main', (value) => startCapture('main', undefined, z.enum(['ai', 'standard']).default('ai').parse(value)));
  handle('capture:current', ['main', 'pin', 'quickChat'], () => capture);
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
    const captureIntent = captureIntents.get(request.sessionId) ?? { kind: 'new' as const };
    if (captureIntent.kind === 'standard') throw new Error('请从编辑工具栏完成截图');
    await presentAiCapture(selected, selection, display, request.sessionId, captureIntent);
  });
  handle('capture:import', 'main', async () => {

    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg'] }] });
    if (result.canceled) return null;
    const path = result.filePaths[0];
    if ((await stat(path)).size > 20 * 1024 * 1024) throw new Error('请选择小于 20 MB 的图片');
    return acceptImage(nativeImage.createFromPath(path)).capture;
  });
  handle('pin:current', 'pin', () => {
    if (localPin && pinnedPerformanceSessionId) return { capture: localPin.capture, chatActive: false, localOnly: true, performanceSessionId: pinnedPerformanceSessionId };
    if (!capture || capture.id !== pinnedCaptureId || !pinnedPerformanceSessionId) throw new Error('置顶截图已结束');
    return { capture, chatActive: !!quickChatWindow && !quickChatWindow.isDestroyed(), performanceSessionId: pinnedPerformanceSessionId };
  });
  handle('pin:session-rendered', 'pin', (value) => screenshotToAllWindow?.showRenderedSession(performanceSessionIdSchema.parse(value)) ?? false);
  handle('pin:session-visible', 'pin', (value) => screenshotToAllWindow?.markSessionVisible(performanceSessionIdSchema.parse(value)) ?? false);
  handle('pin:close', 'pin', () => { closePinnedFlow(true); });
  handle('pin:copy', ['pin', 'quickChat'], async () => {
    if (localPin) {
      const pinnedId = localPin.capture.id;
      await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(localPin.png)], { type: 'image/png' }) })]);
      if (localPin?.capture.id === pinnedId) closePinnedFlow(true);
      return;
    }
    if (!capture || capture.id !== pinnedCaptureId || !pinnedJpeg) throw new Error('置顶截图已结束');
    const image = nativeImage.createFromBuffer(pinnedJpeg);
    if (image.isEmpty()) throw new Error('截图无法写入剪贴板');
    const bytes = new Uint8Array(pinnedJpeg);
    await clipboard.write([new ClipboardItem({ 'image/jpeg': new Blob([bytes], { type: 'image/jpeg' }) })]);
    closePinnedFlow(true);
  });
  handle('pin:start-chat', 'pin', async () => {

    if (!screenshotToAllWindow?.isActive()) throw new Error('置顶截图已结束');
    if (localPin && pinnedPerformanceSessionId) {
      const accepted = acceptImage(nativeImage.createFromBuffer(localPin.png), false, pinnedPerformanceSessionId);
      localPin = null;
      pinnedCaptureId = accepted.capture.id;
      pinnedJpeg = accepted.jpeg;
      screenshotToAllWindow?.getWindow().webContents.send('pin:new-session', {
        capture: accepted.capture, chatActive: false, performanceSessionId: pinnedPerformanceSessionId
      });
      setAutoAction({ captureId: accepted.capture.id, operationId: randomUUID(), state: 'awaiting_input', actionId: 'ask-ai', content: '' });
      autoActionOcrText = '';
    }
    await showQuickChat();
  });
  handle('pin:return-to-app', ['pin', 'quickChat'], () => returnPinnedConversationToMain());
  // Presentation-only IPC: no caller-supplied bounds, paths or image bytes.
  handle('chat:set-expanded', 'quickChat', (value) => {
    const expanded = z.boolean().parse(value);
    const chat = quickChatWindow;
    const pin = screenshotToAllWindow?.peekWindow();
    if (!chat || chat.isDestroyed() || !pin || !screenshotToAllWindow?.isActive()) throw new Error('截图流程已结束');
    if (expanded === quickChatExpanded) return;
    if (expanded) {
      const bounds = chat.getBounds();
      quickChatCompactSize = { width: bounds.width, height: bounds.height };
    }
    quickChatExpanded = expanded;
    quickChatUserSize = expanded ? { width: 1000, height: 680 } : quickChatCompactSize;
    positionQuickChat();
    if (expanded) pin.hide(); else pin.showInactive();
    chat.focus();
  });
  handle('chat:save-image', 'quickChat', async () => {
    const chat = quickChatWindow;
    const id = pinnedCaptureId;
    const jpeg = pinnedJpeg;
    if (!chat || !id || !jpeg) throw new Error('截图流程已结束');
    const result = await dialog.showSaveDialog(chat, {
      title: '保存截图', defaultPath: join(app.getPath('pictures'), `Snipvia-${Date.now()}.jpg`),
      filters: [{ name: 'JPEG 图片', extensions: ['jpg', 'jpeg'] }]
    });
    if (result.canceled || !result.filePath) return false;
    if (pinnedCaptureId !== id || chat.isDestroyed()) throw new Error('截图已更新，请重新保存');
    await writeFile(result.filePath, jpeg);
    return true;
  });
  handle('chat:state', ['main', 'quickChat'], () => {
    if (!capture) throw new Error('还没有可用的截图');
    return {
      capture,
      messages: conversationMessages.map((message) => ({ ...message })),
      ...(capture.performanceSessionId ? { performanceSessionId: capture.performanceSessionId } : {}),
      ...(autoActionSnapshot?.captureId === capture.id ? { autoAction: { ...autoActionSnapshot } } : {})
    };
  });
  handle('chat:send', ['main', 'quickChat'], async (value) => {

    if (agentExecution?.busy) throw new Error('请先停止当前 Agent 任务');
    const request = chatSchema.parse(value);
    if (!capture || request.captureId !== capture.id) throw new Error('截图已失效，请重新选择');
    abortAutoAction('用户发送了新的问题');
    const performanceSessionId = request.performanceSessionId ?? capture.performanceSessionId;
    if (request.performanceSessionId && request.performanceSessionId !== capture.performanceSessionId) throw new Error('性能会话与截图不匹配');
    screenshotPerformance.mark(performanceSessionId, 'chat_send_main_received');
    if (controller) throw new Error('请等待当前回答结束或停止回答');
    const currentId = capture.id;
    const active = new AbortController();
    controller = active;
    const activeSettings = publicSettings();
    const activeProfile = profileFrom(activeSettings);
    const timeout = setTimeout(() => active.abort(new Error('请求超过 120 秒，请重试')), 120_000);
    try {
      screenshotPerformance.mark(performanceSessionId, 'message_history_prepare_start');
      const recentMessages = conversationMessages.slice(-12);
      screenshotPerformance.mark(performanceSessionId, 'message_history_prepare_end', 'main', { messageCount: recentMessages.length });
      const answer = await askModel(activeSettings, readKey(), capture.dataUrl, recentMessages, request.question, active.signal,
        performanceSessionId, !!capture.continuesConversation);
      if (active.signal.aborted || capture?.id !== currentId) throw new Error('请求已取消');
      const createdAt = new Date().toISOString();
      const userMessage: Message = { role: 'user', content: request.question, createdAt };
      const assistantMessage: Message = {
        role: 'assistant', content: answer, createdAt: new Date().toISOString(),
        provider: activeProfile.provider, model: activeProfile.model
      };
      conversationMessages.push(userMessage, assistantMessage);
      if (!currentConversationId) throw new Error('历史对话状态无效');
      screenshotPerformance.mark(performanceSessionId, 'assistant_message_save_start');
      saveConversationMessages(currentConversationId, conversationMessages, activeProfile);
      screenshotPerformance.mark(performanceSessionId, 'assistant_message_save_end');
      screenshotPerformance.mark(performanceSessionId, 'chat_ipc_return');
      return assistantMessage;
    } catch (error) {
      if (active.signal.aborted) throw new Error(active.signal.reason instanceof Error ? active.signal.reason.message : '请求已停止');
      throw error;
    } finally { clearTimeout(timeout); if (controller === active) controller = null; }
  });
  handle('chat:stream', 'quickChat', async (value) => {

    const request = chatStreamRequestSchema.parse(value);
    screenshotPerformance.mark(request.performanceSessionId ?? capture?.performanceSessionId, 'chat_send_main_received');
    return startManualChatStream(request);
  });
  handle('chat:cancel', ['main', 'quickChat'], () => {
    controller?.abort(new Error('请求已停止'));
    abortAutoAction('请求已停止');
  });
  handle('auto-action:actions', 'quickChat', () => autoActionRouter.availableActions(publicSettings().predictionBranches));
  handle('auto-action:state', 'quickChat', () => autoActionSnapshot ? { ...autoActionSnapshot } : null);
  handle('auto-action:start', ['quickChat', 'pin'], async (value) => {

    const captureId = conversationIdSchema.parse(value);
    if (!capture || capture.id !== captureId || capture.id !== pinnedCaptureId || !pinnedJpeg ||
        autoActionSnapshot?.captureId !== captureId) throw new Error('截图已失效，请重新截图');
    // Repeated Enter cannot duplicate an active run. A visible failure can be
    // retried explicitly on the same crop, without starting a background loop.
    if (capture.continuesConversation || !['awaiting_input', 'error'].includes(autoActionSnapshot.state) || autoActionController || controller || agentExecution.busy) return;
    void beginAutoUnderstanding(captureId, pinnedJpeg);
  });
  handle('auto-action:cancel', ['quickChat', 'pin'], () => {
    controller?.abort(new Error('请求已停止'));
    abortAutoAction('请求已停止');
  });
  handle('auto-action:user-intent', 'quickChat', () => { abortAutoAction('用户输入优先'); });
  handle('auto-action:close', ['quickChat', 'pin'], () => { closePinnedFlow(true); });
  handle('history:list', 'main', () => listConversations());
  // Browsing a preview must not cancel a running request or replace the active capture.
  handle('history:rename', 'main', value => {
    const request = conversationRenameSchema.parse(value);
    const result = renameConversation(request.id, request.title);
    mainWindow.webContents.send('history:changed');
    return result;
  });
  handle('history:create', 'main', value => { z.undefined().parse(value); return createTextConversation(profileFrom(publicSettings())); });
  handle('history:read', 'main', (value) => readWorkspaceConversation(conversationIdSchema.parse(value)));
  handle('history:open', 'main', (value) => {
    const id = conversationIdSchema.parse(value);
    if (currentConversationId !== id) agentExecution.cancelAll();
    controller?.abort(new Error('已切换到历史对话'));
    const conversation = readConversation(id);
    const performanceSessionId = currentConversationId === id ? capture?.performanceSessionId : undefined;
    capture = { ...conversation.capture, ...(performanceSessionId ? { performanceSessionId } : {}) };
    conversationMessages = conversation.messages;
    currentConversationId = conversation.id;
    activeCapturePerformanceSessionId = performanceSessionId ?? null;
    return { ...conversation, capture };
  });
  handle('history:delete', 'main', (value) => {
    editingProposals.forget(conversationIdSchema.parse(value));
    agentExecution?.forget(conversationIdSchema.parse(value));
    void noteCheckpoints.deleteConversation(conversationIdSchema.parse(value)).catch(() => {});
    const id = conversationIdSchema.parse(value);
    const wasActive = currentConversationId === id;
    deleteConversation(id);
    chatImages.forget(id);
    if (wasActive) { controller?.abort(); capture = null; conversationMessages = []; currentConversationId = null; activeCapturePerformanceSessionId = null; }
    return wasActive;
  });
  handle('history:clear', 'main', () => {
    editingProposals.clear();
    agentExecution?.clear();
    void noteCheckpoints.clear().catch(() => {});
    const hadActive = currentConversationId !== null;
    clearConversations();
    chatImages.clear();
    controller?.abort(); capture = null; conversationMessages = []; currentConversationId = null; activeCapturePerformanceSessionId = null;
    return hadActive;
  });
  handle('schedule:list', 'main', () => listScheduleJobs());
  handle('schedule:open', 'main', (value) => readScheduleJob(conversationIdSchema.parse(value)));
  handle('schedule:save', 'main', (value) => {
    const request = scheduleSaveSchema.parse(value);
    return saveScheduleEvent(request.jobId, request.eventId, request.draft);
  });
  handle('schedule:delete', 'main', (value) => deleteScheduleJob(conversationIdSchema.parse(value)));
  handle('schedule:mac-calendars', 'main', () => listMacCalendars());
  handle('schedule:mac-reminder-lists', 'main', () => listMacReminderLists());
  handle('schedule:save-to-mac', 'main', async (value) => {
    const request = calendarSaveSchema.parse(value);
    const created = await createMacCalendarEvent(request.calendarId, request.draft);
    return markMacSaved(request.jobId, request.eventId, request.draft, created.calendar);
  });
  handle('schedule:save-to-reminders', 'main', async (value) => {
    const request = reminderSaveSchema.parse(value);
    const created = await createMacReminder(request.listId, request.draft);
    return markMacReminderSaved(request.jobId, request.eventId, request.draft, created.list);
  });
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
    predictionSettingsStore.load();
    appearance.start();
    try { loadHistory(); } catch { startupError += `${startupError ? '\n' : ''}历史记录读取失败；为避免覆盖原文件，本次请勿创建新对话。`; }
    try { loadSchedule(); } catch { startupError += `${startupError ? '\n' : ''}日程记录读取失败；为避免覆盖原文件，本次请勿创建新日程。`; }
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
      width: 1120, height: 780, minWidth: 840, minHeight: 600, show: !launchedAtLogin(), title: '截然', backgroundColor: appearance.colors()['bg-window'],
      titleBarStyle: 'hidden',
      ...(process.platform === 'darwin'
        ? { trafficLightPosition: { x: 16, y: 18 } }
        : { titleBarOverlay: { color: appearance.colors()['bg-chrome'], symbolColor: appearance.colors()['text-secondary'], height: 48 } }),
      ...(process.platform === 'win32' ? { icon: trayIconImage() } : {}),
      webPreferences
    });
    writePackagedTestResult({ stage: 'main-window-created' });
    mainWindow.on('close', (event) => { if (!quitting) { event.preventDefault(); mainWindow.hide(); } });
    mainWindow.webContents.on('render-process-gone', () => { controller?.abort(); });
    writePackagedTestResult({ stage: 'main-window-handlers-ready' });
    captureOverlayWindow = new CaptureOverlayWindow(webPreferencesFor(startupPerformanceSessionId), loadWindow, startupPerformanceSessionId, () => cleanupOverlay());
    screenshotToAllWindow = new ScreenshotToAllWindow(webPreferencesFor(startupPerformanceSessionId), loadWindow, startupPerformanceSessionId, positionQuickChat, () => closePinnedFlow(true));
    writePackagedTestResult({ stage: 'window-managers-ready' });
    updates = new UpdateCheckService({
      currentVersion: app.isPackaged ? app.getVersion() : sourceVersion,
      openExternal: url => shell.openExternal(url),
      installer: new ElectronUpdateInstaller({
        beforeInstall: () => {
          notesQuitReady = true; quitting = true;
          // Native Mac quitAndInstall closes windows before before-quit. These
          // reusable capture windows intercept close, so release only the idle
          // windows after the user confirms installation and notes are saved.
          captureOverlayWindow?.destroy();
          screenshotToAllWindow?.destroy();
        },
        onInstallError: () => {
          if (!mainWindow.isDestroyed()) { notesQuitReady = false; quitting = false; }
          updates.installationFailed();
        }
      }),
      prepareInstall: async () => {
        const busy = () => preparing || captureOverlayWindow?.isActive() || agentExecution.busy || controller || autoActionController;
        if (busy()) throw new Error('请先完成或停止当前任务');
        await flushNotesForAgent(new AbortController().signal);
        await notebooks.idle();
        if (busy()) throw new Error('请先完成或停止当前任务');
      },
      onChanged: state => {
        if (!quitting && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.send('updates:changed', state);
      }
    });
    setupIPC();
    writePackagedTestResult({ stage: 'ipc-ready' });
    const menu = Menu.buildFromTemplate([
      { label: '截然', submenu: [{ label: '显示截然', click: showMain }, { label: '查看日程', click: showSchedule }, { label: '普通截图与标注', click: () => { void startCapture('menu', undefined, 'standard').catch(announceError); } }, { label: 'AI 截图', click: () => { void startCapture('menu').catch(announceError); } }, { label: '续拍并继续对话', click: () => { void startContinuationCapture('continue-menu').catch(announceError); } }, { type: 'separator' }, { role: 'quit', label: '退出截然' }] },
      { label: '编辑', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
      { label: '窗口', submenu: [{ role: 'minimize' }, { role: 'toggleDevTools' }] }
    ]);
    Menu.setApplicationMenu(menu);
    if (process.platform === 'win32') {
      mainWindow.setAutoHideMenuBar(true);
      mainWindow.setMenuBarVisibility(false);
    }
    if (process.platform === 'darwin') app.dock?.setMenu(Menu.buildFromTemplate([
      { label: '显示截然', click: showMain },
      { label: '续拍并继续对话', click: () => { void startContinuationCapture('continue-menu').catch(announceError); } },
      { label: '查看日程', click: showSchedule }
    ]));
    writePackagedTestResult({ stage: 'menus-ready' });
    tray = new Tray(trayIconImage());
    tray.setToolTip('截然 — 截图、理解、行动');
    tray.setContextMenu(Menu.buildFromTemplate([{ label: '普通截图与标注', click: () => { void startCapture('menu', undefined, 'standard').catch(announceError); } }, { label: 'AI 截图', click: () => { void startCapture('tray').catch(announceError); } }, { label: '续拍并继续对话', click: () => { void startContinuationCapture('continue-menu').catch(announceError); } }, { label: '查看日程', click: showSchedule }, { label: '显示截然', click: showMain }, { type: 'separator' }, { label: '退出', role: 'quit' }]));
    if (process.platform === 'win32') tray.on('click', showMain);
    writePackagedTestResult({ stage: 'tray-ready' });
    if (!packagedTestInstance) {
      try { registerShortcuts(publicSettings()); } catch { startupError = '全局快捷键被占用，请在设置中修改；仍可使用菜单或截图按钮。'; }
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
    // Load only user-owned configuration, never a repository's mcp.json. Do not delay screenshot startup.
    void loadMCPConfig(join(agentMCPDirectory, 'servers.json')).then((config) => {
      if (!quitting) return agentMCP.start(config);
    }).catch(() => { if (!quitting) console.warn('[Snipvia MCP] MCP 配置无法加载'); });
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
let mcpShutdownComplete = false;
app.on('before-quit', (event) => {
  if (!notesQuitReady && mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed() && !mainWindow.webContents.isCrashed() && !mainWindow.webContents.isLoadingMainFrame()) {
    event.preventDefault();
    if (!notesQuitRequest) {
      notesQuitRequest = randomUUID(); mainWindow.webContents.send('notes:flush-request', notesQuitRequest);
      notesQuitTimer = setTimeout(() => { notesQuitRequest = null; showMain(); dialog.showErrorBox('笔记尚未保存', '笔记保存未完成，请回到 AI 笔记检查后再退出。'); }, 15_000);
    }
    return;
  }
  if (!mcpShutdownComplete) {
    event.preventDefault();
    void Promise.allSettled([agentMCP.stop(), notebooks.idle()]).finally(() => { notebooks.dispose(); mcpShutdownComplete = true; app.quit(); });
  }
  agentExecution?.clear();
  agentFileTools.executor.cancelAll();
  agentFileTools.changes.clearUndo();
  agentWebTools.pages.contents.clear();
  quitting = true;
  updates?.dispose();
  controller?.abort();
  for (const item of scheduleControllers.values()) item.abort();
  if (preparing || captureOverlayWindow?.isActive()) cleanupOverlay();
  closePinnedFlow(false);
  captureOverlayWindow?.destroy();
  screenshotToAllWindow?.destroy();
  void captureEngine?.dispose();
});
app.on('will-quit', () => globalShortcut.unregisterAll());
