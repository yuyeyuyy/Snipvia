import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchDesktop } from '../helpers/desktop';

async function synthetic(app: ElectronApplication) {
  await app.evaluate(({ clipboard, desktopCapturer, nativeImage, screen, systemPreferences }) => {
    systemPreferences.getMediaAccessStatus = () => 'granted';
    const probe = { copies: 0, fail: false };
    (globalThis as typeof globalThis & { continuousProbe: typeof probe }).continuousProbe = probe;
    clipboard.write = async () => { if (probe.fail) throw new Error('synthetic clipboard denied'); probe.copies++; };
    desktopCapturer.getSources = async options => {
      const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()), size = options.thumbnailSize!;
      const frame = nativeImage.createFromBitmap(Buffer.alloc(size.width * size.height * 4, 255), size);
      return [{ id: 'screen:continuous', name: 'Synthetic', display_id: String(display.id), appIcon: nativeImage.createEmpty(), thumbnail: frame }];
    };
  });
}
async function select(page: Page, overlay: Page, mode: 'quick' | 'collect' | 'edit', index = 0) {
  const started = await page.evaluate(mode => window.snipvia.capture.start(mode), mode);
  if (!started.ok) throw new Error(started.error);
  await expect(overlay.locator('.screen-frame')).toBeVisible();
  const id = await overlay.locator('.capture-overlay').getAttribute('data-performance-session');
  await overlay.mouse.move(70, 70); await overlay.mouse.down(); await overlay.mouse.move(210 + index, 160 + index); await overlay.mouse.up();
  return id!;
}
test('Quick copies directly, retries clipboard failures, isolates sessions and never shows Pin', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'snipvia-v2-quick-'));
  const app = await launchDesktop({ args: ['.', '--user-data-dir=' + dir], env: { ...process.env, SNIPVIA_CAPTURE_BACKEND: 'electron', SNIPVIA_CAPTURE_WARMUP: '0' } });
  try {
    await synthetic(app);
    const page = await app.firstWindow(), overlay = app.windows().find(p => p.url().endsWith('#capture'))!;
    const ids = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(w => w.id));
    const samples = [];
    for (let i = 0; i < 3; i++) {
      const id = await select(page, overlay, 'quick', i);
      await expect.poll(async () => { const r = await page.evaluate(id => window.snipvia.performance.report(id), id); return r.ok && r.value?.marks.some(m => m.event === 'clipboard_committed'); }).toBe(true);
      const r = await page.evaluate(id => window.snipvia.performance.report(id), id);
      samples.push(r);
      expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('#pin'))!.isVisible())).toBe(false);
    }
    expect(await page.evaluate(() => window.snipvia.screenshots.list())).toEqual({ ok: true, value: [] });
    const usage = await page.evaluate(() => window.snipvia.performance.captureBackendStatus());
    expect(usage.ok && usage.value.runtimeScreenshots).toEqual({ items: 0, bytes: 0 });
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(w => w.id))).toEqual(ids);
    await app.evaluate(() => { (globalThis as typeof globalThis & { continuousProbe: { fail: boolean } }).continuousProbe.fail = true; });
    await select(page, overlay, 'quick');
    await expect(overlay.locator('.capture-overlay')).toContainText('synthetic clipboard denied');
    await overlay.keyboard.press('Escape');
    await mkdir('test-results', { recursive: true }); await writeFile('test-results/v2-quick.json', JSON.stringify(samples, null, 2));
  } finally { await app.close(); await rm(dir, { recursive: true, force: true }); }
});
