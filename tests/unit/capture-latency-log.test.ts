import { it, expect } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { captureLatencySample, DevCaptureLatencyLog } from '../../src/main/performance/DevCaptureLatencyLog';
import type { ScreenshotPerformanceReport } from '../../src/shared/performance';
function report(id: string): ScreenshotPerformanceReport {
  return { sessionId: id, createdAt: '2026-10-24T00:00:00Z',
    metadata: { apiKey: 'never-log-this', screenshot: 'private-content', captureBackend: 'screen-capture-kit', overlayNativeWakeMs: 12, applicationHiddenAtCaptureStart: true },
    marks: [{ event: 'capture_overlay_shell_visible', source: 'renderer', atMs: 15, receivedAtMs: 17, elapsedMs: 15, metadata: { content: 'private-content' } }], metrics: {}, measures: [] };
}
it('retains only whitelisted numeric diagnostics, never arbitrary metadata or frame content', () => {
  const sample = captureLatencySample(report('one'), 'shell');
  expect(sample.metadata).toEqual({ applicationHiddenAtCaptureStart: true, overlayNativeWakeMs: 12 });
  expect(sample.marks[0]).toEqual({ event: 'capture_overlay_shell_visible', elapsedMs: 15, deliveryDelayMs: 2 });
  expect(JSON.stringify(sample)).not.toContain('private-content'); expect(JSON.stringify(sample)).not.toContain('never-log-this');
});
it('persists bounded sessions in order and replaces a session as its stages advance', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'snipvia-latency-')), path = join(directory, 'latency.json');
  try {
    const log = new DevCaptureLatencyLog(path, 2);
    log.record(report('one'), 'start'); log.record(report('two'), 'start');
    log.record(report('two'), 'visible'); log.record(report('three'), 'start');
    await log.flush();
    const data = JSON.parse(await readFile(path, 'utf8'));
    expect(data.samples.map((s: { sessionId: string; stage: string }) => [s.sessionId, s.stage])).toEqual([['two', 'visible'], ['three', 'start']]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
