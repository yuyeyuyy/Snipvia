import { launchDesktop } from '../helpers/desktop';
import { expect, test } from '@playwright/test';
import { createServer } from 'node:http';
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
  const server = createServer((_request, response) => {
    setTimeout(() => {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ choices: [{ message: { content: '本地基线回答' }, finish_reason: 'stop' }] }));
    }, 75);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('mock server unavailable');

  const app = await launchDesktop({
    args: ['.', `--user-data-dir=${directory}`],
    env: { ...process.env, SNIPVIA_PERF: process.env.SNIPVIA_PERF ?? '0', SNIPVIA_CAPTURE_BACKEND: 'electron' }
  });

  try {
    const page = await app.firstWindow();
    await expect(page.getByRole('button', { name: 'AI 笔记', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect.poll(() => app.windows().some((window) => window.url().endsWith('#capture'))).toBe(true);
    await expect.poll(() => app.windows().some((window) => window.url().endsWith('#pin'))).toBe(true);
    const overlay = app.windows().find((window) => window.url().endsWith('#capture'))!;
    const pinned = app.windows().find((window) => window.url().endsWith('#pin'))!;
    const startupResult = await page.evaluate(() => window.snipvia.performance.startupReport());
    if (!startupResult.ok || !startupResult.value) throw new Error(startupResult.ok ? 'startup performance report missing' : startupResult.error);
    const settings = await page.evaluate(() => window.snipvia.settings.get());
    if (!settings.ok) throw new Error(settings.error);
    const saved = await page.evaluate(async ({ endpoint, shortcut, continueShortcut, editorShortcut, predictionBranches }) => window.snipvia.settings.save({
      provider: 'custom', endpoint, model: 'baseline-mock', shortcut, continueShortcut, editorShortcut, predictionBranches, apiKey: ''
    }), {
      endpoint: `http://127.0.0.1:${address.port}/v1`,
      shortcut: settings.value.shortcut,
      continueShortcut: settings.value.continueShortcut,
      editorShortcut: settings.value.editorShortcut,
      predictionBranches: settings.value.predictionBranches
    });
    if (!saved.ok) throw new Error(saved.error);

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
      await app.evaluate(({ desktopCapturer, nativeImage, screen, systemPreferences }) => {
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
    await expect.poll(() => app.windows().some((window) => window.url().endsWith('#quick-chat'))).toBe(true);
    const chat = app.windows().find((window) => window.url().endsWith('#quick-chat'))!;
    await expect(chat.locator('.quick-chat')).toBeVisible();
    // This baseline measures the ordinary streaming provider's existing marks.
    // Agent activity and its UI are covered independently in agent-execution.
    const streamed = await chat.evaluate(async () => {
      const state = await window.snipvia.chat.state(); if (!state.ok) throw new Error(state.error);
      return window.snipvia.chat.stream({ captureId: state.value.capture.id, question: '运行基线请求', performanceSessionId: state.value.performanceSessionId });
    });
    expect(streamed.ok).toBe(true);
    await expect(chat.locator('.quick-message.assistant')).toContainText('本地基线回答');
    await expect.poll(async () => chat.evaluate(async () => {
      const state = await window.snipvia.chat.state();
      if (!state.ok || !state.value.performanceSessionId) return undefined;
      const result = await window.snipvia.performance.report(state.value.performanceSessionId);
      return result.ok ? result.value?.marks.some((mark) => mark.event === 'chat_response_visible') : false;
    })).toBe(true);
    const finalState = await chat.evaluate(() => window.snipvia.chat.state());
    if (!finalState.ok || !finalState.value.performanceSessionId) throw new Error(finalState.ok ? 'performance session missing' : finalState.error);
    const finalResult = await chat.evaluate((sessionId) => window.snipvia.performance.report(sessionId), finalState.value.performanceSessionId);
    if (!finalResult.ok || !finalResult.value) throw new Error(finalResult.ok ? 'performance report missing' : finalResult.error);
    scenarios[scenarios.length - 1].report = finalResult.value;

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
    expect(scenarios[scenarios.length - 1].report.metrics.aiRequestToCompleteMs).toBeGreaterThan(0);

    const completedStartupResult = await page.evaluate(() => window.snipvia.performance.startupReport());
    if (!completedStartupResult.ok || !completedStartupResult.value) throw new Error(completedStartupResult.ok ? 'completed startup performance report missing' : completedStartupResult.error);
    await mkdir('test-results', { recursive: true });
    const output = realScreen ? 'test-results/screenshot-performance-real-phase4.json' : 'test-results/screenshot-performance-phase4.json';
    await writeFile(output, JSON.stringify({
      collectedAt: new Date().toISOString(),
      environment,
      trigger: 'capture.start IPC; OS global shortcut dispatch excluded',
      captureSource: realScreen
        ? 'real macOS desktopCapturer frame; screenshots deleted with temporary user data after collection'
        : 'deterministic synthetic frame; real Electron/Renderer/IPC/NativeImage/filesystem pipeline',
      startup: completedStartupResult.value,
      scenarios
    }, null, 2));
  } finally {
    await app.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
