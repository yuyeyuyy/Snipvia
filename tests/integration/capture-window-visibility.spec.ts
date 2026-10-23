import { expect, test } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { launchDesktop } from '../helpers/desktop';

for (const backend of ['electron', 'screen-capture-kit'] as const) {
  test(`${backend}: capture exit stays hidden, return and deliberate Dock activation show main`, async () => {
    test.skip(backend === 'screen-capture-kit' && process.platform !== 'darwin', 'Native capture is macOS only');
    test.setTimeout(60_000);
    const directory = await mkdtemp(join(tmpdir(), 'snipvia-window-visibility-'));
    const root = resolve('.');
    const mainPath = join(root, 'out/main/index.js');
    const bootstrap = join(directory, 'bootstrap.cjs');
    const nativeMock = `
      ScreenCaptureKitBackend.prototype.initialize = async function () {};
      ScreenCaptureKitBackend.prototype.isAvailable = async function () { return true; };
      ScreenCaptureKitBackend.prototype.shouldAttemptCapture = function () { return true; };
      ScreenCaptureKitBackend.prototype.captureDisplay = async function (request) {
        return globalThis.syntheticFrame(Math.round(request.display.size.width * request.display.scaleFactor),
          Math.round(request.display.size.height * request.display.scaleFactor), request.display.id);
      };
    `;
    // Instrument this isolated build so native-backend behavior is exercised
    // without recording the desktop, starting the Swift helper or granting access.
    await writeFile(bootstrap, `
      const { app, desktopCapturer, nativeImage, screen, systemPreferences, clipboard } = require('electron');
      app.setAppPath(${JSON.stringify(root)});
      systemPreferences.getMediaAccessStatus = () => 'granted';
      globalThis.captureFailure = false;
      globalThis.syntheticCopies = 0;
      globalThis.captureWindowVisibility = [];
      clipboard.write = async () => { globalThis.syntheticCopies++; };
      globalThis.syntheticFrame = (width, height, displayId) => {
        if (globalThis.captureFailure) throw new Error('synthetic capture failure');
        const main = require('electron').BrowserWindow.getAllWindows().find(w => !w.webContents.getURL().includes('#'));
        globalThis.captureWindowVisibility.push(main.isVisible());
        return { width, height, displayId, scaleFactor: 1, capturedAt: Date.now(), format: 'bgra',
          image: nativeImage.createFromBuffer(Buffer.alloc(width * height * 4, 255), { width, height }) };
      };
      desktopCapturer.getSources = async options => {
        const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
        const frame = globalThis.syntheticFrame(options.thumbnailSize.width, options.thumbnailSize.height, String(display.id));
        return [{ id: 'screen:synthetic', name: 'Synthetic screen', display_id: String(display.id),
          appIcon: nativeImage.createEmpty(), thumbnail: frame.image }];
      };
      {
        const Module = require('node:module');
        const load = Module._extensions['.js'];
        Module._extensions['.js'] = (module, path) => {
          if (path !== ${JSON.stringify(mainPath)}) return load(module, path);
          const source = require('node:fs').readFileSync(path, 'utf8');
          module._compile(source + ${JSON.stringify(backend === 'screen-capture-kit' ? nativeMock : '')} +
            '\\nglobalThis.captureVisibilityDebug = () => ({ preparing, overlayActive: captureOverlayWindow?.isActive(), mainVisible: mainWindow.isVisible() });', path);
        };
      }
      require(${JSON.stringify(mainPath)});
    `);
    const instance = await launchDesktop({ args: [bootstrap, `--user-data-dir=${join(directory, 'data')}`], env: {
      ...process.env, SNIPVIA_CAPTURE_BACKEND: backend, SNIPVIA_CAPTURE_WARMUP: '0'
    } });
    try {
      const main = await instance.firstWindow();
      await expect.poll(() => instance.windows().some(w => w.url().endsWith('#capture'))).toBe(true);
      const overlay = instance.windows().find(w => w.url().endsWith('#capture'))!;
      await expect.poll(() => instance.windows().some(w => w.url().endsWith('#pin'))).toBe(true);
      const pin = instance.windows().find(w => w.url().endsWith('#pin'))!;
      await instance.evaluate(({ BrowserWindow }) => {
        const main = BrowserWindow.getAllWindows().find(w => !w.webContents.getURL().includes('#'))!;
        (globalThis as typeof globalThis & { mainShows: number }).mainShows = 0;
        let hidden = !main.isVisible();
        main.on('hide', () => { hidden = true; });
        main.on('show', () => {
          if (hidden && main.isVisible()) (globalThis as typeof globalThis & { mainShows: number }).mainShows++;
          hidden = !main.isVisible();
        });
      });
      const visible = (hash = '') => instance.evaluate(({ BrowserWindow }, hash) => {
        return BrowserWindow.getAllWindows().some(w => {
          const url = w.webContents.getURL();
          return url && new URL(url).hash === hash && w.isVisible();
        });
      }, hash);
      const expectHidden = async () => {
        await expect.poll(() => visible()).toBe(false);
        // Detect brief show/hide flicker as well as an incorrectly visible final window.
        const shows = await instance.evaluate(async () => {
          await new Promise(resolve => setTimeout(resolve, 120));
          return (globalThis as typeof globalThis & { mainShows: number }).mainShows;
        });
        expect(shows).toBe(0);
      };
      const openMain = async () => {
        const result = await instance.evaluate(async ({ app }) => {
          const debug = (globalThis as typeof globalThis & { captureVisibilityDebug: () => { preparing: boolean; overlayActive: boolean; mainVisible: boolean } }).captureVisibilityDebug;
          const before = debug();
          app.emit('activate', {}, false);
          await new Promise(resolve => setTimeout(resolve, 120));
          (globalThis as typeof globalThis & { mainShows: number }).mainShows = 0;
          return { before, after: debug() };
        });
        expect(result.after.mainVisible, JSON.stringify(result)).toBe(true);
        await expect.poll(() => visible()).toBe(true);
      };
      const start = async (mode: 'ai' | 'standard' = 'standard') => {
        const result = await main.evaluate(mode => window.snipvia.capture.start(mode), mode);
        expect(result.ok).toBe(true);
        await expect(overlay.locator('.screen-frame')).toBeVisible();
        await expectHidden();
        const report = await overlay.evaluate(async () => {
          const frame = await window.snipvia.capture.frame(); if (!frame.ok) throw new Error(frame.error);
          const report = await window.snipvia.performance.report(frame.value.performanceSessionId);
          if (!report.ok || !report.value) throw new Error('Missing capture report');
          return report.value;
        });
        expect(report.metadata.captureBackend).toBe(backend);
      };
      const select = async () => {
        await overlay.mouse.move(100, 100); await overlay.mouse.down(); await overlay.mouse.move(360, 260); await overlay.mouse.up();
      };
      const quick = async () => {
        if (await overlay.getByRole('button', { name: '定住截图', exact: true }).count()) await overlay.getByRole('button', { name: '定住截图', exact: true }).click();
        await expect.poll(() => visible('#pin')).toBe(true);
        expect(instance.windows().some(window => window.url().endsWith('#quick-chat'))).toBe(false);
        return pin;
      };

      await start(); await select();
      await quick();
      await expect(pin.getByRole('button')).toHaveCount(0);
      const layout = await pin.evaluate(() => {
        const image = document.querySelector('img')!.getBoundingClientRect();
        return { imageHeight: image.height, imageWidth: image.width, height: innerHeight, width: innerWidth };
      });
      expect(layout.imageHeight).toBe(layout.height);
      expect(layout.imageWidth).toBe(layout.width);
      await pin.screenshot({ path: `test-results/pin-image-only-${backend}.png` });
      await pin.keyboard.press('Control+C');
      await expect.poll(() => visible('#pin')).toBe(false);
      await expectHidden();
      expect(await instance.evaluate(() => (globalThis as typeof globalThis & { syntheticCopies: number }).syntheticCopies)).toBe(1);

      await openMain(); await start(); await select(); await quick();
      await (await quick()).keyboard.press('Escape');
      await expect.poll(() => visible('#quick-chat')).toBe(false);
      await expectHidden();

      await openMain(); await start();
      await overlay.keyboard.press('Escape');
      await expect.poll(() => visible('#capture')).toBe(false);
      await expectHidden();

      await openMain(); await start('standard'); await select();
      await overlay.getByRole('button', { name: '复制并关闭', exact: true }).click();
      await expect.poll(() => visible('#capture')).toBe(false);
      await expectHidden();

      await openMain(); await start(); await select(); await quick();
      await pin.keyboard.press('Escape');
      await openMain();
      await expect(main.getByRole('heading', { name: '设置', exact: true })).toBeVisible();
      await instance.evaluate(() => { (globalThis as typeof globalThis & { mainShows: number }).mainShows = 0; });
      await instance.evaluate(({ Menu }) => Menu.getApplicationMenu()!.items[0].submenu!.items.find(item => item.label === '快速截图')!.click());
      // Menu callbacks start asynchronously; the hidden reused renderer can
      // still contain the previous frame before the new session is presented.
      await expect.poll(() => visible('#capture')).toBe(true);
      await expect(overlay.locator('.screen-frame')).toBeVisible();
      await overlay.keyboard.press('Escape');
      await expect.poll(() => visible('#capture')).toBe(false);
      await expectHidden();

      await openMain();
      await instance.evaluate(({ Menu }) => {
        (globalThis as typeof globalThis & { captureFailure: boolean }).captureFailure = true;
        Menu.getApplicationMenu()!.items[0].submenu!.items.find(item => item.label === '截图与标注')!.click();
      });
      await expect(main.getByRole('alert').filter({ hasText: 'synthetic capture failure' })).toHaveCount(1);
      await expectHidden();
      expect(await instance.evaluate(() => (globalThis as typeof globalThis & { captureWindowVisibility: boolean[] }).captureWindowVisibility.every(visible => !visible))).toBe(true);
      await openMain();
    } finally { await instance.close(); await rm(directory, { recursive: true, force: true }); }
  });
}
