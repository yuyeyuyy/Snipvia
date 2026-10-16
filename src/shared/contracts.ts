import type { EditorCrop, EditorFinishRequest } from './screenshot-editor';
import type { AgentExecutionAPI } from './agent/execution';
import type { AgentPermissionAPI } from './agent/permission';
import type { ThemeMode, ThemeSnapshot } from './appearance';
import { z } from 'zod';
import { isProviderEndpoint, providerIds } from './providers';
import { performanceSessionIdSchema, type PerformanceMetadata, type ScreenshotPerformanceEvent, type ScreenshotPerformanceReport } from './performance';
import { defaultPredictionBranches, predictionBranchListSchema, type AutoActionSnapshot, type ChatStreamEvent, type ScreenshotAction } from './screenshot-understanding';

export const settingsSchema = z.object({
  provider: z.enum(providerIds).default('custom'),
  endpoint: z.string().url().max(500).refine((value) => {
    const url = new URL(value);
    return !url.username && !url.password && !url.search && !url.hash &&
      ['https:', 'http:'].includes(url.protocol);
  }, '模型地址须使用 HTTP 或 HTTPS，且不能包含用户名、密码、查询参数或片段'),
  model: z.string().trim().min(1).max(200),
  shortcut: z.string().trim().min(1).max(100),
  editorShortcut: z.string().trim().min(1).max(100).default('CommandOrControl+Shift+A'),
  continueShortcut: z.string().trim().min(1).max(100).default('CommandOrControl+Shift+Enter'),
  predictionBranches: predictionBranchListSchema.default(defaultPredictionBranches)
}).refine((value) => isProviderEndpoint(value.provider, value.endpoint),
  { message: '厂商接口地址不匹配，请重新选择厂商', path: ['endpoint'] })
  .refine((value) => value.provider !== 'deepseek' || value.model !== 'deepseek-v4-pro',
    { message: 'DeepSeek V4 Pro 不支持图片输入，请选择 deepseek-flash', path: ['model'] })
  .refine((value) => value.shortcut !== value.continueShortcut,
    { message: '快捷键不能相同', path: ['continueShortcut'] })
  .refine((value) => value.editorShortcut !== value.shortcut && value.editorShortcut !== value.continueShortcut,
    { message: '普通截图快捷键不能与其他快捷键相同', path: ['editorShortcut'] });
export const saveSettingsSchema = settingsSchema.safeExtend({ apiKey: z.string().max(4096).optional() });
export const selectionSchema = z.object({
  x: z.number().finite().nonnegative(), y: z.number().finite().nonnegative(),
  width: z.number().finite().min(3), height: z.number().finite().min(3)
});
export const captureFinishSchema = z.object({ sessionId: performanceSessionIdSchema, selection: selectionSchema });
export const chatSchema = z.object({
  captureId: z.string().uuid(),
  question: z.string().trim().min(1).max(12000),
  performanceSessionId: performanceSessionIdSchema.optional()
});
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 YYYY-MM-DD').refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}, '日期不存在');
const instantSchema = z.string().datetime({ offset: true });
export const scheduleDraftSchema = z.object({
  kind: z.enum(['event', 'deadline']).default('event'),
  title: z.string().trim().min(1).max(200),
  allDay: z.boolean(),
  startAt: instantSchema.nullable(),
  endAt: instantSchema.nullable(),
  startDate: dateSchema.nullable(),
  endDate: dateSchema.nullable(),
  dueAt: instantSchema.nullable().default(null),
  dueDate: dateSchema.nullable().default(null),
  timezone: z.string().trim().min(1).max(100).refine((value) => {
    try { new Intl.DateTimeFormat('en', { timeZone: value }).format(); return true; } catch { return false; }
  }, '时区无效'),
  location: z.string().trim().max(500),
  people: z.array(z.string().trim().min(1).max(120)).max(50),
  notes: z.string().trim().max(5000),
  unresolvedFields: z.array(z.string().trim().min(1).max(200)).max(30),
  warnings: z.array(z.string().trim().min(1).max(500)).max(30)
}).superRefine((value, context) => {
  if (value.kind === 'deadline') {
    if (value.allDay && !value.dueDate) context.addIssue({ code: 'custom', message: '截止事项需要截止日期', path: ['dueDate'] });
    if (!value.allDay && !value.dueAt) context.addIssue({ code: 'custom', message: '截止事项需要截止时间', path: ['dueAt'] });
  } else if (value.allDay) {
    if (!value.startDate || !value.endDate) context.addIssue({ code: 'custom', message: '全天日程需要开始和结束日期' });
    if (value.startDate && value.endDate && value.endDate < value.startDate) {
      context.addIssue({ code: 'custom', message: '结束日期不能早于开始日期', path: ['endDate'] });
    }
  } else {
    if (!value.startAt || !value.endAt) context.addIssue({ code: 'custom', message: '日程需要开始和结束时间' });
    if (value.startAt && value.endAt && Date.parse(value.endAt) <= Date.parse(value.startAt)) {
      context.addIssue({ code: 'custom', message: '结束时间必须晚于开始时间', path: ['endAt'] });
    }
  }
});
export const scheduleSaveSchema = z.object({
  jobId: z.string().uuid(), eventId: z.string().uuid(), draft: scheduleDraftSchema
});
export const calendarSaveSchema = scheduleSaveSchema.extend({ calendarId: z.string().trim().min(1).max(500) });
export const reminderSaveSchema = scheduleSaveSchema.extend({ listId: z.string().trim().min(1).max(500) });

