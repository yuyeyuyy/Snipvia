import { launchMemberDesktop } from '../helpers/desktop-account';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CaptureFrameQuality } from '../../src/shared/contracts';
import type { ScreenshotPerformanceReport } from '../../src/shared/performance';

const realScreen = process.env.SNIPVIA_REAL_SCREEN === '1';
const mainMarker = [253, 1, 197] as const;
const pinMarker = [1, 239, 211] as const;
const chatMarker = [251, 113, 7] as const;
const overlayMarker = [113, 1, 251] as const;
const resultDirectory = 'performance-results';

type CaptureSample = {
  sessionId: string;
  metricB: number;
  hideCalledToHidden: number;
  hiddenToCaptureStart: number;
  selfMarkerPixels: number;
  selfWindowCaptured: boolean;
  report: ScreenshotPerformanceReport;
  quality?: CaptureFrameQuality;
};

type ConfigurationResult = {
  name: string;
  samples: CaptureSample[];
  successRate: number;
  selfWindowCaptured: boolean;
  averageMetricB: number;
  averageHideCalledToHidden: number;
  averageHiddenToCaptureStart: number;
};

type LaunchOptions = {
  delay?: number;
  strategy: string;
  transport?: string;
  benchmark?: boolean;
};

const average = (values: number[]) => values.reduce((total, value) => total + value, 0) / values.length;

function duration(report: ScreenshotPerformanceReport, start: string, end: string) {
  const startMark = report.marks.find((mark) => mark.event === start);
  const endMark = report.marks.find((mark) => mark.event === end);
  if (!startMark || !endMark) throw new Error(`missing performance marks: ${start} → ${end}`);
  return endMark.atMs - startMark.atMs;
}

async function setMarker(page: Page, color: readonly [number, number, number], label: string) {
  await page.evaluate(async ({ color, label }) => {
    document.getElementById('phase3-self-capture-marker')?.remove();
    const marker = document.createElement('div');
    marker.id = 'phase3-self-capture-marker';
    marker.dataset.label = label;
    Object.assign(marker.style, {
      position: 'fixed', inset: '0', zIndex: '2147483647', pointerEvents: 'none',
      background: `rgb(${color[0]}, ${color[1]}, ${color[2]})`
    });
    document.body.append(marker);
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  }, { color, label });
}

