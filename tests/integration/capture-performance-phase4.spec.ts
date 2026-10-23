import { launchDesktop } from '../helpers/desktop';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { ScreenshotPerformanceReport } from '../../src/shared/performance';

const realScreen = process.env.SNIPVIA_REAL_SCREEN === '1';
const resultDirectory = 'performance-results';
const markerColor = [253, 1, 197] as const;
const execFileAsync = promisify(execFile);

type LaunchedApp = {
  app: ElectronApplication;
  main: Page;
  overlay: Page;
  directory: string;
};

type CaptureTrial = {
  metricB: number;
  desktopCapturer: number;
  frameAge: number;
  imageReadyToShow: number;
  showCall: number;
  showToPaintConfirmed: number;
  selfMarkerPixels: number;
  overlaySnapshotEmpty: boolean;
  overlaySnapshotBuckets: number;
  report: ScreenshotPerformanceReport;
};

const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const wait = (durationMs: number) => new Promise<void>((resolve) => setTimeout(resolve, durationMs));

function measure(report: ScreenshotPerformanceReport, id: string) {
  const result = report.measures.find((item) => item.id === id);
  if (!result) throw new Error(`missing performance measure: ${id}`);
  return result.durationMs;
}

async function launch(extraEnvironment: Record<string, string> = {}): Promise<LaunchedApp> {
  const directory = await mkdtemp(join(tmpdir(), 'snipvia-phase4-'));
  const app = await launchDesktop({
    args: ['.', `--user-data-dir=${directory}`],
    env: { ...process.env, SNIPVIA_PERF: '0', SNIPVIA_CAPTURE_WARMUP: '0', SNIPVIA_CAPTURE_BACKEND: 'electron', ...extraEnvironment }
  });
  const main = await app.firstWindow();
  await expect(main.getByRole('heading', { name: '设置', exact: true })).toBeVisible();
  await expect.poll(() => app.windows().some((window) => window.url().endsWith('#capture'))).toBe(true);
  const overlay = app.windows().find((window) => window.url().endsWith('#capture'))!;
  const permission = await main.evaluate(() => window.snipvia.permissions.screen());
  if (!permission.ok || permission.value.status !== 'granted') {
    throw new Error(permission.ok ? `screen permission: ${permission.value.status}` : permission.error);
  }
  return { app, main, overlay, directory };
}

async function closeLaunched(launched: LaunchedApp) {
  await launched.app.close();
  await rm(launched.directory, { recursive: true, force: true });
}

async function setMarker(page: Page) {
  await page.evaluate(async (color) => {
    document.getElementById('phase4-self-capture-marker')?.remove();
    const marker = document.createElement('div');
    marker.id = 'phase4-self-capture-marker';
    Object.assign(marker.style, {
      position: 'fixed', inset: '0', zIndex: '2147483647', pointerEvents: 'none',
      background: `rgb(${color[0]}, ${color[1]}, ${color[2]})`
    });
    document.body.append(marker);
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  }, markerColor);
}

async function countMarker(page: Page, selector: string) {
  return page.locator(selector).evaluate((image, color) => {
    const element = image as HTMLImageElement;
    const canvas = document.createElement('canvas');
    canvas.width = element.naturalWidth;
    canvas.height = element.naturalHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('2D canvas unavailable');
    context.drawImage(element, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let y = 0; y < canvas.height; y += 8) {
      for (let x = 0; x < canvas.width; x += 8) {
        const offset = (y * canvas.width + x) * 4;
        if (Math.abs(pixels[offset] - color[0]) <= 10 && Math.abs(pixels[offset + 1] - color[1]) <= 10 && Math.abs(pixels[offset + 2] - color[2]) <= 10) count++;
      }
    }
    return count;
  }, markerColor);
}

