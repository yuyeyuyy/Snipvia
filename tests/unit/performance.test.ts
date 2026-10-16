import { describe, expect, it } from 'vitest';
import { ScreenshotPerformanceRecorder } from '../../src/main/performance/screenshot-performance';
import { performanceSessionIdSchema } from '../../src/shared/performance';

describe('screenshot performance recorder', () => {
  it('correlates renderer and main events in one report', () => {
    const recorder = new ScreenshotPerformanceRecorder();
    const sessionId = recorder.startSession({ trigger: 'hotkey' });

    recorder.mark(sessionId, 'hotkey_pressed');
    recorder.mark(sessionId, 'capture_start');
    recorder.mark(sessionId, 'capture_overlay_shell_visible', 'renderer');
    recorder.mark(sessionId, 'capture_overlay_visible', 'renderer');
    recorder.mark(sessionId, 'selection_end', 'renderer');
    recorder.mark(sessionId, 'crop_start');
    recorder.mark(sessionId, 'crop_end');
    recorder.mark(sessionId, 'screenshot_to_all_visible', 'renderer');
    recorder.mark(sessionId, 'ai_request_start');
    recorder.mark(sessionId, 'ai_response_complete');

    const report = recorder.report(sessionId);
    expect(performanceSessionIdSchema.parse(sessionId)).toBe(sessionId);
    expect(report?.metadata.trigger).toBe('hotkey');
    expect(report?.metrics.captureStartToOverlayShellVisibleMs).toBeGreaterThanOrEqual(0);
    expect(report?.metrics.hotkeyToOverlayVisibleMs).toBeGreaterThanOrEqual(0);
    expect(report?.metrics.selectionToScreenshotVisibleMs).toBeGreaterThanOrEqual(0);
    expect(report?.metrics.aiRequestToCompleteMs).toBeGreaterThanOrEqual(0);
    expect(report?.measures.find((measure) => measure.id === 'crop')?.durationMs).toBeGreaterThanOrEqual(0);
    expect(report?.marks.find((mark) => mark.event === 'capture_overlay_visible')?.source).toBe('renderer');
  });

  it('does not mix concurrent sessions', () => {
    const recorder = new ScreenshotPerformanceRecorder();
    const first = recorder.startSession({ selectionWidthDip: 500 });
    const second = recorder.startSession({ selectionWidthDip: 1000 });

    recorder.mark(first, 'selection_end');
    recorder.mark(second, 'selection_end');
    recorder.mark(second, 'screenshot_to_all_visible');

    expect(recorder.report(first)?.metrics.selectionToScreenshotVisibleMs).toBeUndefined();
    expect(recorder.report(second)?.metrics.selectionToScreenshotVisibleMs).toBeGreaterThanOrEqual(0);
  });
});
