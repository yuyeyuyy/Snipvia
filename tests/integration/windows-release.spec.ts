import { _electron as electron, expect, test, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const metadata = JSON.parse(readFileSync('package.json', 'utf8'));

test('installed Windows client uses the patched runtime and preserves local capture workflows', async () => {
  test.skip(process.platform !== 'win32' || !process.env.SNIPVIA_TEST_APP_BINARY, 'Requires an installed Windows package in the temporary CI directory');
  test.setTimeout(120_000);
  const directory = await mkdtemp(join(tmpdir(), 'snipvia-win-installed-'));
  const app = await electron.launch({ executablePath: process.env.SNIPVIA_TEST_APP_BINARY,
    args: ['--user-data-dir=' + directory], env: { ...process.env, ELECTRON_RENDERER_URL: '' } });
  try {
    await expect.poll(() => app.windows().some(page => !new URL(page.url()).hash)).toBe(true);
    const page = app.windows().find(page => !new URL(page.url()).hash)!;
    await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible();
    const status = await app.evaluate(({ app, nativeImage, globalShortcut }) => {
      const path = process.getBuiltinModule('path');
      return { packaged: app.isPackaged, version: app.getVersion(), runtime: process.versions.electron,
        architecture: process.arch, userData: app.getPath('userData'),
        iconEmpty: nativeImage.createFromPath(path.join(process.resourcesPath, 'Snipvia.ico')).isEmpty(),
        shortcut: globalShortcut.isRegistered('Control+1') };
    });
    expect(status).toMatchObject({ packaged: true, version: metadata.version, runtime: metadata.devDependencies.electron,
      architecture: 'x64', iconEmpty: false, shortcut: true });
    expect(await page.evaluate(() => ({ bridge: typeof window.snipvia.capture.start === 'function', node: 'require' in window || 'process' in window }))).toEqual({ bridge: true, node: false });
    expect(status.userData.toLowerCase()).toBe(directory.toLowerCase());
    await expect(page.getByRole('navigation', { name: '设置分类' }).getByRole('button')).toHaveCount(7);
    const config = await page.evaluate(() => window.snipvia.collection.current());
    if (!config.ok) throw new Error(config.error);
    expect((await page.evaluate(value => window.snipvia.collection.configure({ ...value, autoHide: false }), config.value.preferences)).ok).toBe(true);
    await app.evaluate(({ desktopCapturer, nativeImage, screen }) => {
      // All frames are synthetic. No user screen or production service is read.
      globalThis.fetch = async () => { throw new Error('Installed package validation blocks network'); };
      desktopCapturer.getSources = async options => {
        const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()), size = options.thumbnailSize!;
        return [{ id: 'screen:synthetic', name: 'Synthetic', display_id: String(display.id), appIcon: nativeImage.createEmpty(),
          thumbnail: nativeImage.createFromBitmap(Buffer.alloc(size.width * size.height * 4, 255), size) }];
      };
    });
    await expect.poll(() => app.windows().some(page => page.url().endsWith('#capture'))).toBe(true);
    const overlay = app.windows().find(page => page.url().endsWith('#capture'))!;
    const start = async (mode: 'quick' | 'edit' | 'collect') => {
      const result = await page.evaluate(mode => window.snipvia.capture.start(mode), mode);
      if (!result.ok) throw new Error(result.error);
      await expect(overlay.locator('.screen-frame')).toBeVisible();
    };
    const select = async (target: Page) => {
      await target.mouse.move(70, 70); await target.mouse.down();
      await target.mouse.move(230, 170); await target.mouse.up();
    };
    await start('edit'); await overlay.keyboard.press('Escape');
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every(window => !window.isVisible()))).toBe(true);
    await start('quick'); await select(overlay);
    await expect.poll(() => app.evaluate(async ({ clipboard }) => (await clipboard.read()).some(item => item.types.includes('image/png')))).toBe(true);
    await start('collect'); await select(overlay);
    await expect.poll(async () => { const result = await page.evaluate(() => window.snipvia.collection.current()); return result.ok && result.value.collection.count; }).toBe(1);
    await expect.poll(() => app.windows().some(page => page.url().endsWith('#shelf'))).toBe(true);
    const shelf = app.windows().find(page => page.url().endsWith('#shelf'))!;
    await expect(shelf.getByRole('button', { name: '展开图堆', exact: true })).toBeVisible();
    await shelf.getByRole('button', { name: '展开图堆', exact: true }).click();
    await expect(shelf.locator('.shelf-grid article')).toHaveCount(1);
    expect(await page.evaluate(() => window.snipvia.screenshots.list())).toEqual({ ok: true, value: [] });
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
