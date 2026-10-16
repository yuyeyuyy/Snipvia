import { launchMemberDesktop } from '../helpers/desktop-account';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { arch, cpus, release, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CaptureBackendStatus } from '../../src/shared/contracts';
import type { ScreenshotPerformanceReport } from '../../src/shared/performance';

const realScreen = process.env.SNIPVIA_REAL_SCREEN === '1';
const suite = process.env.SNIPVIA_PHASE6_SUITE ?? 'endurance';
const resultPath = 'performance-results/screenshot-capture-phase6.json';
const wait = (milliseconds: number) => new Promise<void>((resolveWait) => setTimeout(resolveWait, milliseconds));
const percentile = (values: number[], ratio: number) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.ceil(values.length * ratio) - 1)];
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const deviation = (values: number[]) => {
  const average = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length);
};
const measure = (report: ScreenshotPerformanceReport, id: string) => report.measures.find((item) => item.id === id)?.durationMs;
const mark = (report: ScreenshotPerformanceReport, event: string) => report.marks.find((item) => item.event === event)?.elapsedMs;

type Launched = { app: ElectronApplication; main: Page; overlay: Page; directory: string };

async function launch(environment: Record<string, string> = {}, healthy = true): Promise<Launched> {
  const directory = await mkdtemp(join(tmpdir(), 'snipvia-phase6-'));
  const app = await launchMemberDesktop({
    args: ['.', `--user-data-dir=${directory}`],
    env: {
      ...process.env,
      SNIPVIA_PERF: '',
      SNIPVIA_CAPTURE_BACKEND: 'sck',
      SNIPVIA_CAPTURE_WARMUP: '0',
      SNIPVIA_SCK_FORMAT: 'jpeg',
      ...environment
    }
  });
  const main = await app.firstWindow();
  await expect(main.getByRole('button', { name: 'AI 笔记', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect.poll(() => app.windows().some((window) => window.url().endsWith('#capture'))).toBe(true);
  const overlay = app.windows().find((window) => window.url().endsWith('#capture'))!;
  if (healthy) {
    await expect.poll(async () => {
      const status = await main.evaluate(() => window.snipvia.performance.captureBackendStatus());
      return status.ok ? status.value.screenCaptureKit?.state : 'error';
    }, { timeout: 10_000 }).toBe('ready');
  }
  return { app, main, overlay, directory };
}

async function close(launched: Launched) {
  await launched.app.close();
  await rm(launched.directory, { recursive: true, force: true });
}

async function backendStatus(main: Page) {
  const result = await main.evaluate(() => window.snipvia.performance.captureBackendStatus());
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

async function capture(launched: Launched) {
  const started = await launched.main.evaluate(() => window.snipvia.capture.start());
  if (!started.ok) throw new Error(started.error);
  await expect(launched.overlay.locator('.screen-frame')).toBeVisible();
  const sessionId = await launched.overlay.locator('.capture-overlay').getAttribute('data-performance-session');
  if (!sessionId) throw new Error('capture session missing');
  await expect.poll(async () => launched.overlay.evaluate(async (id) => {
    const report = await window.snipvia.performance.report(id);
    return report.ok ? report.value?.metrics.captureStartToOverlayVisibleMs : undefined;
  }, sessionId)).toBeGreaterThan(0);
  const result = await launched.overlay.evaluate((id) => window.snipvia.performance.report(id), sessionId);
  if (!result.ok || !result.value) throw new Error(result.ok ? 'performance report missing' : result.error);
  return result.value;
}

async function cancel(launched: Launched) {
  await launched.overlay.keyboard.press('Escape');
  await expect.poll(() => launched.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().endsWith('#capture'))?.isVisible() ?? false)).toBe(false);
}

function processSample(pid: number | undefined) {
  if (!pid) return null;
  try {
    const output = execFileSync('/bin/ps', ['-o', '%cpu=,rss=', '-p', String(pid)], { encoding: 'utf8' }).trim().split(/\s+/);
    return { pid, cpuPercent: Number(output[0]), residentKb: Number(output[1]) };
  } catch { return null; }
}

function memorySnapshot(status: CaptureBackendStatus) {
  const processes = status.processes.map((process) => ({ ...process }));
  return {
    totalWorkingSetKb: processes.reduce((sum, process) => sum + process.workingSetKb, 0),
    mainWorkingSetKb: processes.filter((process) => process.type === 'Browser').reduce((sum, process) => sum + process.workingSetKb, 0),
    rendererWorkingSetKb: processes.filter((process) => process.type === 'Tab').reduce((sum, process) => sum + process.workingSetKb, 0),
    gpuWorkingSetKb: processes.filter((process) => process.type === 'GPU').reduce((sum, process) => sum + process.workingSetKb, 0),
    processes,
    helper: processSample(status.screenCaptureKit?.helperPid)
  };
}

function sampleFrom(report: ScreenshotPerformanceReport, index: number, status: CaptureBackendStatus) {
  return {
    captureIndex: index,
    captureSessionId: report.sessionId,
    requestId: report.metadata.screenCaptureKitRequestId,
    captureStart: mark(report, 'capture_start'),
    nativeRequestSent: mark(report, 'sck_request_sent'),
    nativeCaptureStart: mark(report, 'sck_capture_start'),
    nativeCaptureEnd: mark(report, 'sck_capture_end'),
    jpegEncodeEnd: mark(report, 'sck_encode_end'),
    bridgeEnd: mark(report, 'sck_bridge_end'),
    rendererReceived: mark(report, 'capture_frame_ipc_return'),
    imageDecoded: mark(report, 'frame_image_decode_end'),
    overlayVisible: mark(report, 'capture_overlay_visible'),
    captureComplete: mark(report, 'capture_overlay_visible'),
    metricB: report.metrics.captureStartToOverlayVisibleMs,
    dispatchMs: measure(report, 'sck-request-dispatch'),
    sckMs: measure(report, 'sck-capture'),
    jpegMs: measure(report, 'sck-encode'),
    bridgeMs: measure(report, 'sck-bridge'),
    rendererDecodeMs: measure(report, 'renderer-received-image-ready'),
    overlayMs: measure(report, 'image-ready-overlay-visible'),
    helperPid: report.metadata.screenCaptureKitHelperPid,
    helperRestartCount: report.metadata.screenCaptureKitHelperRestarts,
    backend: report.metadata.captureBackend,
    fallbackUsed: report.metadata.captureFallbackUsed === true,
    fallbackReason: report.metadata.captureFallbackReason,
    timeout: String(report.metadata.captureFallbackReason ?? '').includes('timed out'),
    nativeImageConstructed: report.metadata.nativeImageConstructed,
    memory: memorySnapshot(status)
  };
}

function distribution(values: number[]) {
  return {
    count: values.length,
    p50: percentile(values, 0.5), p75: percentile(values, 0.75), p90: percentile(values, 0.9),
    p95: percentile(values, 0.95), p99: percentile(values, 0.99), max: Math.max(...values),
    mean: mean(values), standardDeviation: deviation(values)
  };
}

async function updateResult(section: string, value: unknown) {
  await mkdir('performance-results', { recursive: true });
  let result: Record<string, unknown> = {};
  try { result = JSON.parse(await readFile(resultPath, 'utf8')) as Record<string, unknown>; } catch { /* First Phase 6 suite. */ }
  result.collectedAt = new Date().toISOString();
  result[section] = value;
  await writeFile(resultPath, JSON.stringify(result, null, 2));
}

test.describe.serial('ScreenCaptureKit Phase 6 production hardening', () => {
  test.setTimeout(40 * 60_000);

  test('runs the configured realistic capture endurance and burst workload', async () => {
    test.skip(!realScreen || suite !== 'endurance', 'Run with SNIPVIA_REAL_SCREEN=1 and SNIPVIA_PHASE6_SUITE=endurance.');
    // Keep the default developer command light enough for an actively used Mac.
    // Release qualification runs must opt in to 500/1000 samples explicitly.
    const captureCount = Number(process.env.SNIPVIA_SCK_ENDURANCE_COUNT ?? 100);
    const burstCount = Number(process.env.SNIPVIA_SCK_BURST_COUNT ?? 20);
    const launched = await launch();
    const samples: Array<ReturnType<typeof sampleFrom>> = [];
    const burstSamples: Array<ReturnType<typeof sampleFrom>> = [];
    const failures: Array<{ captureIndex: number; error: string }> = [];
    const checkpoints: Record<string, unknown> = {};
    let randomState = 0x5f3759df;
    const nextDelay = () => {
      randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
      return [100, 300, 500, 1000, 2000][randomState % 5];
    };
    try {
      const initialStatus = await backendStatus(launched.main);
      checkpoints['0'] = memorySnapshot(initialStatus);
      for (let index = 1; index <= captureCount; index++) {
        try {
          const report = await capture(launched);
          const status = await backendStatus(launched.main);
          const sample = sampleFrom(report, index, status);
          samples.push(sample);
          if (Number(sample.metricB) > 250) console.info('[SLOW CAPTURE]', JSON.stringify(sample));
          await cancel(launched);
        } catch (error) {
          failures.push({ captureIndex: index, error: error instanceof Error ? error.message : 'unknown capture failure' });
        }
        if ([100, 250, 500, 1000].includes(index)) {
          const status = await backendStatus(launched.main);
          checkpoints[String(index)] = memorySnapshot(status);
          await updateResult('enduranceProgress', { completed: index, failures, checkpoints });
        }
        if (index % 25 === 0) console.info(`[Phase 6] endurance ${index}/${captureCount}`);
        await wait(nextDelay());
      }

      for (let index = 1; index <= burstCount; index++) {
        const report = await capture(launched);
        const status = await backendStatus(launched.main);
        burstSamples.push(sampleFrom(report, index, status));
        await cancel(launched);
      }
      await wait(2000);
      const finalStatus = await backendStatus(launched.main);
      const values = samples.map((sample) => Number(sample.metricB));
      const p95 = percentile(values, 0.95);
      const slowCaptures = samples.filter((sample) => Number(sample.metricB) >= p95 || Number(sample.metricB) > 250)
        .sort((left, right) => Number(right.metricB) - Number(left.metricB));
      const fallbackCount = samples.filter((sample) => sample.fallbackUsed).length;
      const timeoutCount = samples.filter((sample) => sample.timeout).length;
      const result = {
        environment: {
          osRelease: release(), architecture: arch(), cpu: cpus()[0]?.model ?? 'unknown',
          electron: process.versions.electron, displayCount: finalStatus.screenCaptureKit?.displays.length,
          displays: finalStatus.screenCaptureKit?.displays
        },
        requestedCaptureCount: captureCount,
        samples,
        summary: {
          ...distribution(values), failures: failures.length, timeoutCount, fallbackCount,
          failureRate: failures.length / captureCount,
          timeoutRate: timeoutCount / captureCount,
          fallbackRate: fallbackCount / captureCount
        },
        slowCaptures,
        checkpoints,
        finalMemory: memorySnapshot(finalStatus),
        helper: finalStatus.screenCaptureKit,
        cancelledWithoutNativeImageCount: samples.filter((sample) => sample.nativeImageConstructed === false).length,
        burst: {
          count: burstSamples.length,
          summary: distribution(burstSamples.map((sample) => Number(sample.metricB))),
          fallbackCount: burstSamples.filter((sample) => sample.fallbackUsed).length,
          samples: burstSamples
        }
      };
      await updateResult('endurance', result);
      expect(new Set(samples.map((sample) => sample.captureSessionId)).size).toBe(samples.length);
      expect(new Set(samples.map((sample) => sample.requestId)).size).toBe(samples.length);
      expect(failures.length / captureCount).toBeLessThan(0.01);
    } finally { await close(launched); }
  });

  test('measures timeout cost, helper recovery and circuit breaker behavior', async () => {
    test.skip(!realScreen || suite !== 'failure', 'Run with SNIPVIA_REAL_SCREEN=1 and SNIPVIA_PHASE6_SUITE=failure.');
    const timeoutCosts: Record<string, unknown> = {};
    for (const timeoutMs of [300, 400, 500]) {
      const launched = await launch({ SNIPVIA_SCK_TEST_FAILURE: 'timeout', SNIPVIA_SCK_TIMEOUT_MS: String(timeoutMs) });
      try {
        const report = await capture(launched);
        timeoutCosts[String(timeoutMs)] = {
          metricB: report.metrics.captureStartToOverlayVisibleMs,
          sckWaitMs: timeoutMs,
          electronCaptureMs: measure(report, 'desktop-capturer'),
          encodeMs: measure(report, 'frame-encode'),
          overlayMs: measure(report, 'image-ready-overlay-visible'),
          backend: report.metadata.captureBackend,
          reason: report.metadata.captureFallbackReason
        };
        await cancel(launched);
      } finally { await close(launched); }
    }

    const launched = await launch({ SNIPVIA_SCK_TEST_FAILURE: 'timeout' });
    try {
      const failedSessions: string[] = [];
      for (let index = 0; index < 3; index++) {
        const report = await capture(launched);
        failedSessions.push(report.sessionId);
        await cancel(launched);
      }
      const degraded = await backendStatus(launched.main);
      expect(degraded.screenCaptureKit?.state).toBe('degraded');
      const bypass = await capture(launched);
      await cancel(launched);
      expect(bypass.metadata.captureFallbackReason).toContain('circuit open');

      await launched.app.evaluate(() => { delete process.env.SNIPVIA_SCK_TEST_FAILURE; });
      const pidBeforeKill = degraded.screenCaptureKit?.helperPid;
      if (pidBeforeKill) {
        try { process.kill(pidBeforeKill, 'SIGKILL'); } catch { /* Circuit may already have stopped it. */ }
      }
      const failureResult = {
        timeoutCosts,
        circuitBreaker: {
          failedSessions,
          degraded: degraded.screenCaptureKit,
          bypassMetricB: bypass.metrics.captureStartToOverlayVisibleMs,
          bypassBackend: bypass.metadata.captureBackend,
          bypassReason: bypass.metadata.captureFallbackReason
        }
      };
      await updateResult('failure', failureResult);
    } finally { await close(launched); }

    const crash = await launch();
    try {
      const initial = await backendStatus(crash.main);
      const helperPid = initial.screenCaptureKit?.helperPid;
      if (!helperPid) throw new Error('helper pid missing');
      const pendingCapture = crash.main.evaluate(() => window.snipvia.capture.start());
      await wait(20);
      process.kill(helperPid, 'SIGKILL');
      const current = await pendingCapture;
      expect(current.ok).toBe(true);
      await expect(crash.overlay.locator('.screen-frame')).toBeVisible();
      const sessionId = await crash.overlay.locator('.capture-overlay').getAttribute('data-performance-session');
      if (!sessionId) throw new Error('capture session missing after helper crash');
      const currentReport = await crash.overlay.evaluate((id) => window.snipvia.performance.report(id), sessionId);
      await cancel(crash);
      await wait(1200);
      const recovered = await capture(crash);
      await cancel(crash);
      const idleStatus = await backendStatus(crash.main);
      const idlePid = idleStatus.screenCaptureKit?.helperPid;
      if (!idlePid) throw new Error('helper pid missing before idle kill');
      process.kill(idlePid, 'SIGKILL');
      await wait(50);
      const afterIdleKill = await capture(crash);
      await cancel(crash);
      await wait(700);
      const completed = await capture(crash);
      const completedStatus = await backendStatus(crash.main);
      const completedPid = completedStatus.screenCaptureKit?.helperPid;
      if (!completedPid) throw new Error('helper pid missing after completed capture');
      process.kill(completedPid, 'SIGKILL');
      await cancel(crash);
      await wait(700);
      const afterCompletedKill = await capture(crash);
      await cancel(crash);
      await updateResult('helperRestart', {
        killedPid: helperPid,
        currentCapture: currentReport.ok ? currentReport.value : currentReport,
        nextCaptureBackend: recovered.metadata.captureBackend,
        nextCaptureSessionId: recovered.sessionId,
        idleKill: { killedPid: idlePid, backend: afterIdleKill.metadata.captureBackend, sessionId: afterIdleKill.sessionId },
        completedKill: {
          killedPid: completedPid,
          completedSessionId: completed.sessionId,
          nextBackend: afterCompletedKill.metadata.captureBackend,
          nextSessionId: afterCompletedKill.sessionId
        },
        status: (await backendStatus(crash.main)).screenCaptureKit
      });
      expect(recovered.metadata.captureBackend).toBe('screen-capture-kit');
      expect(afterCompletedKill.metadata.captureBackend).toBe('screen-capture-kit');
    } finally { await close(crash); }
  });

  test('validates display mapping and explicit cache invalidation', async () => {
    test.skip(!realScreen || suite !== 'display', 'Run with SNIPVIA_REAL_SCREEN=1 and SNIPVIA_PHASE6_SUITE=display.');
    const launched = await launch();
    try {
      const before = await backendStatus(launched.main);
      const electronDisplays = await launched.app.evaluate(({ screen }) => screen.getAllDisplays().map((display) => ({
        id: String(display.id), bounds: display.bounds, size: display.size, scaleFactor: display.scaleFactor
      })));
      const report = await capture(launched);
      await cancel(launched);
      await launched.app.evaluate(({ screen }) => {
        const display = screen.getPrimaryDisplay();
        screen.emit('display-metrics-changed', {} as Electron.Event, display, ['bounds']);
      });
      await expect.poll(async () => (await backendStatus(launched.main)).screenCaptureKit?.displayInvalidationCount).toBe((before.screenCaptureKit?.displayInvalidationCount ?? 0) + 1);
      const afterInvalidation = await backendStatus(launched.main);
      const afterReport = await capture(launched);
      await cancel(launched);
      await updateResult('display', {
        electronDisplays,
        screenCaptureKitDisplays: before.screenCaptureKit?.displays,
        displayCount: electronDisplays.length,
        mixedDpiAvailable: new Set(electronDisplays.map((display) => display.scaleFactor)).size > 1,
        firstMapping: report.metadata.screenCaptureKitDisplayMapping,
        secondMapping: afterReport.metadata.screenCaptureKitDisplayMapping,
        cacheGenerationBefore: before.screenCaptureKit?.displayCacheGeneration,
        afterInvalidation: afterInvalidation.screenCaptureKit,
        cacheGenerationAfterCapture: (await backendStatus(launched.main)).screenCaptureKit?.displayCacheGeneration
      });
      expect(report.metadata.screenCaptureKitDisplayMapping).toMatch(/^verified-/);
      expect(afterReport.metadata.screenCaptureKitDisplayMapping).toMatch(/^verified-/);
    } finally { await close(launched); }
  });
});