async function countMarkers(overlay: Page, colors: ReadonlyArray<readonly [number, number, number]>) {
  return overlay.locator('.screen-frame').evaluate((image, expectedColors) => {
    const element = image as HTMLImageElement;
    const canvas = document.createElement('canvas');
    canvas.width = element.naturalWidth;
    canvas.height = element.naturalHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('2D canvas unavailable');
    context.drawImage(element, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const counts = expectedColors.map(() => 0);
    const step = 8;
    for (let y = 0; y < canvas.height; y += step) {
      for (let x = 0; x < canvas.width; x += step) {
        const offset = (y * canvas.width + x) * 4;
        expectedColors.forEach((color, index) => {
          if (Math.abs(pixels[offset] - color[0]) <= 10 && Math.abs(pixels[offset + 1] - color[1]) <= 10 && Math.abs(pixels[offset + 2] - color[2]) <= 10) counts[index]++;
        });
      }
    }
    return counts;
  }, colors);
}

async function launch(options: LaunchOptions) {
  const directory = await mkdtemp(join(tmpdir(), 'snipvia-phase3-'));
  const app = await launchMemberDesktop({
    args: ['.', `--user-data-dir=${directory}`],
    env: {
      ...process.env,
      SNIPVIA_PERF: '0',
      SNIPVIA_CAPTURE_BACKEND: 'electron',
      SNIPVIA_CAPTURE_READINESS_VARIANT: options.strategy,
      ...(options.delay === undefined ? {} : { SNIPVIA_CAPTURE_DELAY: String(options.delay) }),
      ...(options.transport ? { SNIPVIA_CAPTURE_TRANSPORT: options.transport } : {}),
      ...(options.benchmark ? { SNIPVIA_CAPTURE_BENCHMARK: '1' } : {})
    }
  });
  const main = await app.firstWindow();
  await expect(main.getByRole('button', { name: 'AI 笔记', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect.poll(() => app.windows().some((window) => window.url().endsWith('#capture'))).toBe(true);
  await expect.poll(() => app.windows().some((window) => window.url().endsWith('#pin'))).toBe(true);
  const permission = await main.evaluate(() => window.snipvia.permissions.screen());
  if (!permission.ok || permission.value.status !== 'granted') throw new Error(permission.ok ? `screen permission: ${permission.value.status}` : permission.error);
  return {
    app,
    main,
    overlay: app.windows().find((window) => window.url().endsWith('#capture'))!,
    pin: app.windows().find((window) => window.url().endsWith('#pin'))!,
    directory
  };
}

async function closeLaunched(app: ElectronApplication, directory: string) {
  await app.close();
  await rm(directory, { recursive: true, force: true });
}

async function captureOnce(app: ElectronApplication, main: Page, overlay: Page, colors = [mainMarker], includeQuality = false): Promise<CaptureSample> {
  await app.evaluate(({ app }) => app.emit('activate'));
  await expect(main.locator('#phase3-self-capture-marker')).toBeVisible();
  const started = await main.evaluate(() => window.snipvia.capture.start());
  if (!started.ok) throw new Error(started.error);
  await expect(overlay.locator('.screen-frame')).toBeVisible();
  const sessionId = await overlay.locator('.capture-overlay').getAttribute('data-performance-session');
  if (!sessionId) throw new Error('capture session missing');
  const counts = await countMarkers(overlay, colors);
  const result = await overlay.evaluate((id) => window.snipvia.performance.report(id), sessionId);
  if (!result.ok || !result.value) throw new Error(result.ok ? 'performance report missing' : result.error);
  const qualityResult = includeQuality ? await overlay.evaluate((id) => window.snipvia.performance.frameQuality(id), sessionId) : null;
  if (qualityResult && !qualityResult.ok) throw new Error(qualityResult.error);
  await overlay.keyboard.press('Escape');
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().endsWith('#capture'))?.isVisible() ?? false)).toBe(false);
  const markerPixels = counts.reduce((total, count) => total + count, 0);
  return {
    sessionId,
    metricB: result.value.metrics.captureStartToOverlayVisibleMs ?? Number.NaN,
    hideCalledToHidden: duration(result.value, 'main_window_hide_called', 'main_window_hidden'),
    hiddenToCaptureStart: duration(result.value, 'main_window_hidden', 'frame_capture_start'),
    selfMarkerPixels: markerPixels,
    selfWindowCaptured: markerPixels > 50,
    report: result.value,
    ...(qualityResult?.ok ? { quality: qualityResult.value } : {})
  };
}

function summarize(name: string, samples: CaptureSample[]): ConfigurationResult {
  const successful = samples.filter((sample) => !sample.selfWindowCaptured).length;
  return {
    name,
    samples,
    successRate: successful / samples.length,
    selfWindowCaptured: successful !== samples.length,
    averageMetricB: average(samples.map((sample) => sample.metricB)),
    averageHideCalledToHidden: average(samples.map((sample) => sample.hideCalledToHidden)),
    averageHiddenToCaptureStart: average(samples.map((sample) => sample.hiddenToCaptureStart))
  };
}

async function runConfiguration(name: string, options: LaunchOptions, trials: number, includeQuality = false) {
  const launched = await launch(options);
  try {
    await setMarker(launched.main, mainMarker, 'main');
    const samples: CaptureSample[] = [];
    for (let trial = 0; trial < trials; trial++) {
      samples.push(await captureOnce(launched.app, launched.main, launched.overlay, [mainMarker], includeQuality));
    }
    return summarize(name, samples);
  } finally {
    await closeLaunched(launched.app, launched.directory);
  }
}

test('runs the real macOS Phase 3 capture experiment', async () => {
  test.skip(!realScreen, 'Set SNIPVIA_REAL_SCREEN=1 to run the real desktop experiment.');
  test.setTimeout(15 * 60_000);
  const trials = 10;
  const mode = process.env.SNIPVIA_PHASE3_EXPERIMENT ?? 'delay';
  await mkdir(resultDirectory, { recursive: true });
  if (mode === 'delay') {
    const delayMatrix: ConfigurationResult[] = [];
    for (const delay of [0, 16, 32, 50, 75, 100, 150, 200]) {
      console.info(`[Phase 3] fixed delay ${delay}ms`);
      delayMatrix.push(await runConfiguration(`${delay}ms`, { strategy: 'fixed', delay }, trials));
    }
    expect(delayMatrix.every((result) => result.samples.length === trials)).toBe(true);
    await writeFile(`${resultDirectory}/screenshot-capture-phase3-delay.json`, JSON.stringify({ collectedAt: new Date().toISOString(), trials, delayMatrix }, null, 2));
    return;
  }
  if (mode === 'readiness') {
    const readinessVariants: ConfigurationResult[] = [];
    for (const strategy of ['fixed', 'hide-event', 'hide-event-immediate', 'hide-event-tick', 'hide-event-16', 'hide-event-32']) {
      console.info(`[Phase 3] readiness ${strategy}`);
      readinessVariants.push(await runConfiguration(strategy === 'fixed' ? 'fixed-200' : strategy, { strategy, ...(strategy === 'fixed' ? { delay: 200 } : {}) }, trials));
    }
    expect(readinessVariants.every((result) => result.samples.length === trials)).toBe(true);
    await writeFile(`${resultDirectory}/screenshot-capture-phase3-readiness.json`, JSON.stringify({ collectedAt: new Date().toISOString(), trials, readinessVariants }, null, 2));
    return;
  }
  if (mode === 'transport') {
    const transportResults: ConfigurationResult[] = [];
    for (const transport of ['data-url', 'png-base64', 'png-binary', 'jpeg-90', 'jpeg-95']) {
      console.info(`[Phase 3] transport ${transport}`);
      transportResults.push(await runConfiguration(transport, { strategy: 'hide-event-16', transport, benchmark: true }, trials, true));
    }
    expect(transportResults.every((result) => result.samples.length === trials)).toBe(true);
    await writeFile(`${resultDirectory}/screenshot-capture-phase3-transport.json`, JSON.stringify({ collectedAt: new Date().toISOString(), trials, transportResults }, null, 2));
    return;
  }
  if (mode === 'validate') {
    console.info('[Phase 3] validating selected hide-event-16 + jpeg-95 strategy (100 captures)');
    const selectedStrategy = await runConfiguration('hide-event-16+jpeg-95', {
      strategy: 'hide-event-16', transport: 'jpeg-95'
    }, 100);
    expect(selectedStrategy.samples).toHaveLength(100);
    expect(selectedStrategy.selfWindowCaptured).toBe(false);
    await writeFile(`${resultDirectory}/screenshot-capture-phase3-validation.json`, JSON.stringify({
      collectedAt: new Date().toISOString(), trials: 100, selectedStrategy
    }, null, 2));
    return;
  }
  if (mode !== 'states') throw new Error(`Unknown Phase 3 experiment mode: ${mode}`);

  const stateValidation = await launch({ strategy: 'hide-event-16', transport: 'jpeg-95' });
  let windowStateResult: { markerCounts: number[]; selfWindowCaptured: boolean; metricB: number } | null = null;
  let overlayReplacementResult: { markerCounts: number[]; selfWindowCaptured: boolean; metricB: number } | null = null;
  let hiddenMainResult: { markerCounts: number[]; selfWindowCaptured: boolean; metricB: number } | null = null;
  try {
    await setMarker(stateValidation.main, mainMarker, 'main');
    const initial = await stateValidation.main.evaluate(() => window.snipvia.capture.start());
    if (!initial.ok) throw new Error(initial.error);
    await expect(stateValidation.overlay.locator('.screen-frame')).toBeVisible();
    await stateValidation.overlay.mouse.move(40, 40);
    await stateValidation.overlay.mouse.down();
    await stateValidation.overlay.mouse.move(540, 340);
    await stateValidation.overlay.mouse.up();
    await expect(stateValidation.pin.getByAltText('置顶截图')).toBeVisible();
    await setMarker(stateValidation.pin, pinMarker, 'pin');
    await expect.poll(() => stateValidation.app.windows().some(window => window.url().endsWith('#quick-chat'))).toBe(true);
    const quickChat = stateValidation.app.windows().find(window => window.url().endsWith('#quick-chat'))!;
    await expect(quickChat.locator('.quick-chat')).toBeVisible();
    await setMarker(quickChat, chatMarker, 'quick-chat');
    await stateValidation.app.evaluate(({ app }) => app.emit('activate'));
    await expect(stateValidation.main.locator('#phase3-self-capture-marker')).toBeVisible();
    const allWindows = await stateValidation.main.evaluate(() => window.snipvia.capture.start());
    if (!allWindows.ok) throw new Error(allWindows.error);
    await expect(stateValidation.overlay.locator('.screen-frame')).toBeVisible();
    const allWindowCounts = await countMarkers(stateValidation.overlay, [mainMarker, pinMarker, chatMarker]);
    const allWindowSession = await stateValidation.overlay.locator('.capture-overlay').getAttribute('data-performance-session');
    if (!allWindowSession) throw new Error('all-window session missing');
    const allWindowReport = await stateValidation.overlay.evaluate((id) => window.snipvia.performance.report(id), allWindowSession);
    if (!allWindowReport.ok || !allWindowReport.value) throw new Error(allWindowReport.ok ? 'all-window report missing' : allWindowReport.error);
    windowStateResult = {
      markerCounts: allWindowCounts,
      selfWindowCaptured: allWindowCounts.some((count) => count > 50),
      metricB: allWindowReport.value.metrics.captureStartToOverlayVisibleMs ?? Number.NaN
    };

    await setMarker(stateValidation.overlay, overlayMarker, 'overlay');
    const replacement = await stateValidation.main.evaluate(() => window.snipvia.capture.start());
    if (!replacement.ok) throw new Error(replacement.error);
    await expect(stateValidation.overlay.locator('.screen-frame')).toBeVisible();
    const replacementCounts = await countMarkers(stateValidation.overlay, [overlayMarker]);
    const replacementSession = await stateValidation.overlay.locator('.capture-overlay').getAttribute('data-performance-session');
    if (!replacementSession) throw new Error('replacement session missing');
    const replacementReport = await stateValidation.overlay.evaluate((id) => window.snipvia.performance.report(id), replacementSession);
    if (!replacementReport.ok || !replacementReport.value) throw new Error(replacementReport.ok ? 'replacement report missing' : replacementReport.error);
    overlayReplacementResult = {
      markerCounts: replacementCounts,
      selfWindowCaptured: replacementCounts.some((count) => count > 50),
      metricB: replacementReport.value.metrics.captureStartToOverlayVisibleMs ?? Number.NaN
    };
    await stateValidation.overlay.keyboard.press('Escape');

    await expect.poll(() => stateValidation.app.evaluate(({ BrowserWindow }) => (
      BrowserWindow.getAllWindows().find((window) => !window.webContents.getURL().includes('#'))?.isVisible() ?? false
    ))).toBe(false);
    const hiddenMain = await stateValidation.main.evaluate(() => window.snipvia.capture.start());
    if (!hiddenMain.ok) throw new Error(hiddenMain.error);
    await expect(stateValidation.overlay.locator('.screen-frame')).toBeVisible();
    const hiddenMainCounts = await countMarkers(stateValidation.overlay, [mainMarker]);
    const hiddenMainSession = await stateValidation.overlay.locator('.capture-overlay').getAttribute('data-performance-session');
    if (!hiddenMainSession) throw new Error('hidden-main session missing');
    const hiddenMainReport = await stateValidation.overlay.evaluate((id) => window.snipvia.performance.report(id), hiddenMainSession);
    if (!hiddenMainReport.ok || !hiddenMainReport.value) throw new Error(hiddenMainReport.ok ? 'hidden-main report missing' : hiddenMainReport.error);
    hiddenMainResult = {
      markerCounts: hiddenMainCounts,
      selfWindowCaptured: hiddenMainCounts.some((count) => count > 50),
      metricB: hiddenMainReport.value.metrics.captureStartToOverlayVisibleMs ?? Number.NaN
    };
    await stateValidation.overlay.keyboard.press('Escape');
  } finally {
    await closeLaunched(stateValidation.app, stateValidation.directory);
  }

  expect(windowStateResult).not.toBeNull();
  expect(overlayReplacementResult).not.toBeNull();
  expect(hiddenMainResult).not.toBeNull();

  await writeFile(`${resultDirectory}/screenshot-capture-phase3-states.json`, JSON.stringify({
    collectedAt: new Date().toISOString(),
    automatedValidation: 'real macOS desktopCapturer; in-memory RGB marker detection; no screenshots persisted',
    windowStateResult,
    overlayReplacementResult,
    hiddenMainResult
  }, null, 2));
});
