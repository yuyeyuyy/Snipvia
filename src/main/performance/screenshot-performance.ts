import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type {
  PerformanceMetadata,
  ScreenshotPerformanceEvent,
  ScreenshotPerformanceMark,
  ScreenshotPerformanceMeasure,
  ScreenshotPerformanceReport,
  ScreenshotPerformanceSource
} from '../../shared/performance';

type Session = {
  id: string;
  createdAt: string;
  startedAt: number;
  metadata: PerformanceMetadata;
  marks: ScreenshotPerformanceMark[];
  summaries: Set<string>;
};

type MeasureDefinition = Omit<ScreenshotPerformanceMeasure, 'durationMs' | 'warning'> & {
  startMetadata?: PerformanceMetadata;
  endMetadata?: PerformanceMetadata;
};

const measureDefinitions: MeasureDefinition[] = [
  { id: 'output-queue-wait', label: 'Output Queue Wait', start: 'output_queued', end: 'output_encode_start', category: 'local' },
  { id: 'selection-output-queued', label: 'Selection → Output Queued', start: 'selection_end', end: 'output_queued', category: 'local' },
  { id: 'selection-overlay-closed', label: 'Selection → Overlay Closed', start: 'selection_end', end: 'overlay_closed', category: 'local' },
  { id: 'output-encode', label: 'Output Crop + PNG (off Main)', start: 'output_encode_start', end: 'output_encode_end', category: 'local' },
  { id: 'clipboard-write', label: 'System Clipboard Commit', start: 'clipboard_write_start', end: 'clipboard_committed', category: 'local' },
  { id: 'selection-collection', label: 'Selection → Collection Updated', start: 'selection_end', end: 'collection_updated', category: 'local' },
  { id: 'selection-shelf', label: 'Selection → Shelf Feedback Visible', start: 'selection_end', end: 'shelf_feedback_visible', category: 'local' },
  { id: 'shelf-expand', label: 'Shelf Expand → Interactive', start: 'shelf_expand_start', end: 'shelf_interactive', category: 'local' },
  { id: 'shelf-reorder', label: 'Shelf Reorder → Updated', start: 'shelf_reorder_start', end: 'shelf_reorder_updated', category: 'local' },
  { id: 'selection-clipboard', label: 'Selection → Clipboard Committed', start: 'selection_end', end: 'clipboard_committed', category: 'local' },
  { id: 'capture-overlay-preload', label: 'CaptureOverlay Startup Preload', start: 'window_preload_start', startMetadata: { window: 'capture-overlay' }, end: 'window_preload_ready', endMetadata: { window: 'capture-overlay' }, category: 'local' },
  { id: 'screenshot-window-preload', label: 'ScreenshotToAll Startup Preload', start: 'window_preload_start', startMetadata: { window: 'screenshot-to-all' }, end: 'window_preload_ready', endMetadata: { window: 'screenshot-to-all' }, category: 'local' },
  { id: 'main-window-hide', label: 'Main Window Hide', start: 'main_window_hide_called', end: 'main_window_hidden', category: 'local' },
  { id: 'capture-engine-warmup', label: 'Capture Engine Background Warm-up', start: 'capture_engine_warmup_start', end: 'capture_engine_warmup_end', category: 'local' },
  { id: 'capture-warmup-wait', label: 'Capture Waited for Background Warm-up', start: 'capture_warmup_wait_start', end: 'capture_warmup_wait_end', category: 'local' },
  { id: 'capture-start-permission-check', label: 'Capture Start → Permission Check', start: 'capture_start', end: 'permission_check_start', category: 'local' },
  { id: 'permission-check', label: 'Screen Recording Permission Check', start: 'permission_check_start', end: 'permission_check_end', category: 'local' },
  { id: 'permission-display-gap', label: 'Permission Check → Display Resolve', start: 'permission_check_end', end: 'display_resolve_start', category: 'local' },
  { id: 'display-resolve', label: 'Capture Display Resolve', start: 'display_resolve_start', end: 'display_resolve_end', category: 'local' },
  { id: 'display-sck-request-gap', label: 'Display Resolve → SCK Request', start: 'display_resolve_end', end: 'sck_request_sent', category: 'local' },
  { id: 'capture-start-main-hidden', label: 'Capture Start → Main Hidden', start: 'capture_start', end: 'main_window_hidden', category: 'local' },
  { id: 'main-hidden-capture-ready', label: 'Main Hidden → Capture Ready', start: 'main_window_hidden', end: 'capture_readiness_end', category: 'local' },
  { id: 'capture-ready-frame-captured', label: 'Capture Ready → Frame Captured', start: 'capture_readiness_end', end: 'frame_capture_end', category: 'local' },
  { id: 'capture-readiness', label: 'Capture Readiness Wait', start: 'capture_readiness_start', end: 'capture_readiness_end', category: 'local' },
  { id: 'desktop-capturer', label: 'desktopCapturer', start: 'frame_capture_start', startMetadata: { backend: 'electron' }, end: 'frame_capture_end', endMetadata: { backend: 'electron' }, category: 'local' },
  { id: 'capture-start-sck-capture', label: 'Capture Start → SCK Capture', start: 'capture_start', end: 'sck_capture_start', category: 'local' },
  { id: 'capture-start-sck-request', label: 'Capture Start → SCK Request', start: 'capture_start', end: 'sck_request_sent', category: 'local' },
  { id: 'sck-request-dispatch', label: 'SCK Request Dispatch', start: 'sck_request_sent', end: 'sck_capture_start', category: 'local' },
  { id: 'sck-capture', label: 'ScreenCaptureKit Capture', start: 'sck_capture_start', end: 'sck_capture_end', category: 'local' },
  { id: 'sck-encode', label: 'ScreenCaptureKit Encode', start: 'sck_encode_start', end: 'sck_encode_end', category: 'local' },
  { id: 'sck-bridge', label: 'ScreenCaptureKit Binary Bridge', start: 'sck_bridge_start', end: 'sck_bridge_end', category: 'local' },
  { id: 'sck-encode-bridge-gap', label: 'SCK Encode Complete → Bridge Start', start: 'sck_encode_end', end: 'sck_bridge_start', category: 'local' },
  { id: 'sck-native-image-create', label: 'SCK Bridge Complete → NativeImage Ready', start: 'sck_bridge_end', end: 'sck_frame_ready', category: 'local' },
  { id: 'sck-request-frame-ready', label: 'SCK Request → Frame Ready', start: 'sck_request_sent', end: 'sck_frame_ready', category: 'local' },
  { id: 'sck-captured-frame-ready', label: 'SCK Captured → Frame Ready', start: 'sck_capture_end', end: 'sck_frame_ready', category: 'local' },
  { id: 'overlay-window-create', label: 'Overlay Window Create', start: 'overlay_window_create_start', end: 'overlay_window_create_end', category: 'local' },
  { id: 'overlay-renderer-load', label: 'Overlay Renderer Load', start: 'overlay_load_start', end: 'overlay_did_finish_load', category: 'local' },
  { id: 'overlay-react-mount', label: 'Overlay did-finish-load → React', start: 'overlay_did_finish_load', end: 'react_mount', endMetadata: { page: 'capture' }, category: 'local' },
  { id: 'fullscreen-data-url', label: 'Fullscreen PNG + Base64', start: 'frame_to_data_url_start', end: 'frame_to_data_url_end', category: 'local' },
  { id: 'frame-encode', label: 'Frame Encode', start: 'frame_encode_start', end: 'frame_encode_end', category: 'local' },
  { id: 'frame-to-png', label: 'NativeImage.toPNG', start: 'frame_to_png_start', end: 'frame_to_png_end', category: 'local' },
  { id: 'frame-to-jpeg', label: 'NativeImage.toJPEG', start: 'frame_to_jpeg_start', end: 'frame_to_jpeg_end', category: 'local' },
  { id: 'frame-base64', label: 'Frame Buffer → Base64', start: 'frame_base64_start', end: 'frame_base64_end', category: 'local' },
  { id: 'frame-captured-encoded', label: 'Frame Captured → Encoded', start: 'frame_capture_end', end: 'frame_encode_end', category: 'local' },
  { id: 'encoded-renderer-received', label: 'Encoded → Renderer Received', start: 'frame_encode_end', end: 'capture_frame_ipc_return', category: 'local' },
  { id: 'frame-blob-create', label: 'Renderer Blob/Object URL', start: 'frame_blob_create_start', end: 'frame_blob_create_end', category: 'local' },
  { id: 'renderer-received-image-ready', label: 'Renderer Received → Image Ready', start: 'capture_frame_ipc_return', end: 'frame_image_decode_end', category: 'local' },
  { id: 'image-ready-overlay-show-called', label: 'Image Ready → Overlay Show Called', start: 'frame_image_decode_end', end: 'capture_overlay_show_called', category: 'local' },
  { id: 'overlay-show-call', label: 'Overlay Show Call', start: 'capture_overlay_show_called', end: 'capture_overlay_show_returned', category: 'local' },
  { id: 'overlay-show-paint-confirmed', label: 'Overlay Show → Paint Confirmed', start: 'capture_overlay_show_returned', end: 'capture_overlay_visible', category: 'local' },
  { id: 'image-ready-overlay-visible', label: 'Image Ready → Overlay Visible', start: 'frame_image_decode_end', end: 'capture_overlay_visible', category: 'local' },
  { id: 'overlay-image-decode', label: 'Overlay IPC + Image Decode', start: 'capture_frame_ipc_return', end: 'capture_overlay_image_loaded', category: 'local' },
  { id: 'overlay-image-paint', label: 'Overlay Image Paint', start: 'capture_overlay_image_loaded', end: 'capture_overlay_visible', category: 'local' },
  { id: 'overlay-react-visible', label: 'Overlay React → Screenshot Visible', start: 'react_mount', startMetadata: { page: 'capture' }, end: 'capture_overlay_visible', category: 'local' },
  { id: 'capture-shell-response', label: 'Capture Start → Immediate Overlay', start: 'capture_start', end: 'capture_overlay_shell_visible', category: 'local' },
  { id: 'capture-shell-show-call', label: 'Immediate Overlay Show Call', start: 'capture_overlay_shell_show_called', end: 'capture_overlay_shell_show_returned', category: 'local' },
  { id: 'capture-overlay-reuse', label: 'CaptureOverlay Reuse → Visible', start: 'capture_overlay_reuse_start', end: 'capture_overlay_reuse_visible', category: 'local' },
  { id: 'capture-finish-ipc', label: 'Capture Finish IPC', start: 'capture_finish_ipc_start', end: 'capture_finish_main_received', category: 'local' },
  { id: 'selection-validation', label: 'Selection Validation', start: 'selection_validation_start', end: 'selection_validation_end', category: 'local' },
  { id: 'coordinate-conversion', label: 'Coordinate Conversion', start: 'coordinate_conversion_start', end: 'coordinate_conversion_end', category: 'local' },
  { id: 'crop', label: 'Crop', start: 'crop_start', end: 'crop_end', category: 'local' },
  { id: 'resize', label: 'Resize', start: 'resize_start', end: 'resize_end', category: 'local' },
  { id: 'jpeg-encode', label: 'JPEG Encode', start: 'jpeg_encode_start', end: 'jpeg_encode_end', category: 'local' },
  { id: 'base64-check', label: 'Base64 #1', start: 'base64_check_start', end: 'base64_check_end', category: 'local' },
  { id: 'pin-window-create', label: 'Pin Window Create', start: 'pin_window_create_start', end: 'pin_window_create_end', category: 'local' },
  { id: 'pin-renderer-load', label: 'Pin Renderer Load', start: 'pin_load_start', end: 'pin_did_finish_load', category: 'local' },
  { id: 'pin-react-mount', label: 'Pin did-finish-load → React', start: 'pin_did_finish_load', end: 'react_mount', endMetadata: { page: 'pin' }, category: 'local' },
  { id: 'pin-current-ipc', label: 'Pin Current IPC', start: 'pin_current_request', end: 'pin_current_received', category: 'local' },
  { id: 'pin-image-decode', label: 'Pin Image Decode', start: 'pin_image_load_start', end: 'pin_image_load_end', category: 'local' },
  { id: 'pin-image-paint', label: 'Pin Image Paint', start: 'pin_image_load_end', end: 'screenshot_to_all_visible', category: 'local' },
  { id: 'pin-react-visible', label: 'Pin React → Screenshot Visible', start: 'react_mount', startMetadata: { page: 'pin' }, end: 'screenshot_to_all_visible', category: 'local' },
  { id: 'screenshot-window-reuse', label: 'ScreenshotToAll Reuse → Visible', start: 'screenshot_window_reuse_start', end: 'screenshot_window_reuse_visible', category: 'local' },
];

