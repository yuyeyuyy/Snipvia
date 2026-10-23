import { launchDesktop } from '../helpers/desktop';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { arch, cpus, release, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ScreenshotPerformanceReport } from '../../src/shared/performance';

const realScreen = process.env.SNIPVIA_REAL_SCREEN === '1';
const resultPath = 'performance-results/screenshot-capture-phase5.json';
const mainMarker = [253, 1, 197] as const;
const pinMarker = [1, 237, 253] as const;
const chatMarker = [139, 253, 1] as const;

type Launched = { app: ElectronApplication; main: Page; overlay: Page; pin: Page; directory: string };

const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const percentile = (values: number[], ratio: number) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.ceil(values.length * ratio) - 1)];
const wait = (milliseconds: number) => new Promise<void>((resolveWait) => setTimeout(resolveWait, milliseconds));
const measure = (report: ScreenshotPerformanceReport, id: string) => report.measures.find((item) => item.id === id)?.durationMs;

async function launch(extraEnvironment: Record<string, string> = {}, expectHealthy = true): Promise<Launched> {
  const directory = await mkdtemp(join(tmpdir(), 'snipvia-phase5-'));
  const app = await launchDesktop({
    args: ['.', `--user-data-dir=${directory}`],
    env: {
      ...process.env,
      SNIPVIA_PERF: '',
      SNIPVIA_CAPTURE_BACKEND: 'sck',
      SNIPVIA_CAPTURE_WARMUP: '0',
      ...extraEnvironment
    }
  });
  const main = await app.firstWindow();
  await expect(main.getByRole('heading', { name: '设置', exact: true })).toBeVisible();
  await expect.poll(() => app.windows().some((window) => window.url().endsWith('#capture'))).toBe(true);
  await expect.poll(() => app.windows().some((window) => window.url().endsWith('#pin'))).toBe(true);
  const overlay = app.windows().find((window) => window.url().endsWith('#capture'))!;
  const pin = app.windows().find((window) => window.url().endsWith('#pin'))!;
  if (expectHealthy) {
    try {
      await expect.poll(async () => {
        const status = await main.evaluate(() => window.snipvia.performance.captureBackendStatus());
        return status.ok && status.value.screenCaptureKit?.healthy;
      }, { timeout: 10_000 }).toBe(true);
    } catch (error) {
      console.info('[Phase 5] backend status', await main.evaluate(() => window.snipvia.performance.captureBackendStatus()));
      throw error;
    }
  }
  return { app, main, overlay, pin, directory };
}

async function close(launched: Launched) {
  await launched.app.close();
  await rm(launched.directory, { recursive: true, force: true });
}

async function setMarker(page: Page, color: readonly [number, number, number], id: string) {
  await page.evaluate(({ color, id }) => {
    document.getElementById(id)?.remove();
    const marker = document.createElement('div');
    marker.id = id;
    marker.style.cssText = `position:fixed;left:48px;top:48px;width:180px;height:140px;z-index:2147483647;background:rgb(${color.join(',')})`;
    document.body.append(marker);
  }, { color, id });
}

async function countMarkers(overlay: Page, colors: ReadonlyArray<readonly [number, number, number]>) {
  return overlay.locator('.screen-frame').evaluate((element, expected) => {
    const image = element as HTMLImageElement;
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true })!;
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const counts = expected.map(() => 0);
    for (let y = 0; y < canvas.height; y += 8) {
      for (let x = 0; x < canvas.width; x += 8) {
        const offset = (y * canvas.width + x) * 4;
        expected.forEach((color, index) => {
          if (Math.abs(pixels[offset] - color[0]) <= 10 && Math.abs(pixels[offset + 1] - color[1]) <= 10 && Math.abs(pixels[offset + 2] - color[2]) <= 10) counts[index]++;
        });
      }
    }
    return counts;
  }, colors);
}

async function capture(launched: Launched, colors: ReadonlyArray<readonly [number, number, number]> = [], mode: 'quick' | 'edit' = 'quick') {
  await launched.main.bringToFront();
  const started = await launched.main.evaluate(mode => window.snipvia.capture.start(mode), mode);
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
  const markerCounts = colors.length ? await countMarkers(launched.overlay, colors) : [];
  const mainVisible = await launched.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => !window.webContents.getURL().includes('#'))?.isVisible() ?? false);
  return { sessionId, report: result.value, markerCounts, mainVisible };
}

async function cancelCapture(launched: Launched) {
  await launched.overlay.keyboard.press('Escape');
  await expect.poll(() => launched.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().endsWith('#capture'))?.isVisible() ?? false)).toBe(false);
}

function processSample(pid: number) {
  const output = execFileSync('/bin/ps', ['-o', '%cpu=,rss=', '-p', String(pid)], { encoding: 'utf8' }).trim().split(/\s+/);
  return { cpuPercent: Number(output[0]), residentKb: Number(output[1]) };
}

