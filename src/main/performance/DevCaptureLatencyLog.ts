import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ScreenshotPerformanceReport } from '../../shared/performance';

export function captureLatencySample(report: ScreenshotPerformanceReport, stage: string) {
  const events = new Set(['hotkey_pressed', 'capture_start', 'capture_overlay_reuse_start',
    'capture_overlay_shell_show_called', 'capture_overlay_shell_show_returned', 'capture_overlay_shell_visible',
    'sck_request_sent', 'sck_capture_start', 'sck_capture_end', 'sck_encode_start', 'sck_encode_end',
    'sck_bridge_end', 'frame_capture_start', 'frame_capture_end', 'capture_frame_request',
    'capture_frame_ipc_return', 'frame_image_decode_end', 'capture_overlay_show_called',
    'capture_overlay_show_returned', 'capture_overlay_visible', 'capture_backend_fallback', 'capture_error']);
  const allowed = ['nativeHotkeyDispatchMs', 'overlayPreloadedAtEntry', 'applicationHiddenAtCaptureStart', 'overlayNativeWakeMs', 'overlayFocusedAtShellAck',
    'captureFallbackUsed', 'screenCaptureKitCaptureMs', 'screenCaptureKitEncodeMs',
    'screenCaptureKitRequestDurationMs', 'overlayReadyWaitMs'];
  const numericMetadata = Object.fromEntries(allowed.flatMap(key => {
    const value = report.metadata[key];
    return typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value) ? [[key, value]] : [];
  }));
  return {
    sessionId: report.sessionId, createdAt: report.createdAt, stage,
    backend: report.metadata.captureBackend === 'screen-capture-kit' ? 'screen-capture-kit'
      : report.metadata.captureBackend === 'electron' ? 'electron' : 'pending',
    metadata: numericMetadata,
    marks: report.marks.filter(mark => events.has(mark.event)).map(mark => ({
      event: mark.event, elapsedMs: mark.elapsedMs,
      ...(mark.receivedAtMs === undefined ? {} : { deliveryDelayMs: Math.max(0, mark.receivedAtMs - mark.atMs) })
    }))
  };
}

/** Explicitly enabled DEV-only diagnostics. No frame, model, clipboard or arbitrary metadata. */
export class DevCaptureLatencyLog {
  private samples = new Map<string, ReturnType<typeof captureLatencySample>>();
  private pending: Promise<void> = Promise.resolve();
  constructor(private readonly path: string, private readonly maximum = 30) {}
  record(report: ScreenshotPerformanceReport | null, stage: string) {
    if (!report) return;
    this.samples.set(report.sessionId, captureLatencySample(report, stage));
    while (this.samples.size > this.maximum) this.samples.delete(this.samples.keys().next().value!);
    const payload = JSON.stringify({ schema: 1, samples: [...this.samples.values()] }, null, 2) + '\n';
    this.pending = this.pending.catch(() => {}).then(async () => {
      await mkdir(dirname(this.path), { recursive: true });
      await writeFile(this.path + '.pending', payload, { mode: 0o600 });
      await rename(this.path + '.pending', this.path);
    }).catch(() => { console.warn('[Snipvia] Capture latency diagnostic write failed'); });
  }
  flush() { return this.pending; }
}