function warningFor(durationMs: number): ScreenshotPerformanceMeasure['warning'] {
  if (durationMs > 100) return 'very-slow';
  if (durationMs > 50) return 'slow';
  if (durationMs > 16) return 'notice';
  return undefined;
}

function sameMetadata(actual: PerformanceMetadata | undefined, expected: PerformanceMetadata | undefined) {
  if (!expected) return true;
  return Object.entries(expected).every(([key, value]) => actual?.[key] === value);
}

export class ScreenshotPerformanceRecorder {
  private readonly sessions = new Map<string, Session>();
  private readonly output = process.env.SNIPVIA_PERF === 'trace' ? 'trace' : process.env.SNIPVIA_PERF === '1' ? 'summary' : 'none';

  startSession(metadata: PerformanceMetadata = {}, startedAt = performance.now()) {
    const id = `capture_${Date.now()}_${randomUUID().slice(0, 8)}`;
    this.sessions.set(id, {
      id,
      createdAt: new Date().toISOString(),
      startedAt,
      metadata: { ...metadata },
      marks: [],
      summaries: new Set()
    });
    this.prune();
    return id;
  }

  mark(sessionId: string | null | undefined, event: ScreenshotPerformanceEvent, source: ScreenshotPerformanceSource = 'main', metadata?: PerformanceMetadata, sourceTimestampMs?: number) {
    if (!sessionId) return;
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const receivedAtMs = performance.now();
    const origin = sourceTimestampMs === undefined ? receivedAtMs : sourceTimestampMs - performance.timeOrigin;
    const atMs = Number.isFinite(origin) && origin >= session.startedAt && origin <= receivedAtMs + 50 && receivedAtMs - origin < 60_000 ? Math.min(origin, receivedAtMs) : receivedAtMs;
    const mark: ScreenshotPerformanceMark = {
      event,
      source,
      atMs,
      ...(sourceTimestampMs === undefined ? {} : { receivedAtMs }),
      elapsedMs: atMs - session.startedAt,
      ...(metadata ? { metadata: { ...metadata } } : {})
    };
    session.marks.push(mark);
    if (this.output === 'trace') {
      console.info(`[Snipvia Performance] ${sessionId} ${event} +${mark.elapsedMs.toFixed(2)}ms${metadata ? ` ${JSON.stringify(metadata)}` : ''}`);
    }
    if (event === 'clipboard_committed') this.printSummary(sessionId, 'clipboard');
    if (event === 'screenshot_to_all_visible') this.printSummary(sessionId, 'screenshot');
    if (event === 'capture_cancelled' || event === 'capture_error') this.printSummary(sessionId, 'closed');
  }

