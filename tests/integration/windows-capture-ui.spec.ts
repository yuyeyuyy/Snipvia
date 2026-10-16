import { expect, test } from '@playwright/test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { launchDesktop } from '../helpers/desktop';

test('Windows renderer uses Enter for the entire display and reuses the overlay after cancellation', async () => {
  test.setTimeout(60_000);
  const root = resolve('.');
  const directory = await mkdtemp(join(tmpdir(), 'snipvia-win-ui-'));
  const preload = join(directory, 'preload.cjs');
  const main = join(root, 'out/main/index.js');
  // Bundlers may rename the node:path import (for example path$1). Validate
  // this fixture before launching Electron so a mismatch cannot look like a
  // production window startup timeout.
  const mainSource = await readFile(main, 'utf8');
  const preloadTargets = mainSource.match(/\b[\w$]+\.join\(__dirname, ["']\.\.\/preload\/index\.js["']\)/g);
  expect(preloadTargets, 'bundled preload path fixture').toHaveLength(1);
  const source = await readFile(join(root, 'out/preload/index.js'), 'utf8');
  expect(source).toContain('platform: process.platform');
  // Simulate only Renderer platform selection. Native Electron still runs on
  // the host OS: this verifies UI/IPC, never claims Windows runtime coverage.
  await writeFile(preload, source.replace('platform: process.platform', 'platform: "win32"'));
  const bootstrap = join(directory, 'bootstrap.cjs');
  await writeFile(bootstrap, `
    const { app, clipboard, desktopCapturer, nativeImage, screen } = require('electron');
    app.setAppPath(${JSON.stringify(root)});
    globalThis.fullScreenCopy = null;
    clipboard.write = async items => {
      const blob = await items[0].getType('image/png');
      globalThis.fullScreenCopy = nativeImage.createFromBuffer(Buffer.from(await blob.arrayBuffer())).getSize();
    };
    desktopCapturer.getSources = async options => {
      const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
      const size = options.thumbnailSize;
      return [{ id: 'screen:synthetic', name: 'Synthetic', display_id: String(display.id),
        thumbnail: nativeImage.createFromBuffer(Buffer.alloc(size.width * size.height * 4, 255), size) }];
    };
    const Module = require('node:module');
    const load = Module._extensions['.js'];
    Module._extensions['.js'] = (module, path) => {
      if (path !== ${JSON.stringify(main)}) return load(module, path);
      const source = require('node:fs').readFileSync(path, 'utf8');
      const original = ${JSON.stringify(preloadTargets![0])};
      if (!source.includes(original)) throw new Error('Preload fixture target missing');
      module._compile(source.replace(original, ${JSON.stringify(JSON.stringify(preload))}), path);
    };
    require(${JSON.stringify(main)});
  `);
  const instance = await launchDesktop({ args: [bootstrap, `--user-data-dir=${join(directory, 'data')}`],
    env: { ...process.env, SNIPVIA_CAPTURE_BACKEND: 'electron', SNIPVIA_CAPTURE_WARMUP: '0' } });
  try {
    const page = await instance.firstWindow();
    await expect.poll(() => instance.windows().some(window => window.url().endsWith('#capture'))).toBe(true);
    const overlay = instance.windows().find(window => window.url().endsWith('#capture'))!;
    const start = async () => {
      expect((await page.evaluate(() => window.snipvia.capture.start('standard'))).ok).toBe(true);
      await expect(overlay.locator('.screen-frame')).toBeVisible();
      await expect(overlay.locator('.capture-hint')).toContainText('Enter 全屏');
    };
    await start();
    await overlay.screenshot({ path: 'test-results/windows-capture-ui-synthetic.png' });
    const count = instance.windows().length;
    await overlay.keyboard.press('Escape');
    await expect.poll(() => instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every(window => !window.isVisible()))).toBe(true);
    await start();
    expect(instance.windows()).toHaveLength(count);
    await overlay.keyboard.press('Enter');
    await overlay.getByRole('button', { name: '复制并关闭', exact: true }).click();
    const sizes = await instance.evaluate(({ screen }) => {
      const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
      return { actual: (globalThis as typeof globalThis & { fullScreenCopy: { width: number; height: number } }).fullScreenCopy,
        expected: { width: Math.round(display.size.width * display.scaleFactor), height: Math.round(display.size.height * display.scaleFactor) } };
    });
    expect(sizes.actual).toEqual(sizes.expected);
    await start();
    await overlay.mouse.move(100, 100); await overlay.mouse.down(); await overlay.mouse.move(300, 250); await overlay.mouse.up();
    await expect(overlay.getByRole('button', { name: '复制并关闭', exact: true })).toBeVisible();
    await overlay.getByRole('button', { name: '复制并关闭', exact: true }).click();
  } finally { await instance.close(); await rm(directory, { recursive: true, force: true }); }
});
