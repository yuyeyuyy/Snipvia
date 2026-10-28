import { describe, expect, it } from 'vitest';
import { ScreenshotPerformanceRecorder } from '../../src/main/performance/screenshot-performance';
import { performance } from 'node:perf_hooks';
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
    recorder.mark(sessionId, 'clipboard_committed');
    recorder.mark(sessionId, 'collection_updated');
    recorder.mark(sessionId, 'shelf_feedback_visible', 'renderer');

    const report = recorder.report(sessionId);
    expect(performanceSessionIdSchema.parse(sessionId)).toBe(sessionId);
    expect(report?.metadata.trigger).toBe('hotkey');
    expect(report?.metrics.captureStartToOverlayShellVisibleMs).toBeGreaterThanOrEqual(0);
    expect(report?.metrics.hotkeyToOverlayVisibleMs).toBeGreaterThanOrEqual(0);
    expect(report?.metrics.selectionToScreenshotVisibleMs).toBeGreaterThanOrEqual(0);
    for (const id of ['selection-clipboard', 'selection-collection', 'selection-shelf']) {
      expect(report?.measures.find(measure => measure.id === id)?.durationMs).toBeGreaterThanOrEqual(0);
    }
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

it('keeps renderer occurrence and Main receipt distinct, rejecting future timestamps', () => {
  const recorder = new ScreenshotPerformanceRecorder();
  const id = recorder.startSession({}, performance.now() - 100);
  const occurred = performance.timeOrigin + performance.now() - 30;
  recorder.mark(id, 'selection_end', 'renderer', undefined, occurred);
  recorder.mark(id, 'clipboard_committed', 'main');
  const report = recorder.report(id)!;
  const mark = report.marks[0];
  expect(mark.receivedAtMs! - mark.atMs).toBeGreaterThan(20);
  expect(report.measures.find(m => m.id === 'selection-clipboard')!.durationMs).toBeGreaterThan(20);
  recorder.mark(id, 'output_failed', 'renderer', undefined, performance.timeOrigin + performance.now() + 60_000);
  const future = recorder.report(id)!.marks[2];
  expect(future.atMs).toBe(future.receivedAtMs);
});