async function captureOnce(launched: LaunchedApp): Promise<CaptureTrial> {
  await launched.app.evaluate(({ app }) => app.emit('activate'));
  await expect(launched.main.locator('#phase4-self-capture-marker')).toBeVisible();
  const started = await launched.main.evaluate(() => window.snipvia.capture.start());
  if (!started.ok) throw new Error(started.error);
  await expect(launched.overlay.locator('.screen-frame')).toBeVisible();
  const sessionId = await launched.overlay.locator('.capture-overlay').getAttribute('data-performance-session');
  if (!sessionId) throw new Error('capture session missing');
  await expect.poll(async () => {
    const result = await launched.overlay.evaluate((id) => window.snipvia.performance.report(id), sessionId);
    return result.ok ? result.value?.marks.some((mark) => mark.event === 'capture_overlay_visible') : false;
  }).toBe(true);
  const markerPixels = await countMarker(launched.overlay, '.screen-frame');
  const result = await launched.overlay.evaluate((id) => window.snipvia.performance.report(id), sessionId);
  if (!result.ok || !result.value) throw new Error(result.ok ? 'performance report missing' : result.error);
  const snapshot = await launched.app.evaluate(async ({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().endsWith('#capture'));
    if (!window) throw new Error('capture overlay missing');
    const image = await window.webContents.capturePage();
    if (image.isEmpty()) return { empty: true, buckets: 0 };
    const bitmap = image.toBitmap();
    const size = image.getSize();
    const buckets = new Set<number>();
    const pixelCount = size.width * size.height;
    const step = Math.max(1, Math.floor(pixelCount / 4096));
    for (let pixel = 0; pixel < pixelCount; pixel += step) {
      const offset = pixel * 4;
      buckets.add((bitmap[offset] >> 4) | ((bitmap[offset + 1] >> 4) << 4) | ((bitmap[offset + 2] >> 4) << 8));
    }
    return { empty: false, buckets: buckets.size };
  });
  await launched.overlay.keyboard.press('Escape');
  await expect.poll(() => launched.app.evaluate(({ BrowserWindow }) => (
    BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().endsWith('#capture'))?.isVisible() ?? false
  ))).toBe(false);
  return {
    metricB: result.value.metrics.captureStartToOverlayVisibleMs ?? Number.NaN,
    desktopCapturer: measure(result.value, 'desktop-capturer'),
    frameAge: Number(result.value.metadata.frameAgeMs),
    imageReadyToShow: measure(result.value, 'image-ready-overlay-show-called'),
    showCall: measure(result.value, 'overlay-show-call'),
    showToPaintConfirmed: measure(result.value, 'overlay-show-paint-confirmed'),
    selfMarkerPixels: markerPixels,
    overlaySnapshotEmpty: snapshot.empty,
    overlaySnapshotBuckets: snapshot.buckets,
    report: result.value
  };
}

