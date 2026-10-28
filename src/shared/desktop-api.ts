import type { CapturePreferences } from './capture-preferences';
import type { CaptureBackendStatus, CaptureFramePayload, CaptureFrameQuality, CaptureOverlaySession, LoginItemState, PinnedCaptureState, Result, ScreenPermissionInfo, Selection } from './contracts';
import type { CaptureMode } from './capture-mode';
import type { ThemeMode, ThemeSnapshot } from './appearance';
import type { PerformanceMetadata, ScreenshotPerformanceEvent, ScreenshotPerformanceReport } from './performance';
import type { EditorCrop, EditorFinishRequest } from './screenshot-editor';

export type DesktopAPI = {
  collection: import('./collection').CollectionAPI;
  platform: NodeJS.Platform;
  window: { ready(role: 'capture' | 'pin' | 'shelf'): void };
  settings: {
    get(): Promise<Result<CapturePreferences>>;
    saveShortcuts(value: import('./capture-preferences').CapturePreferencesInput): Promise<Result<CapturePreferences>>;
    loginItem(): Promise<Result<LoginItemState>>;
    setLoginItem(enabled: boolean): Promise<Result<LoginItemState>>;
    onChanged(callback: (settings: CapturePreferences) => void): () => void;
  };
  appearance: { current(): ThemeSnapshot; set(mode: ThemeMode): Promise<Result<ThemeSnapshot>>; onChanged(callback: (value: ThemeSnapshot) => void): () => void };
  updates: import('./updates').UpdatesAPI;
  clipboard: { writeText(text: string): Promise<Result<void>> };
  storage: { reveal(): Promise<Result<void>> };
  screenshots: import('./screenshot').ScreenshotAPI;
  legacy: import('./legacy').LegacyAPI;
  browser: { openExternal(url: string): Promise<Result<void>> };
  permissions: {
    screen(): Promise<Result<ScreenPermissionInfo>>;
    openScreenSettings(): Promise<Result<void>>;
    revealApplication(): Promise<Result<void>>;
    copyApplicationPath(): Promise<Result<void>>;
  };
  capture: {
    start(mode?: CaptureMode | 'ai' | 'standard'): Promise<Result<void>>;
    editorCrop(value: { sessionId: string; selection: Selection }): Promise<Result<EditorCrop>>;
    editorFinish(value: EditorFinishRequest): Promise<Result<{ completed: boolean }>>;
    frame(): Promise<Result<CaptureFramePayload>>;
    finish(value: { sessionId: string; selection: Selection }): Promise<Result<void>>;
    cancel(): Promise<Result<void>>;
    sessionShellRendered(sessionId: string): Promise<Result<boolean>>;
    sessionRendered(sessionId: string): Promise<Result<boolean>>;
    sessionVisible(sessionId: string): Promise<Result<boolean>>;
    onSession(callback: (session: CaptureOverlaySession) => void): () => void;
    onFrameReady(callback: (sessionId: string) => void): () => void;
    onResetSession(callback: () => void): () => void;
    onError(callback: (error: string) => void): () => void;
  };
  pin: {
    current(): Promise<Result<PinnedCaptureState>>;
    close(): Promise<Result<void>>;
    move(value: { sessionId: string; x: number; y: number }): Promise<Result<void>>;
    copy(): Promise<Result<void>>;
    sessionRendered(sessionId: string): Promise<Result<boolean>>;
    sessionVisible(sessionId: string): Promise<Result<boolean>>;
    onSession(callback: (state: PinnedCaptureState) => void): () => void;
    onResetSession(callback: () => void): () => void;
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
