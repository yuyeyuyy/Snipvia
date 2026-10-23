import { launchDesktop } from '../helpers/desktop';
import { expect, test } from '@playwright/test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ScreenshotPerformanceReport } from '../../src/shared/performance';

type Scenario = {
  name: 'small' | 'medium' | 'large';
  captureIndex: number;
  round: 1 | 2 | 3;
  requestedDip: { width: number; height: number };
  report: ScreenshotPerformanceReport;
};

test('collects startup preload and warm ScreenshotToAll reuse performance', async () => {
  const realScreen = process.env.SNIPVIA_REAL_SCREEN === '1';
  const directory = await mkdtemp(join(tmpdir(), 'snipvia-performance-'));
  const launchStartedAt = performance.now();
  const app = await launchDesktop({
    args: ['.', `--user-data-dir=${directory}`],
    env: { ...process.env, SNIPVIA_PERF: process.env.SNIPVIA_PERF ?? '0', SNIPVIA_CAPTURE_BACKEND: 'electron' }
  });

  const launchToReusableWindowsReadyMs = performance.now() - launchStartedAt;
  const initialWindowIds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(window => window.id));
  try {
    const page = await app.firstWindow();
    await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible();
    await expect.poll(() => app.windows().some((window) => window.url().endsWith('#capture'))).toBe(true);
    await expect.poll(() => app.windows().some((window) => window.url().endsWith('#pin'))).toBe(true);
    const overlay = app.windows().find((window) => window.url().endsWith('#capture'))!;
    const pinned = app.windows().find((window) => window.url().endsWith('#pin'))!;
    const startupResult = await page.evaluate(() => window.snipvia.performance.startupReport());
    if (!startupResult.ok || !startupResult.value) throw new Error(startupResult.ok ? 'startup performance report missing' : startupResult.error);
    const environment = await app.evaluate(({ app, screen }) => {
      const display = screen.getPrimaryDisplay();
      return {
        platform: process.platform,
        architecture: process.arch,
        osVersion: process.getSystemVersion(),
        electron: process.versions.electron,
        appVersion: app.getVersion(),
        displayResolutionDip: display.size,
        displayBounds: display.bounds,
        scaleFactor: display.scaleFactor
      };
    });

    if (!realScreen) {
      // Keep screen content deterministic while exercising the real Electron window,
      // preload, IPC, renderer, NativeImage, filesystem, and image decode path.
      await app.evaluate(({ desktopCapturer, nativeImage, screen, systemPreferences, clipboard }) => {
        clipboard.write = async () => {};
      systemPreferences.getMediaAccessStatus = () => 'granted';
        const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
        const width = Math.round(display.size.width * display.scaleFactor);
        const height = Math.round(display.size.height * display.scaleFactor);
        const bitmap = Buffer.alloc(width * height * 4);
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const offset = (y * width + x) * 4;
            bitmap[offset] = (x * 13 + y * 3) & 255;
            bitmap[offset + 1] = (x * 5 + y * 11) & 255;
            bitmap[offset + 2] = ((x >> 4) * 29 + (y >> 4) * 17) & 255;
            bitmap[offset + 3] = 255;
          }
        }
        const frame = nativeImage.createFromBitmap(bitmap, { width, height, scaleFactor: 1 });
        desktopCapturer.getSources = async () => [{
          id: 'screen:performance', name: 'Performance frame', display_id: String(display.id),
          appIcon: nativeImage.createEmpty(), thumbnail: frame
        }];
      });
    }

    const scenarios: Scenario[] = [];
    const capture = async (name: Scenario['name'], round: Scenario['round'], sizeFor: (width: number, height: number) => { width: number; height: number }) => {
      await app.evaluate(({ app }) => { app.emit('activate'); });
      await expect(page.locator('.app-shell')).toBeVisible();
      await page.bringToFront();
      const started = await page.evaluate(() => window.snipvia.capture.start());
      if (!started.ok) throw new Error(started.error);
      await expect(overlay.locator('.screen-frame')).toBeVisible();
      const viewport = await overlay.evaluate(() => ({ width: innerWidth, height: innerHeight }));
      const requested = sizeFor(viewport.width, viewport.height);
      const start = { x: 12, y: 12 };
      const end = {
        x: Math.min(viewport.width - 12, start.x + requested.width),
        y: Math.min(viewport.height - 12, start.y + requested.height)
      };
      await overlay.mouse.move(start.x, start.y);
      await overlay.mouse.down();
      await overlay.mouse.move(end.x, end.y);
      await overlay.mouse.up();
      await expect(pinned.getByAltText('置顶截图')).toBeVisible();
      const state = await pinned.evaluate(() => window.snipvia.pin.current());
      if (!state.ok) throw new Error(state.error);
      await expect.poll(async () => pinned.evaluate(async (sessionId) => {
        const result = await window.snipvia.performance.report(sessionId);
        return result.ok ? result.value?.metrics.selectionToScreenshotVisibleMs : undefined;
      }, state.value.performanceSessionId)).toBeGreaterThan(0);
      const result = await pinned.evaluate((sessionId) => window.snipvia.performance.report(sessionId), state.value.performanceSessionId);
      if (!result.ok || !result.value) throw new Error(result.ok ? 'performance report missing' : result.error);
      scenarios.push({ name, captureIndex: scenarios.length + 1, round, requestedDip: { width: end.x - start.x, height: end.y - start.y }, report: result.value });
    };

    const sizes = [
      ['small', () => ({ width: 500, height: 300 })],
      ['medium', (width: number, height: number) => ({ width: Math.round(width * 0.7), height: Math.round(height * 0.7) })],
      ['large', (width: number, height: number) => ({ width: width - 24, height: height - 24 })]
    ] as const;
    for (const round of [1, 2, 3] as const) {
      for (const [name, sizeFor] of sizes) {
        await capture(name, round, sizeFor);
        if (round !== 3 || name !== 'large') {
          await pinned.evaluate(() => window.snipvia.pin.close());
          await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().includes('#pin'))?.isVisible())).toBe(false);
        }
      }
    }
    expect(app.windows().some(window => window.url().endsWith('#quick-chat'))).toBe(false);
    expect(scenarios).toHaveLength(9);
    for (const scenario of scenarios) {
      expect(scenario.report.metrics.captureStartToOverlayVisibleMs).toBeGreaterThan(0);
      expect(scenario.report.metrics.selectionToScreenshotVisibleMs).toBeGreaterThan(0);
      expect(scenario.report.marks.map((mark) => mark.event)).toEqual(expect.arrayContaining([
        'capture_overlay_reuse_start', 'capture_overlay_reuse_visible',
        'screenshot_window_reuse_start', 'screenshot_window_reuse_visible'
      ]));
      expect(scenario.report.marks.some((mark) => mark.event === 'overlay_window_create_start')).toBe(false);
      expect(scenario.report.marks.some((mark) => mark.event === 'pin_window_create_start')).toBe(false);
    }
    expect(scenarios.every(scenario => !scenario.report.marks.some(mark => mark.event === 'history_create_start' || mark.event === 'chat_send_main_received'))).toBe(true);

    await pinned.evaluate(() => window.snipvia.pin.close());
    await expect(pinned.getByAltText('置顶截图')).toHaveCount(0);
    const finalWindowIds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(window => window.id));
    expect(finalWindowIds).toEqual(initialWindowIds);
    const backendStatus = await page.evaluate(() => window.snipvia.performance.captureBackendStatus());
    if (!backendStatus.ok) throw new Error(backendStatus.error);
    const runtimeUsage = backendStatus.value.runtimeScreenshots;
    expect(runtimeUsage).toEqual({ items: 0, bytes: 0 });
    const completedStartupResult = await page.evaluate(() => window.snipvia.performance.startupReport());
    if (!completedStartupResult.ok || !completedStartupResult.value) throw new Error(completedStartupResult.ok ? 'completed startup performance report missing' : completedStartupResult.error);
    await mkdir('test-results', { recursive: true });
    const output = realScreen ? 'test-results/screenshot-performance-real-phase4.json' : 'test-results/screenshot-performance-phase4.json';
    await writeFile(output, JSON.stringify({
      collectedAt: new Date().toISOString(),
      environment,
      launchToReusableWindowsReadyMs,
      resources: { windowCount: finalWindowIds.length, reusedWindowIds: true, finalRuntimeScreenshots: runtimeUsage, captures: 9 },
      trigger: 'capture.start IPC; OS global shortcut dispatch excluded',
      captureSource: realScreen
        ? 'real macOS desktopCapturer frame; screenshots deleted with temporary user data after collection'
        : 'deterministic synthetic frame; real Electron/Renderer/IPC/NativeImage/filesystem pipeline',
      startup: completedStartupResult.value,
      scenarios
    }, null, 2));
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