test('runs the real macOS Phase 4 capture-engine experiment', async () => {
  test.skip(!realScreen, 'Set SNIPVIA_REAL_SCREEN=1 to run the real desktop experiment.');
  test.setTimeout(20 * 60_000);
  await mkdir(resultDirectory, { recursive: true });
  const mode = process.env.SNIPVIA_PHASE4_EXPERIMENT ?? 'thumbnail';

  if (mode === 'thumbnail') {
    const launched = await launch();
    try {
      await launched.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((window) => window.hide()));
      await wait(32);
      const result = await launched.app.evaluate(async ({ app, desktopCapturer, nativeImage, screen }) => {
        const display = screen.getPrimaryDisplay();
        const physical = {
          width: Math.round(display.size.width * display.scaleFactor),
          height: Math.round(display.size.height * display.scaleFactor)
        };
        const fixedHeight = (width: number) => Math.round(physical.height * width / physical.width);
        const configurations = [
          { name: 'physical-100', width: physical.width, height: physical.height },
          { name: 'physical-75', width: Math.round(physical.width * 0.75), height: Math.round(physical.height * 0.75) },
          { name: 'physical-50', width: Math.round(physical.width * 0.5), height: Math.round(physical.height * 0.5) },
          { name: 'dip', width: display.size.width, height: display.size.height },
          { name: 'fixed-2560', width: 2560, height: fixedHeight(2560) },
          { name: 'fixed-1920', width: 1920, height: fixedHeight(1920) },
          { name: 'zero', width: 0, height: 0 }
        ];
        const findDisplay = (sources: Awaited<ReturnType<typeof desktopCapturer.getSources>>) => sources.find((source) => source.display_id === String(display.id));
        await desktopCapturer.getSources({ types: ['screen'], fetchWindowIcons: false, thumbnailSize: physical });
        const samples = new Map(configurations.map((configuration) => [configuration.name, [] as Array<Record<string, number | boolean>>]));
        for (let round = 0; round < 10; round++) {
          const rotated = configurations.slice(round % configurations.length).concat(configurations.slice(0, round % configurations.length));
          for (const configuration of rotated) {
            const start = performance.now();
            const sources = await desktopCapturer.getSources({
              types: ['screen'], fetchWindowIcons: false,
              thumbnailSize: { width: configuration.width, height: configuration.height }
            });
            const captureMs = performance.now() - start;
            const source = findDisplay(sources);
            if (!source) throw new Error('primary display source missing');
            const size = source.thumbnail.getSize();
            let encodeMs = 0;
            let encodedBytes = 0;
            if (!source.thumbnail.isEmpty()) {
              const encodeStart = performance.now();
              encodedBytes = source.thumbnail.toJPEG(95).byteLength;
              encodeMs = performance.now() - encodeStart;
            }
            samples.get(configuration.name)!.push({
              captureMs, encodeMs, encodedBytes, sourceCount: sources.length,
              actualWidth: size.width, actualHeight: size.height, empty: source.thumbnail.isEmpty()
            });
          }
        }
        const compare = (reference: Electron.NativeImage, encoded: Buffer) => {
          const decoded = nativeImage.createFromBuffer(encoded);
          const scaled = decoded.resize({ width: physical.width, height: physical.height, quality: 'best' });
          const referenceBitmap = reference.toBitmap();
          const candidateBitmap = scaled.toBitmap();
          const pixelCount = physical.width * physical.height;
          const stride = Math.max(1, Math.floor(pixelCount / 120_000));
          let absoluteError = 0;
          let squaredError = 0;
          let maximumChannelError = 0;
          let sampledPixels = 0;
          for (let pixel = 0; pixel < pixelCount; pixel += stride) {
            const offset = pixel * 4;
            for (let channel = 0; channel < 3; channel++) {
              const error = Math.abs(referenceBitmap[offset + channel] - candidateBitmap[offset + channel]);
              absoluteError += error;
              squaredError += error * error;
              maximumChannelError = Math.max(maximumChannelError, error);
            }
            sampledPixels++;
          }
          const channelSamples = sampledPixels * 3;
          const mse = squaredError / channelSamples;
          return {
            meanAbsoluteError: absoluteError / channelSamples,
            peakSignalToNoiseRatio: mse === 0 ? null : 10 * Math.log10((255 * 255) / mse),
            maximumChannelError,
            sampledPixels
          };
        };
        const quality: Record<string, ReturnType<typeof compare> | null> = {};
        for (const configuration of configurations) {
          if (configuration.width === 0) { quality[configuration.name] = null; continue; }
          const referenceSources = await desktopCapturer.getSources({ types: ['screen'], fetchWindowIcons: false, thumbnailSize: physical });
          const candidateSources = await desktopCapturer.getSources({
            types: ['screen'], fetchWindowIcons: false,
            thumbnailSize: { width: configuration.width, height: configuration.height }
          });
          const reference = findDisplay(referenceSources)?.thumbnail;
          const candidate = findDisplay(candidateSources)?.thumbnail;
          if (!reference || !candidate || reference.isEmpty() || candidate.isEmpty()) throw new Error('quality frame missing');
          quality[configuration.name] = compare(reference, candidate.toJPEG(95));
        }
        const optionConfigurations = [
          { name: 'screen-icons-false', types: ['screen'] as const, fetchWindowIcons: false },
          { name: 'screen-icons-default', types: ['screen'] as const, fetchWindowIcons: undefined },
          { name: 'screen-window-icons-false', types: ['screen', 'window'] as const, fetchWindowIcons: false },
          { name: 'screen-window-icons-true', types: ['screen', 'window'] as const, fetchWindowIcons: true },
          { name: 'window-icons-false', types: ['window'] as const, fetchWindowIcons: false }
        ];
        const optionSamples = new Map(optionConfigurations.map((configuration) => [configuration.name, [] as Array<{ durationMs: number; sourceCount: number }>]));
        for (let round = 0; round < 10; round++) {
          for (const configuration of optionConfigurations) {
            const options = {
              types: [...configuration.types] as Array<'screen' | 'window'>,
              thumbnailSize: { width: 0, height: 0 },
              ...(configuration.fetchWindowIcons === undefined ? {} : { fetchWindowIcons: configuration.fetchWindowIcons })
            };
            const start = performance.now();
            const sources = await desktopCapturer.getSources(options);
            optionSamples.get(configuration.name)!.push({ durationMs: performance.now() - start, sourceCount: sources.length });
          }
        }
        const metrics = app.getAppMetrics();
        return {
          display: { dip: display.size, physical, scaleFactor: display.scaleFactor, id: String(display.id) },
          configurations: configurations.map((configuration) => ({
            ...configuration, samples: samples.get(configuration.name), quality: quality[configuration.name]
          })),
          sourceOptions: optionConfigurations.map((configuration) => ({
            ...configuration, samples: optionSamples.get(configuration.name)
          })),
          environment: { sourceCount: (samples.get('physical-100')?.[0]?.sourceCount ?? 0), processCount: metrics.length }
        };
      });
      await writeFile(`${resultDirectory}/screenshot-capture-phase4-thumbnail.json`, JSON.stringify({ collectedAt: new Date().toISOString(), ...result }, null, 2));
    } finally {
      await closeLaunched(launched);
    }
    return;
  }

  if (mode === 'warmup') {
    const variants = ['none', 'zero', 'physical'] as const;
    const results: Array<{ variant: typeof variants[number]; trials: Array<Record<string, unknown>> }> = [];
    for (const variant of variants) {
      const trials: Array<Record<string, unknown>> = [];
      for (let trial = 0; trial < 5; trial++) {
        const launched = await launch();
        try {
          await setMarker(launched.main);
          const warmup = variant === 'none' ? null : await launched.app.evaluate(async ({ app, desktopCapturer, screen }, selected) => {
            const display = screen.getPrimaryDisplay();
            const thumbnailSize = selected === 'zero'
              ? { width: 0, height: 0 }
              : { width: Math.round(display.size.width * display.scaleFactor), height: Math.round(display.size.height * display.scaleFactor) };
            const memory = () => app.getAppMetrics().reduce((sum, metric) => sum + metric.memory.workingSetSize, 0);
            const beforeKb = memory();
            app.getAppMetrics();
            const start = performance.now();
            const sources = await desktopCapturer.getSources({ types: ['screen'], fetchWindowIcons: false, thumbnailSize });
            const durationMs = performance.now() - start;
            const cpu = app.getAppMetrics();
            return {
              durationMs, sourceCount: sources.length, memoryDeltaKb: memory() - beforeKb,
              totalCpuPercent: cpu.reduce((sum, metric) => sum + metric.cpu.percentCPUUsage, 0),
              idleWakeupsPerSecond: cpu.reduce((sum, metric) => sum + metric.cpu.idleWakeupsPerSecond, 0)
            };
          }, variant);
          const first = await captureOnce(launched);
          const second = await captureOnce(launched);
          trials.push({ variant, warmup, first, second });
        } finally {
          await closeLaunched(launched);
        }
      }
      results.push({ variant, trials });
    }
    await writeFile(`${resultDirectory}/screenshot-capture-phase4-warmup.json`, JSON.stringify({ collectedAt: new Date().toISOString(), results }, null, 2));
    return;
  }

  if (mode === 'resources') {
    const strategies = ['on-demand-idle', 'warm-dormant', 'poll-1fps'] as const;
    const results: Array<Record<string, unknown>> = [];
    for (const strategy of strategies) {
      const launched = await launch();
      try {
        const result = await launched.app.evaluate(async ({ app, desktopCapturer, screen }, selected) => {
          const display = screen.getPrimaryDisplay();
          const physical = {
            width: Math.round(display.size.width * display.scaleFactor),
            height: Math.round(display.size.height * display.scaleFactor)
          };
          const memory = () => app.getAppMetrics().reduce((sum, metric) => sum + metric.memory.workingSetSize, 0);
          if (selected === 'warm-dormant') {
            await desktopCapturer.getSources({ types: ['screen'], fetchWindowIcons: false, thumbnailSize: physical });
          }
          const memoryBeforeKb = memory();
          app.getAppMetrics();
          const captureDurations: number[] = [];
          const startedAt = performance.now();
          if (selected === 'poll-1fps') {
            for (let sample = 0; sample < 5; sample++) {
              const captureStart = performance.now();
              await desktopCapturer.getSources({ types: ['screen'], fetchWindowIcons: false, thumbnailSize: physical });
              captureDurations.push(performance.now() - captureStart);
              const nextAt = startedAt + (sample + 1) * 1000;
              await new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, nextAt - performance.now())));
            }
          } else {
            await new Promise<void>((resolve) => setTimeout(resolve, 5000));
          }
          const metrics = app.getAppMetrics();
          const memoryAfterKb = metrics.reduce((sum, metric) => sum + metric.memory.workingSetSize, 0);
          return {
            durationMs: performance.now() - startedAt,
            captureDurations,
            memoryBeforeKb,
            memoryAfterKb,
            memoryDeltaKb: memoryAfterKb - memoryBeforeKb,
            totalCpuPercent: metrics.reduce((sum, metric) => sum + metric.cpu.percentCPUUsage, 0),
            gpuCpuPercent: metrics.filter((metric) => metric.type === 'GPU').reduce((sum, metric) => sum + metric.cpu.percentCPUUsage, 0),
            idleWakeupsPerSecond: metrics.reduce((sum, metric) => sum + metric.cpu.idleWakeupsPerSecond, 0),
            energyImpact: null
          };
        }, strategy);
        results.push({ strategy, ...result });
      } finally {
        await closeLaunched(launched);
      }
    }
    await writeFile(`${resultDirectory}/screenshot-capture-phase4-resources.json`, JSON.stringify({ collectedAt: new Date().toISOString(), results }, null, 2));
    return;
  }

  if (mode === 'stream') {
    const launched = await launch();
    const results: Array<Record<string, unknown>> = [];
    try {
      await setMarker(launched.main);
      const source = await launched.app.evaluate(async ({ desktopCapturer, screen }) => {
        const display = screen.getPrimaryDisplay();
        const sources = await desktopCapturer.getSources({ types: ['screen'], fetchWindowIcons: false, thumbnailSize: { width: 0, height: 0 } });
        const selected = sources.find((item) => item.display_id === String(display.id));
        if (!selected) throw new Error('primary display source missing');
        return {
          id: selected.id,
          width: Math.round(display.size.width * display.scaleFactor),
          height: Math.round(display.size.height * display.scaleFactor)
        };
      });
      for (const frameRate of [1, 30]) {
        await launched.app.evaluate(({ app }) => app.emit('activate'));
        await expect(launched.main.locator('#phase4-self-capture-marker')).toBeVisible();
        const started = await launched.overlay.evaluate(async ({ source, frameRate }) => {
          try {
            const startedAt = performance.now();
            const constraints = {
              audio: false,
              video: { mandatory: {
                chromeMediaSource: 'desktop', chromeMediaSourceId: source.id,
                minWidth: source.width, maxWidth: source.width,
                minHeight: source.height, maxHeight: source.height,
                minFrameRate: frameRate, maxFrameRate: frameRate
              } }
            } as unknown as MediaStreamConstraints;
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            const video = document.createElement('video');
            video.muted = true;
            video.srcObject = stream;
            await video.play();
            await new Promise<void>((resolve, reject) => {
              const timeout = setTimeout(() => reject(new Error('stream first frame timeout')), 5000);
              video.requestVideoFrameCallback(() => { clearTimeout(timeout); resolve(); });
            });
            const track = stream.getVideoTracks()[0];
            const holder = window as typeof window & { __phase4Stream?: { stream: MediaStream; video: HTMLVideoElement } };
            holder.__phase4Stream = { stream, video };
            return { ok: true as const, firstFrameMs: performance.now() - startedAt, settings: track.getSettings() };
          } catch (error) {
            return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
          }
        }, { source, frameRate });
        if (!started.ok) {
          results.push({ frameRate, supported: false, error: started.error });
          continue;
        }
        const markerPixels = await launched.overlay.evaluate((color) => {
          const holder = window as typeof window & { __phase4Stream?: { stream: MediaStream; video: HTMLVideoElement } };
          const video = holder.__phase4Stream?.video;
          if (!video) throw new Error('stream missing');
          const canvas = document.createElement('canvas');
          canvas.width = video.videoWidth; canvas.height = video.videoHeight;
          const context = canvas.getContext('2d', { willReadFrequently: true });
          if (!context) throw new Error('2D canvas unavailable');
          context.drawImage(video, 0, 0);
          const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
          let count = 0;
          for (let y = 0; y < canvas.height; y += 8) for (let x = 0; x < canvas.width; x += 8) {
            const offset = (y * canvas.width + x) * 4;
            if (Math.abs(pixels[offset] - color[0]) <= 10 && Math.abs(pixels[offset + 1] - color[1]) <= 10 && Math.abs(pixels[offset + 2] - color[2]) <= 10) count++;
          }
          return count;
        }, markerColor);
        const resourceBefore = await launched.app.evaluate(({ app }) => {
          const metrics = app.getAppMetrics();
          return metrics.reduce((sum, metric) => sum + metric.memory.workingSetSize, 0);
        });
        await wait(5000);
        const resource = await launched.app.evaluate(({ app }, memoryBeforeKb) => {
          const metrics = app.getAppMetrics();
          const memoryAfterKb = metrics.reduce((sum, metric) => sum + metric.memory.workingSetSize, 0);
          return {
            memoryBeforeKb, memoryAfterKb, memoryDeltaKb: memoryAfterKb - memoryBeforeKb,
            totalCpuPercent: metrics.reduce((sum, metric) => sum + metric.cpu.percentCPUUsage, 0),
            gpuCpuPercent: metrics.filter((metric) => metric.type === 'GPU').reduce((sum, metric) => sum + metric.cpu.percentCPUUsage, 0),
            idleWakeupsPerSecond: metrics.reduce((sum, metric) => sum + metric.cpu.idleWakeupsPerSecond, 0)
          };
        }, resourceBefore);
        await launched.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => !window.webContents.getURL().includes('#'))?.hide());
        const cleanFrame = await launched.overlay.evaluate(async (color) => {
          const holder = window as typeof window & { __phase4Stream?: { stream: MediaStream; video: HTMLVideoElement } };
          const video = holder.__phase4Stream?.video;
          if (!video) throw new Error('stream missing');
          const startedAt = performance.now();
          let frames = 0;
          const sample = () => {
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth; canvas.height = video.videoHeight;
            const context = canvas.getContext('2d', { willReadFrequently: true });
            if (!context) throw new Error('2D canvas unavailable');
            context.drawImage(video, 0, 0);
            const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
            let count = 0;
            for (let y = 0; y < canvas.height; y += 8) for (let x = 0; x < canvas.width; x += 8) {
              const offset = (y * canvas.width + x) * 4;
              if (Math.abs(pixels[offset] - color[0]) <= 10 && Math.abs(pixels[offset + 1] - color[1]) <= 10 && Math.abs(pixels[offset + 2] - color[2]) <= 10) count++;
            }
            return count;
          };
          return new Promise<{ cleanAfterMs: number; frames: number; remainingMarkerPixels: number }>((resolve, reject) => {
            const next = () => video.requestVideoFrameCallback(() => {
              frames++;
              const remainingMarkerPixels = sample();
              if (remainingMarkerPixels <= 50) resolve({ cleanAfterMs: performance.now() - startedAt, frames, remainingMarkerPixels });
              else if (performance.now() - startedAt > 4000) reject(new Error('stream did not produce a clean frame'));
              else next();
            });
            next();
          });
        }, markerColor);
        const dormantBefore = await launched.app.evaluate(({ app }) => {
          app.getAppMetrics();
          return app.getAppMetrics().reduce((sum, metric) => sum + metric.memory.workingSetSize, 0);
        });
        await launched.overlay.evaluate(() => {
          const holder = window as typeof window & { __phase4Stream?: { stream: MediaStream; video: HTMLVideoElement } };
          const track = holder.__phase4Stream?.stream.getVideoTracks()[0];
          if (track) track.enabled = false;
        });
        await wait(5000);
        const dormant = await launched.app.evaluate(({ app }, memoryBeforeKb) => {
          const metrics = app.getAppMetrics();
          const memoryAfterKb = metrics.reduce((sum, metric) => sum + metric.memory.workingSetSize, 0);
          return {
            memoryDeltaKb: memoryAfterKb - memoryBeforeKb,
            totalCpuPercent: metrics.reduce((sum, metric) => sum + metric.cpu.percentCPUUsage, 0),
            gpuCpuPercent: metrics.filter((metric) => metric.type === 'GPU').reduce((sum, metric) => sum + metric.cpu.percentCPUUsage, 0),
            idleWakeupsPerSecond: metrics.reduce((sum, metric) => sum + metric.cpu.idleWakeupsPerSecond, 0)
          };
        }, dormantBefore);
        await launched.overlay.evaluate(() => {
          const holder = window as typeof window & { __phase4Stream?: { stream: MediaStream; video: HTMLVideoElement } };
          holder.__phase4Stream?.stream.getTracks().forEach((track) => track.stop());
          delete holder.__phase4Stream;
        });
        results.push({ frameRate, supported: true, ...started, markerPixels, selfCapture: markerPixels > 50, resource, cleanFrame, dormant });
      }
      await writeFile(`${resultDirectory}/screenshot-capture-phase4-stream.json`, JSON.stringify({ collectedAt: new Date().toISOString(), results }, null, 2));
    } finally {
      await closeLaunched(launched);
    }
    return;
  }

  if (mode === 'sck') {
    const launched = await launch();
    try {
      await setMarker(launched.main);
      const executable = join(process.cwd(), 'scripts/.build/snipvia-sck-benchmark');
      let result: unknown;
      try {
        const completed = await execFileAsync(executable, [String(launched.app.process().pid)], {
          timeout: 60_000, maxBuffer: 10 * 1024 * 1024
        });
        result = JSON.parse(completed.stdout.trim());
      } catch (error) {
        result = { supported: false, error: error instanceof Error ? error.message : String(error) };
      }
      await writeFile(`${resultDirectory}/screenshot-capture-phase4-sck.json`, JSON.stringify({ collectedAt: new Date().toISOString(), result }, null, 2));
    } finally {
      await closeLaunched(launched);
    }
    return;
  }

  if (mode !== 'raf') throw new Error(`Unknown Phase 4 experiment mode: ${mode}`);
  const results: Array<Record<string, unknown>> = [];
  for (const rafCount of [1, 2] as const) {
    const launched = await launch({ SNIPVIA_CAPTURE_RAF_COUNT: String(rafCount) });
    try {
      await setMarker(launched.main);
      const trials: CaptureTrial[] = [];
      for (let trial = 0; trial < 100; trial++) trials.push(await captureOnce(launched));
      expect(trials.every((item) => item.selfMarkerPixels <= 50)).toBe(true);
      expect(trials.every((item) => !item.overlaySnapshotEmpty && item.overlaySnapshotBuckets > 1)).toBe(true);
      results.push({
        rafCount,
        successRate: trials.filter((item) => item.selfMarkerPixels <= 50 && !item.overlaySnapshotEmpty && item.overlaySnapshotBuckets > 1).length / trials.length,
        averages: {
          metricB: average(trials.map((item) => item.metricB)),
          imageReadyToShow: average(trials.map((item) => item.imageReadyToShow)),
          showCall: average(trials.map((item) => item.showCall)),
          showToPaintConfirmed: average(trials.map((item) => item.showToPaintConfirmed)),
          frameAge: average(trials.map((item) => item.frameAge))
        },
        trials
      });
    } finally {
      await closeLaunched(launched);
    }
  }
  await writeFile(`${resultDirectory}/screenshot-capture-phase4-raf.json`, JSON.stringify({ collectedAt: new Date().toISOString(), results }, null, 2));
});