test.describe.serial('ScreenCaptureKit native bridge', () => {
  test.skip(!realScreen, 'Set SNIPVIA_REAL_SCREEN=1 to run real ScreenCaptureKit integration tests.');
  test.setTimeout(20 * 60_000);
  const output: Record<string, unknown> = { collectedAt: new Date().toISOString() };

  test('compares spawn, persistent helper, BGRA and Swift JPEG paths', async () => {
    console.info('[Phase 5] process strategy start');
    const strategies: Record<string, unknown> = {};
    for (const strategy of ['per-capture', 'persistent'] as const) {
      const candidate = await launch(strategy === 'per-capture' ? { SNIPVIA_SCK_PROCESS_STRATEGY: strategy } : {});
      try {
        const reports: ScreenshotPerformanceReport[] = [];
        const count = strategy === 'per-capture' ? 5 : 10;
        for (let index = 0; index < count; index++) {
          console.info(`[Phase 5] ${strategy} capture ${index + 1}/${count}`);
          const result = await capture(candidate);
          reports.push(result.report);
          await cancelCapture(candidate);
        }
        const metricB = reports.map((report) => Number(report.metrics.captureStartToOverlayVisibleMs));
        strategies[strategy] = {
          metricB,
          capture: reports.map((report) => measure(report, 'sck-capture')),
          requestToReady: reports.map((report) => measure(report, 'sck-request-frame-ready')),
          averageMs: average(metricB),
          warmAverageMs: average(metricB.slice(1))
        };
      } finally { await close(candidate); }
    }
    output.processStrategy = strategies;

    const formats: Record<string, unknown> = {};
    for (const format of ['bgra', 'jpeg'] as const) {
      console.info(`[Phase 5] integrated format ${format}`);
      const candidate = await launch({ SNIPVIA_SCK_FORMAT: format, ...(format === 'bgra' ? { SNIPVIA_SCK_TIMEOUT_MS: '2000' } : {}) });
      try {
        const reports: ScreenshotPerformanceReport[] = [];
        for (let index = 0; index < 10; index++) {
          console.info(`[Phase 5] ${format} ${index + 1}/10`);
          const result = await capture(candidate);
          reports.push(result.report);
          await cancelCapture(candidate);
        }
        formats[format] = {
          metricB: reports.map((report) => report.metrics.captureStartToOverlayVisibleMs),
          capture: reports.map((report) => measure(report, 'sck-capture')),
          nativeEncode: reports.map((report) => measure(report, 'sck-encode')),
          bridge: reports.map((report) => measure(report, 'sck-bridge')),
          electronEncode: reports.map((report) => measure(report, 'frame-to-jpeg')),
          payloadBytes: reports.map((report) => report.metadata.screenCaptureKitPayloadBytes),
          frameAge: reports.map((report) => report.metadata.frameAgeMs),
          fallbackCount: reports.filter((report) => report.metadata.captureFallbackUsed === true).length
        };
      } finally { await close(candidate); }
    }
    output.formats = formats;

    const comparison = await launch({ SNIPVIA_SCK_FORMAT: 'comparison', SNIPVIA_CAPTURE_BENCHMARK: '1', SNIPVIA_SCK_TIMEOUT_MS: '2000' });
    try {
      const result = await capture(comparison);
      const quality = await comparison.overlay.evaluate((id) => window.snipvia.performance.frameQuality(id), result.sessionId);
      if (!quality.ok) throw new Error(quality.error);
      output.sameFrameComparison = {
        inputFrameReused: true,
        rawBytes: result.report.metadata.screenCaptureKitRawBytes,
        jpegBytes: result.report.metadata.screenCaptureKitJpegBytes,
        rawEncodeMs: result.report.metadata.screenCaptureKitRawEncodeMs,
        jpegEncodeMs: result.report.metadata.screenCaptureKitJpegEncodeMs,
        quality: quality.value
      };
      await cancelCapture(comparison);
    } finally { await close(comparison); }
  });

  test('runs 100 captures with application exclusion and fast repeat', async () => {
    console.info('[Phase 5] 100-capture validation start');
    const launched = await launch({ SNIPVIA_SCK_FORMAT: 'jpeg' });
    try {
      console.info('[Phase 5] main marker');
      await setMarker(launched.main, mainMarker, 'phase5-main-marker');

      // Create ScreenshotToAll and QuickChat, then keep all three app surfaces visible
      // until ScreenCaptureKit has captured the next frame.
      const setup = await capture(launched, [], 'edit');
      console.info('[Phase 5] setup capture visible');
      await launched.overlay.mouse.move(40, 40);
      await launched.overlay.mouse.down();
      await launched.overlay.mouse.move(540, 340);
      await launched.overlay.mouse.up();
      await launched.overlay.getByRole('button', { name: '定住截图', exact: true }).click();
      await expect(launched.pin.getByAltText('置顶截图')).toBeVisible();
      console.info('[Phase 5] pin visible');
      await setMarker(launched.pin, pinMarker, 'phase5-pin-marker');
      expect(launched.app.windows().some(window => window.url().endsWith('#quick-chat'))).toBe(false);
      const statusBefore = await launched.main.evaluate(() => window.snipvia.performance.captureBackendStatus());
      if (!statusBefore.ok || !statusBefore.value.screenCaptureKit?.helperPid) throw new Error(statusBefore.ok ? 'helper pid missing before stress run' : statusBefore.error);
      const helperBefore = processSample(statusBefore.value.screenCaptureKit.helperPid);
      const appMemoryBeforeKb = await launched.app.evaluate(({ app }) => app.getAppMetrics().reduce((sum, metric) => sum + metric.memory.workingSetSize, 0));
      const resourceSamples = [{ captureIndex: 0, appMemoryKb: appMemoryBeforeKb, helper: helperBefore }];

      const samples: Array<Record<string, unknown>> = [];
      for (let index = 0; index < 100; index++) {
        if (index % 10 === 0) console.info(`[Phase 5] production capture ${index + 1}/100`);
        if (index === 1) {
          await launched.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => !window.webContents.getURL().includes('#'))?.setFullScreen(true));
          await expect.poll(() => launched.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => !window.webContents.getURL().includes('#'))?.isFullScreen() ?? false)).toBe(true);
        }
        const colors = index === 0 ? [mainMarker, pinMarker, chatMarker] : [mainMarker];
        const result = await capture(launched, colors);
        const mainFullScreen = await launched.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => !window.webContents.getURL().includes('#'))?.isFullScreen() ?? false);
        samples.push({
          captureIndex: index + 1,
          metricB: result.report.metrics.captureStartToOverlayVisibleMs,
          captureStartToPermissionMs: measure(result.report, 'capture-start-permission-check'),
          permissionCheckMs: measure(result.report, 'permission-check'),
          permissionToDisplayMs: measure(result.report, 'permission-display-gap'),
          displayResolveMs: measure(result.report, 'display-resolve'),
          displayToRequestMs: measure(result.report, 'display-sck-request-gap'),
          captureStartToRequestMs: measure(result.report, 'capture-start-sck-request'),
          captureMs: measure(result.report, 'sck-capture'),
          captureStartToNativeMs: measure(result.report, 'capture-start-sck-capture'),
          requestDispatchMs: measure(result.report, 'sck-request-dispatch'),
          requestToFrameReadyMs: measure(result.report, 'sck-request-frame-ready'),
          capturedToFrameReadyMs: measure(result.report, 'sck-captured-frame-ready'),
          encodeToBridgeGapMs: measure(result.report, 'sck-encode-bridge-gap'),
          nativeImageCreateMs: measure(result.report, 'sck-native-image-create'),
          bridgeMs: measure(result.report, 'sck-bridge'),
          encodeMs: measure(result.report, 'sck-encode'),
          frameEncodeMs: measure(result.report, 'frame-encode'),
          encodedToRendererMs: measure(result.report, 'encoded-renderer-received'),
          blobCreateMs: measure(result.report, 'frame-blob-create'),
          rendererDecodeMs: measure(result.report, 'renderer-received-image-ready'),
          imageReadyToShowMs: measure(result.report, 'image-ready-overlay-show-called'),
          overlayShowCallMs: measure(result.report, 'overlay-show-call'),
          paintMs: measure(result.report, 'overlay-show-paint-confirmed'),
          frameAgeMs: result.report.metadata.frameAgeMs,
          capturedAt: result.report.metadata.frameCapturedAtEpochMs,
          backend: result.report.metadata.captureBackend,
          fallbackUsed: result.report.metadata.captureFallbackUsed,
          displayMapping: result.report.metadata.screenCaptureKitDisplayMapping,
          markerCounts: result.markerCounts,
          mainVisible: result.mainVisible,
          mainFullScreen,
          sessionId: result.sessionId
        });
        await cancelCapture(launched);
        if (index === 1) {
          await launched.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => !window.webContents.getURL().includes('#'))?.setFullScreen(false));
          await expect.poll(() => launched.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => !window.webContents.getURL().includes('#'))?.isFullScreen() ?? false)).toBe(false);
        }
        if ((index + 1) % 10 === 0) {
          resourceSamples.push({
            captureIndex: index + 1,
            appMemoryKb: await launched.app.evaluate(({ app }) => app.getAppMetrics().reduce((sum, metric) => sum + metric.memory.workingSetSize, 0)),
            helper: processSample(statusBefore.value.screenCaptureKit.helperPid)
          });
        }
      }
      const metricB = samples.map((sample) => Number(sample.metricB));
      expect(samples.every((sample) => sample.backend === 'screen-capture-kit' && sample.fallbackUsed === false)).toBe(true);
      expect(samples.every((sample) => String(sample.displayMapping).startsWith('verified-'))).toBe(true);
      expect(samples.every((sample) => (sample.markerCounts as number[]).every((count) => count === 0))).toBe(true);
      expect(samples.every((sample) => sample.mainVisible === false)).toBe(true);
      expect(samples[1].mainFullScreen).toBe(true);
      expect(new Set(samples.map((sample) => sample.sessionId)).size).toBe(100);
      expect(samples.every((sample, index) => index === 0 || Number(sample.capturedAt) >= Number(samples[index - 1].capturedAt))).toBe(true);
      const status = await launched.main.evaluate(() => window.snipvia.performance.captureBackendStatus());
      if (!status.ok || !status.value.screenCaptureKit?.helperPid) throw new Error(status.ok ? 'helper pid missing' : status.error);
      await wait(2000);
      const helperIdle = processSample(status.value.screenCaptureKit.helperPid);
      const appMemoryKb = await launched.app.evaluate(({ app }) => app.getAppMetrics().reduce((sum, metric) => sum + metric.memory.workingSetSize, 0));
      const versions = await launched.app.evaluate(() => process.versions);
      output.environment = {
        osRelease: release(), architecture: arch(), cpu: cpus()[0]?.model ?? 'unknown',
        electron: versions.electron, node: versions.node,
        display: status.value.screenCaptureKit.displays[0]
      };
      output.production = {
        setupSession: setup.sessionId,
        samples,
        summary: {
          count: samples.length,
          p50: percentile(metricB, 0.5), p95: percentile(metricB, 0.95), max: Math.max(...metricB),
          average: average(metricB), failures: 0, fallbackCount: 0,
          frameAgeAverage: average(samples.map((sample) => Number(sample.frameAgeMs)))
        },
        helper: { ...status.value.screenCaptureKit, idle: helperIdle },
        resources: {
          appMemoryBeforeKb,
          appMemoryAfterKb: appMemoryKb,
          appMemoryGrowthKb: appMemoryKb - appMemoryBeforeKb,
          helperBefore,
          helperAfter: helperIdle,
          helperResidentGrowthKb: helperIdle.residentKb - helperBefore.residentKb,
          samples: resourceSamples
        }
      };
    } finally { await close(launched); }
  });

  test('falls back for crash, timeout, missing helper and denied permission', async () => {
    const fallback: Record<string, unknown> = {};
    for (const failure of ['crash', 'timeout'] as const) {
      const launched = await launch({ SNIPVIA_SCK_TEST_FAILURE: failure });
      try {
        const result = await capture(launched);
        expect(result.report.metadata).toMatchObject({ captureBackend: 'electron', captureFallbackUsed: true });
        fallback[failure] = {
          backend: result.report.metadata.captureBackend,
          reason: result.report.metadata.captureFallbackReason,
          metricB: result.report.metrics.captureStartToOverlayVisibleMs
        };
        await cancelCapture(launched);
        await launched.app.evaluate(() => { delete process.env.SNIPVIA_SCK_TEST_FAILURE; });
        await wait(1200);
        const recovered = await capture(launched);
        expect(recovered.report.metadata.captureBackend).toBe('screen-capture-kit');
        fallback[`${failure}Recovery`] = {
          backend: recovered.report.metadata.captureBackend,
          metricB: recovered.report.metrics.captureStartToOverlayVisibleMs
        };
        await cancelCapture(launched);
      } finally { await close(launched); }
    }

    const missing = await launch({ SNIPVIA_SCK_HELPER_PATH: '/private/tmp/snipvia-helper-does-not-exist' }, false);
    try {
      const result = await capture(missing);
      expect(result.report.metadata).toMatchObject({ captureBackend: 'electron', captureFallbackUsed: true });
      fallback.missing = { backend: result.report.metadata.captureBackend, reason: result.report.metadata.captureFallbackReason };
      await cancelCapture(missing);
      await missing.app.evaluate(({ systemPreferences }) => { systemPreferences.getMediaAccessStatus = () => 'denied'; });
      await missing.main.evaluate(() => window.snipvia.permissions.screen());
      const denied = await missing.main.evaluate(() => window.snipvia.capture.start());
      expect(denied.ok).toBe(false);
      fallback.permissionDenied = denied;
    } finally { await close(missing); }
    output.fallback = fallback;
    await mkdir('performance-results', { recursive: true });
    await writeFile(resultPath, JSON.stringify(output, null, 2));
  });
});
