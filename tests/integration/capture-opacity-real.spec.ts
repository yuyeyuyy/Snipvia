import { expect, test } from '@playwright/test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchDesktop } from '../helpers/desktop';
test.use({ trace: 'off', screenshot: 'off', video: 'off' });

test('real Electron capture excludes a zero-alpha Shelf without persisting screen pixels', async () => {
  test.skip(process.env.SNIPVIA_REAL_SCREEN !== '1', 'Explicit real-screen permission required');
  test.setTimeout(60_000);
  const directory = await mkdtemp(join(tmpdir(), 'snipvia-opacity-real-'));
  const app = await launchDesktop({ args: ['.', '--user-data-dir=' + directory], env: { ...process.env, SNIPVIA_CAPTURE_BACKEND: 'electron', SNIPVIA_CAPTURE_WARMUP: '0' } });
  const records: unknown[] = [];
  try {
    const main = await app.firstWindow(), overlay = app.windows().find(p => p.url().endsWith('#capture'))!;
    const preferences = await main.evaluate(() => window.snipvia.collection.current()); if (!preferences.ok) throw Error(preferences.error);
    expect((await main.evaluate(value => window.snipvia.collection.configure({ ...value, autoHide: false }), preferences.value.preferences)).ok).toBe(true);
    const permission = await main.evaluate(() => window.snipvia.permissions.screen()); records.push({ permission });
    if (!permission.ok || permission.value.supported && permission.value.status !== 'granted') throw new Error('Existing screen recording grant is required; permissions were not changed');
    await app.evaluate(async ({ BrowserWindow, screen, clipboard }) => {
      clipboard.write = async () => {};
      const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
      const background = new BrowserWindow({ ...display.bounds, show: false, frame: false, alwaysOnTop: true, focusable: false, skipTaskbar: true, backgroundColor: '#525252', webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
      await background.loadURL('data:text/html,<body style="margin:0;background:%23525252"></body>');
      background.showInactive();
    });
    expect((await main.evaluate(() => window.snipvia.capture.start('collect'))).ok).toBe(true);
    await expect(overlay.locator('.screen-frame')).toBeVisible();
    await overlay.mouse.move(100, 140); await overlay.mouse.down(); await overlay.mouse.move(280, 300); await overlay.mouse.up();
    const shelf = await expect.poll(() => app.windows().some(p => p.url().endsWith('#shelf'))).toBe(true).then(() => app.windows().find(p => p.url().endsWith('#shelf'))!);
    await expect(shelf.locator('.shelf.collapsed')).toBeVisible();
    await shelf.getByRole('button', { name: '展开图堆', exact: true }).hover();
    // The count badge is visibly different from our synthetic background. Its old
    // position must contain only background pixels in each subsequent capture.
    const badge = await shelf.locator('.shelf-count').boundingBox(); if (!badge) throw new Error('count badge missing');
    const point = await app.evaluate(({ BrowserWindow, screen }, badge) => {
      const w = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('#shelf'))!;
      const b = w.getBounds(), d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
      return { x: b.x + badge.x + 5 - d.bounds.x, y: b.y + badge.y + 5 - d.bounds.y };
    }, badge);
    for (let index = 0; index < 3; index++) {
      expect((await main.evaluate(() => window.snipvia.capture.start('quick'))).ok).toBe(true);
      await expect(overlay.locator('.screen-frame')).toBeVisible();
      expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('#shelf'))!.getOpacity())).toBe(0);
      const pixel = await overlay.evaluate(point => {
        const image = document.querySelector<HTMLImageElement>('.screen-frame')!;
        const canvas = document.createElement('canvas'); canvas.width = 1; canvas.height = 1;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(image, point.x * image.naturalWidth / innerWidth, point.y * image.naturalHeight / innerHeight, 1, 1, 0, 0, 1, 1);
        return [...ctx.getImageData(0, 0, 1, 1).data];
      }, point);
      records.push({ index, pixel });
      for (const value of pixel.slice(0, 3)) expect(Math.abs(value - 82)).toBeLessThanOrEqual(6);
      await overlay.keyboard.press('Escape'); await expect(shelf.locator('.shelf.collapsed')).toBeVisible();
    }
  } finally {
    await mkdir('test-results', { recursive: true });
    await writeFile('test-results/opacity-real.json', JSON.stringify({ records, privatePixelsPersisted: false, clipboardMocked: true }, null, 2));
    await app.close(); await rm(directory, { recursive: true, force: true });
  }
});