export type Settings = z.infer<typeof settingsSchema>;
export type ModelProfile = Pick<Settings, 'provider' | 'endpoint' | 'model'>;
export type PublicSettings = Settings & {
  hasApiKey: boolean;
  configuredServices: string[];
  configuredModels: ModelProfile[];
  credentialStorage: 'macos-keychain' | 'windows-dpapi' | 'system-secret-store';
};
export type Selection = z.infer<typeof selectionSchema>;
export type Capture = {
  id: string;
  conversationId: string;
  dataUrl: string;
  width: number;
  height: number;
  createdAt: string;
  performanceSessionId?: string;
  continuesConversation?: boolean;
};
export type Message = {
  images?: import('./chat-images').ChatImage[];
  editProposals?: import('./agent/editing').ProposalSummary[];
  /** Earlier successful answers retained when the user regenerates the latest turn. */
  previousAnswers?: string[];
  noteChanges?: import('./agent/note-writing').NoteChangeSummary[];
  role: 'user' | 'assistant';
  content: string;
  createdAt?: string;
  provider?: Settings['provider'];
  model?: string;
  sources?: import('./agent/sources').WebSource[];
};
export type ConversationSummary = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  profile: ModelProfile;
};
export type Conversation = ConversationSummary & { capture: Capture; messages: Message[] };
export type WorkspaceConversation = ConversationSummary & { capture?: Capture; messages: Message[] };
export type ChatState = { capture: Capture; messages: Message[]; performanceSessionId?: string; autoAction?: AutoActionSnapshot };
export type PinnedCaptureState = { localOnly?: boolean; checkingAccess?: boolean; capture: Capture; chatActive: boolean; performanceSessionId: string };
export type CaptureMode = 'ai' | 'standard';
export type CaptureOverlaySession = { mode: CaptureMode; performanceSessionId: string; frameReady: boolean; notice?: string };
export type ReusableWindowRole = 'capture' | 'pin' | 'quick-chat';
export type CaptureFrameTransport = 'data-url' | 'png-base64' | 'png-binary' | 'jpeg-90' | 'jpeg-95';
export type CaptureFramePayload = {
  performanceSessionId: string;
  width: number;
  height: number;
  visibilityRafCount: 1 | 2;
} & ({
  transport: 'data-url' | 'png-base64';
  mimeType: 'image/png';
  dataUrl: string;
} | {
  transport: 'png-binary' | 'jpeg-90' | 'jpeg-95';
  mimeType: 'image/png' | 'image/jpeg';
  bytes: Uint8Array;
});
export type CaptureFrameQuality = {
  meanAbsoluteError: number;
  peakSignalToNoiseRatio: number | null;
  maximumChannelError: number;
  sampledPixels: number;
};
export type CaptureBackendStatus = {
  preference: 'auto' | 'electron' | 'sck';
  screenCaptureKit: {
    available: boolean;
    healthy: boolean;
    helperPid?: number;
    helperPath: string;
    helperRestarts: number;
    displays: Array<{
      id: string;
      x: number;
      y: number;
      width: number;
      height: number;
      pixelWidth: number;
      pixelHeight: number;
      scaleFactor: number;
    }>;
    excludedApplicationFound: boolean;
    lastError?: string;
    state: 'starting' | 'ready' | 'degraded' | 'unhealthy' | 'restarting' | 'disabled';
    captureCount: number;
    successCount: number;
    failureCount: number;
    timeoutCount: number;
    consecutiveFailures: number;
    recentFailures: number;
    circuitOpenUntil?: number;
    lastCaptureDurationMs?: number;
    recentCaptureP95Ms?: number;
    displayCacheGeneration?: number;
    displayInvalidationCount: number;
  } | null;
  processes: Array<{
    pid: number;
    type: string;
    workingSetKb: number;
    privateBytesKb: number;
  }>;
};
export type ScheduleDraft = z.infer<typeof scheduleDraftSchema>;
export type ScheduleEvent = ScheduleDraft & {
  id: string;
  savedLocal: boolean;
  macCalendar?: { id: string; name: string; savedAt: string };
  macReminder?: { id: string; name: string; savedAt: string };
};
export type ScheduleJobSummary = {
  id: string;
  status: 'extracting' | 'draft' | 'failed';
  createdAt: string;
  updatedAt: string;
  title: string;
  eventCount: number;
  profile: ModelProfile;
  events: ScheduleEvent[];
  error?: string;
};
export type ScheduleJob = ScheduleJobSummary & {
  capture: Omit<Capture, 'conversationId'>;
};
export type MacCalendar = { id: string; name: string };
export type MacReminderList = { id: string; name: string };
export type ScreenPermissionInfo = {
  status: 'granted' | 'denied' | 'not-determined' | 'restricted' | 'unknown';
  applicationName: string;
  applicationPath: string;
  development: boolean;
  supported: boolean;
};
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
export type LoginItemState = { supported: boolean; enabled: boolean; description: string };
export type SnipviaAPI = {
  chatImages: import('./chat-images').ChatImagesAPI;
  updates: import('./updates').UpdatesAPI;
  account: import('./account').AccountAPI;
  notes: import('./notes').NotesAPI;
  agentPermissions: AgentPermissionAPI;
  agent: AgentExecutionAPI;
  editing: import('./agent/editing').EditingAPI;
  platform: NodeJS.Platform;
  window: {
    ready(role: ReusableWindowRole): void;
  };
  settings: {
    get(): Promise<Result<PublicSettings>>;
    save(value: Settings & { apiKey?: string }): Promise<Result<PublicSettings>>;
    loginItem(): Promise<Result<LoginItemState>>;
    setLoginItem(enabled: boolean): Promise<Result<LoginItemState>>;
    onChanged(callback: (settings: PublicSettings) => void): () => void;
  };
  appearance: {
    current(): ThemeSnapshot;
    set(mode: ThemeMode): Promise<Result<ThemeSnapshot>>;
    onChanged(callback: (theme: ThemeSnapshot) => void): () => void;
  };
  models: import('./models').ModelCatalogAPI;
  browser: { openExternal(url: string): Promise<Result<void>> };
  permissions: {
    screen(): Promise<Result<ScreenPermissionInfo>>;
    openScreenSettings(): Promise<Result<void>>;
    revealApplication(): Promise<Result<void>>;
    copyApplicationPath(): Promise<Result<void>>;
  };
  capture: {
    start(mode?: CaptureMode): Promise<Result<void>>;
    editorCrop(value: { sessionId: string; selection: Selection }): Promise<Result<EditorCrop>>;
    editorFinish(value: EditorFinishRequest): Promise<Result<{ completed: boolean }>>;
    import(): Promise<Result<Capture | null>>;
    current(): Promise<Result<Capture | null>>;
    frame(): Promise<Result<CaptureFramePayload>>;
    finish(value: { sessionId: string; selection: Selection }): Promise<Result<void>>;
    cancel(): Promise<Result<void>>;
    sessionShellRendered(sessionId: string): Promise<Result<boolean>>;
    sessionRendered(sessionId: string): Promise<Result<boolean>>;
    sessionVisible(sessionId: string): Promise<Result<boolean>>;
    onSession(callback: (session: CaptureOverlaySession) => void): () => void;
    onFrameReady(callback: (sessionId: string) => void): () => void;
    onResetSession(callback: () => void): () => void;
    onChanged(callback: (capture: Capture) => void): () => void;
    onResumeConversation(callback: (conversationId: string) => void): () => void;
    onError(callback: (error: string) => void): () => void;
  };
  pin: {
    current(): Promise<Result<PinnedCaptureState>>;
    close(): Promise<Result<void>>;
    copy(): Promise<Result<void>>;
    startChat(): Promise<Result<void>>;
    returnToApp(): Promise<Result<void>>;
    sessionRendered(sessionId: string): Promise<Result<boolean>>;
    sessionVisible(sessionId: string): Promise<Result<boolean>>;
    onSession(callback: (state: PinnedCaptureState) => void): () => void;
    onResetSession(callback: () => void): () => void;
    onChatState(callback: (active: boolean) => void): () => void;
  };
  chat: {
    state(): Promise<Result<ChatState>>;
    setExpanded(expanded: boolean): Promise<Result<void>>;
    saveImage(): Promise<Result<boolean>>;
    send(value: { captureId: string; question: string; performanceSessionId?: string }): Promise<Result<Message>>;
    stream(value: { captureId: string; question: string; performanceSessionId?: string }): Promise<Result<{ requestId: string }>>;
    cancel(): Promise<Result<void>>;
    onStream(callback: (event: ChatStreamEvent) => void): () => void;
  };
  autoAction: {
    actions(): Promise<Result<ScreenshotAction[]>>;
    state(): Promise<Result<AutoActionSnapshot | null>>;
    start(captureId: string): Promise<Result<void>>;
    cancel(): Promise<Result<void>>;
    userIntent(): Promise<Result<void>>;
    close(): Promise<Result<void>>;
    onChanged(callback: (state: AutoActionSnapshot) => void): () => void;
  };
  history: {
    onChanged(callback: () => void): () => void;
    list(): Promise<Result<ConversationSummary[]>>;
    create(): Promise<Result<WorkspaceConversation>>;
    read(id: string): Promise<Result<WorkspaceConversation>>;
    rename(id: string, title: string): Promise<Result<ConversationSummary>>;
    open(id: string): Promise<Result<Conversation>>;
    delete(id: string): Promise<Result<boolean>>;
    clear(): Promise<Result<boolean>>;
  };
  schedule: {
    list(): Promise<Result<ScheduleJobSummary[]>>;
    open(id: string): Promise<Result<ScheduleJob>>;
    save(value: { jobId: string; eventId: string; draft: ScheduleDraft }): Promise<Result<ScheduleJob>>;
    delete(id: string): Promise<Result<boolean>>;
    macCalendars(): Promise<Result<MacCalendar[]>>;
    macReminderLists(): Promise<Result<MacReminderList[]>>;
    saveToMac(value: { jobId: string; eventId: string; calendarId: string; draft: ScheduleDraft }): Promise<Result<ScheduleJob>>;
    saveToReminders(value: { jobId: string; eventId: string; listId: string; draft: ScheduleDraft }): Promise<Result<ScheduleJob>>;
    onChanged(callback: () => void): () => void;
    onNavigate(callback: () => void): () => void;
  };
  performance: {
    initialSessionId: string | null;
    mark(sessionId: string | null | undefined, event: ScreenshotPerformanceEvent, metadata?: PerformanceMetadata): void;
    report(sessionId: string): Promise<Result<ScreenshotPerformanceReport | null>>;
    startupReport(): Promise<Result<ScreenshotPerformanceReport | null>>;
    frameQuality(sessionId: string): Promise<Result<CaptureFrameQuality>>;
    captureBackendStatus(): Promise<Result<CaptureBackendStatus>>;
  };
};

export const defaults: Settings = {
  provider: 'openai', endpoint: 'https://api.openai.com/v1', model: 'gpt-6.1-sol',
  editorShortcut: 'CommandOrControl+Shift+A',
  shortcut: 'CommandOrControl+Shift+Space', continueShortcut: 'CommandOrControl+Shift+Enter',
  predictionBranches: defaultPredictionBranches.map((branch) => ({ ...branch }))
};