  updateMetadata(sessionId: string | null | undefined, metadata: PerformanceMetadata) {
    if (!sessionId) return;
    const session = this.sessions.get(sessionId);
    if (session) Object.assign(session.metadata, metadata);
  }

  report(sessionId: string): ScreenshotPerformanceReport | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    const duration = (start: ScreenshotPerformanceEvent, end: ScreenshotPerformanceEvent) => {
      const startMark = this.findMark(session, start);
      const endMark = this.findMark(session, end);
      return startMark && endMark && endMark.atMs >= startMark.atMs ? endMark.atMs - startMark.atMs : undefined;
    };
    const measures = measureDefinitions.flatMap((definition) => {
      const start = this.findMark(session, definition.start, definition.startMetadata);
      const end = this.findMark(session, definition.end, definition.endMetadata);
      if (!start || !end || end.atMs < start.atMs) return [];
      const durationMs = end.atMs - start.atMs;
      return [{
        id: definition.id,
        label: definition.label,
        start: definition.start,
        end: definition.end,
        category: definition.category,
        durationMs,
        ...(definition.category === 'local' ? { warning: warningFor(durationMs) } : {})
      }];
    });
    return {
      sessionId: session.id,
      createdAt: session.createdAt,
      metadata: { ...session.metadata },
      metrics: {
        selectionToScreenshotVisibleMs: duration('selection_end', 'screenshot_to_all_visible'),
        hotkeyToOverlayVisibleMs: duration('hotkey_pressed', 'capture_overlay_visible'),
        captureStartToOverlayVisibleMs: duration('capture_start', 'capture_overlay_visible'),
        captureStartToOverlayShellVisibleMs: duration('capture_start', 'capture_overlay_shell_visible')
      },
      measures,
      marks: session.marks.map((mark) => ({ ...mark, ...(mark.metadata ? { metadata: { ...mark.metadata } } : {}) }))
    };
  }

  private findMark(session: Session, event: ScreenshotPerformanceEvent, metadata?: PerformanceMetadata) {
    return session.marks.find((mark) => mark.event === event && sameMetadata(mark.metadata, metadata));
  }

  private printSummary(sessionId: string, phase: string) {
    if (this.output === 'none') return;
    const session = this.sessions.get(sessionId);
    if (!session || session.summaries.has(phase)) return;
    session.summaries.add(phase);
    const report = this.report(sessionId);
    if (!report) return;
    const metric = (label: string, value: number | undefined) => `${label.padEnd(42)}${value === undefined ? 'pending' : `${value.toFixed(2)}ms`}`;
    const lines = [
      '==================================================',
      'Snipvia Screenshot Performance',
      `Session: ${sessionId}`,
      metric('Metric A  Selection End → Screenshot Visible', report.metrics.selectionToScreenshotVisibleMs),
      metric('Shortcut Response → Immediate Overlay', report.metrics.captureStartToOverlayShellVisibleMs),
      metric('Metric B  Hotkey → Overlay Visible', report.metrics.hotkeyToOverlayVisibleMs ?? report.metrics.captureStartToOverlayVisibleMs),
      '--------------------------------------------------'
    ];
    for (const measure of report.measures) {
      const warning = measure.warning === 'very-slow' ? '[VERY SLOW] ' : measure.warning === 'slow' ? '[SLOW] ' : measure.warning === 'notice' ? '[NOTICE] ' : '';
      lines.push(`${warning}${measure.label.padEnd(Math.max(1, 34 - warning.length))}${measure.durationMs.toFixed(2)}ms${measure.category === 'network' ? ' [NETWORK]' : ''}`);
    }
    lines.push('==================================================');
    console.info(lines.join('\n'));
  }

  private prune() {
    while (this.sessions.size > 30) {
      const oldest = this.sessions.keys().next().value as string | undefined;
      if (!oldest) return;
      this.sessions.delete(oldest);
    }
  }
}

export const screenshotPerformance = new ScreenshotPerformanceRecorder();
