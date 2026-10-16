import { launchDesktop } from '../helpers/desktop';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { arch, cpus, release, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ScreenshotPerformanceReport } from '../../src/shared/performance';

const realScreen = process.env.SNIPVIA_REAL_SCREEN === '1';
const sampleCount = Math.max(1, Math.min(10, Number(process.env.SNIPVIA_CAPTURE_LATENCY_SAMPLES ?? 3)));
const outputPath = process.env.SNIPVIA_CAPTURE_LATENCY_OUTPUT ?? 'performance-results/capture-latency-real.json';

type Launched = { app: ElectronApplication; main: Page; overlay: Page; directory: string };

const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const percentile = (values: number[], ratio: number) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.ceil(values.length * ratio) - 1)];

async function launch(): Promise<Launched> {
  const directory = await mkdtemp(join(tmpdir(), 'snipvia-capture-latency-'));
  const app = await launchDesktop({
    args: ['.', `--user-data-dir=${directory}`],
    env: {
      ...process.env,
      SNIPVIA_PERF: '',
      SNIPVIA_CAPTURE_BACKEND: 'sck',
      SNIPVIA_CAPTURE_WARMUP: '0'
    }
  });
  const main = await app.firstWindow();
  await expect(main.getByRole('button', { name: 'AI 笔记', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect.poll(() => app.windows().some((window) => window.url().endsWith('#capture'))).toBe(true);
  const overlay = app.windows().find((window) => window.url().endsWith('#capture'))!;
  await expect.poll(async () => {
    const status = await main.evaluate(() => window.snipvia.performance.captureBackendStatus());
    return status.ok && status.value.screenCaptureKit?.healthy;
  }, { timeout: 10_000 }).toBe(true);
  return { app, main, overlay, directory };
}

async function capture(main: Page, overlay: Page) {
  await main.bringToFront();
  const result = await main.evaluate(() => window.snipvia.capture.start());
  if (!result.ok) throw new Error(result.error);
  await expect(overlay.locator('.screen-frame')).toBeVisible();
  const sessionId = await overlay.locator('.capture-overlay').getAttribute('data-performance-session');
  if (!sessionId) throw new Error('截图会话缺少性能 ID');
  const report = await overlay.evaluate((id) => window.snipvia.performance.report(id), sessionId);
  if (!report.ok || !report.value) throw new Error(report.ok ? '性能报告不存在' : report.error);
  await overlay.keyboard.press('Escape');
  await expect(overlay.locator('.screen-frame')).toBeHidden();
  return report.value;
}

test('measures real capture response latency with a small sample', async () => {
  test.skip(!realScreen, 'Set SNIPVIA_REAL_SCREEN=1 to run the real capture latency test.');
  test.setTimeout(120_000);
  const launched = await launch();
  try {
    const reports: ScreenshotPerformanceReport[] = [];
    for (let index = 0; index < sampleCount; index++) reports.push(await capture(launched.main, launched.overlay));
    const ready = reports.map((report) => Number(report.metrics.captureStartToOverlayVisibleMs));
    const responsive = reports
      .map((report) => report.metrics.captureStartToOverlayShellVisibleMs)
      .filter((value): value is number => typeof value === 'number');
    const status = await launched.main.evaluate(() => window.snipvia.performance.captureBackendStatus());
    const output = {
      collectedAt: new Date().toISOString(),
      environment: {
        osRelease: release(),
        architecture: arch(),
        cpu: cpus()[0]?.model ?? 'unknown',
        display: status.ok ? status.value.screenCaptureKit?.displays[0] : null
      },
      samples: reports.map((report) => ({
        sessionId: report.sessionId,
        responseMs: report.metrics.captureStartToOverlayShellVisibleMs,
        readyMs: report.metrics.captureStartToOverlayVisibleMs,
        shellShowCallMs: report.measures.find((measure) => measure.id === 'capture-shell-show-call')?.durationMs,
        shellPaintMs: (() => {
          const shown = report.marks.find((mark) => mark.event === 'capture_overlay_shell_show_returned');
          const visible = report.marks.find((mark) => mark.event === 'capture_overlay_shell_visible');
          return shown && visible ? visible.atMs - shown.atMs : undefined;
        })(),
        captureMs: report.measures.find((measure) => measure.id === 'sck-capture')?.durationMs,
        encodeMs: report.measures.find((measure) => measure.id === 'sck-encode')?.durationMs,
        backend: report.metadata.captureBackend,
        fallbackUsed: report.metadata.captureFallbackUsed
      })),
      summary: {
        count: reports.length,
        responseAverageMs: responsive.length ? average(responsive) : null,
        readyAverageMs: average(ready),
        readyP50Ms: percentile(ready, 0.5),
        readyMaxMs: Math.max(...ready)
      }
    };
    await mkdir('performance-results', { recursive: true });
    await writeFile(outputPath, JSON.stringify(output, null, 2));
    console.info(`[Capture Latency] ${JSON.stringify(output.summary)}`);
    expect(reports.every((report) => report.metadata.captureBackend === 'screen-capture-kit' && report.metadata.captureFallbackUsed === false)).toBe(true);
  } finally {
    await launched.app.close();
    await rm(launched.directory, { recursive: true, force: true });
  }
});
