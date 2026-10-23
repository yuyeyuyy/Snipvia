import { expect, test } from '@playwright/test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchDesktop } from '../helpers/desktop';

type CaptureProbe = { callback?: () => void; calls: number; blocked: boolean; release: () => void; originalFetch: typeof fetch };

test('registered local screenshot shortcut presents the overlay without waiting for a stalled network', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'snipvia-capture-local-latency-'));
  const app = await launchDesktop({ args: ['.', `--user-data-dir=${directory}`], env: {
    ...process.env, SNIPVIA_CAPTURE_BACKEND: 'electron', SNIPVIA_CAPTURE_WARMUP: '0'
  } });
  try {
    const page = await app.firstWindow();
    const overlay = app.windows().find(window => window.url().endsWith('#capture'))!;
    await app.evaluate(({ globalShortcut, desktopCapturer, nativeImage, screen, systemPreferences, clipboard }) => {
      clipboard.write = async () => {};
      systemPreferences.getMediaAccessStatus = () => 'granted';
      desktopCapturer.getSources = async options => {
        const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()), size = options.thumbnailSize!;
        return [{ id: 'screen:synthetic', name: 'Synthetic screen', display_id: String(display.id), appIcon: nativeImage.createEmpty(),
          thumbnail: nativeImage.createFromBuffer(Buffer.alloc(size.width * size.height * 4, 255), size) }];
      };
      let release!: () => void;
      const blocked = new Promise<void>(resolve => { release = resolve; });
      const probe: CaptureProbe = { calls: 0, blocked: true, release, originalFetch: globalThis.fetch };
      (globalThis as typeof globalThis & { captureProbe: CaptureProbe }).captureProbe = probe;
      globalThis.fetch = async (...args) => { probe.calls++; if (probe.blocked) await blocked; return probe.originalFetch(...args); };
      const register = globalShortcut.register.bind(globalShortcut);
      globalShortcut.register = (accelerator, callback) => {
        if (accelerator === 'CommandOrControl+Shift+F8') probe.callback = callback;
        return register(accelerator, callback);
      };
    });
    const saved = await page.evaluate(async () => {
      const settings = await window.snipvia.settings.get(); if (!settings.ok) throw new Error(settings.error);
      return window.snipvia.settings.saveShortcuts({ editorShortcut: settings.value.editorShortcut, shortcut: 'CommandOrControl+Shift+F8' });
    });
    expect(saved.ok).toBe(true);
    // Invoke the callback installed with globalShortcut.register, not capture:start IPC.
    // OS physical key dispatch and actual screen pixels are intentionally outside this regression.
    const startedAt = await app.evaluate(() => {
      const probe = (globalThis as typeof globalThis & { captureProbe: CaptureProbe }).captureProbe;
      if (!probe.callback) throw new Error('Shortcut callback not registered');
      const started = performance.now(); probe.callback(); return started;
    });
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(window => window.webContents.getURL().endsWith('#capture') && window.isVisible())), { timeout: 1500 }).toBe(true);
    await expect(overlay.locator('.screen-frame')).toBeVisible();
    const visibleAfterMs = await app.evaluate((_electron, started) => performance.now() - started, startedAt);
    expect(await app.evaluate(() => (globalThis as typeof globalThis & { captureProbe: CaptureProbe }).captureProbe.calls)).toBe(0);
    const sessionId = await overlay.locator('.capture-overlay').getAttribute('data-performance-session');
    const report = await overlay.evaluate(id => window.snipvia.performance.report(id!), sessionId);
    expect(report.ok && report.value?.metadata.trigger).toBe('hotkey');
    expect(report.ok && report.value?.marks[0].event).toBe('hotkey_pressed');
    await mkdir('test-results', { recursive: true });
    await writeFile('test-results/capture-local-first-latency.json', JSON.stringify({ scenario: 'all fetches blocked; local capture remains responsive without Chat', visibleAfterMs, report: report.ok ? report.value : null }, null, 2));

    // Selection and local pin remain local even while all fetches would stall.
    await overlay.mouse.move(100, 100); await overlay.mouse.down(); await overlay.mouse.move(400, 300); await overlay.mouse.up();
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(window => window.webContents.getURL().endsWith('#pin') && window.isVisible()))).toBe(true);
    const pin = app.windows().find(window => window.url().endsWith('#pin'))!;
    await expect(pin.getByAltText('置顶截图')).toBeVisible();
    expect(await app.evaluate(() => (globalThis as typeof globalThis & { captureProbe: CaptureProbe }).captureProbe.calls)).toBe(0);
    expect((await pin.evaluate(() => window.snipvia.pin.close())).ok).toBe(true);
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(window => ['#capture', '#quick-chat'].some(hash => window.webContents.getURL().endsWith(hash)) && window.isVisible()))).toBe(false);

  } finally {
    await app.evaluate(() => {
      const probe = (globalThis as typeof globalThis & { captureProbe?: CaptureProbe }).captureProbe;
      if (probe) { probe.blocked = false; probe.release(); globalThis.fetch = probe.originalFetch; }
    }).catch(() => undefined);
    await app.close(); await rm(directory, { recursive: true, force: true });
  }
});
