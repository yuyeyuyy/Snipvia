import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('Mac uses the exported Dock icon and monochrome Retina menu bar template', async () => {
  test.skip(process.platform !== 'darwin', 'Dock is a macOS API');
  const directory = await mkdtemp(join(tmpdir(), 'snipvia-dock-icon-'));
  const root = resolve('.');
  const bootstrap = join(directory, 'bootstrap.cjs');
  await writeFile(bootstrap, `
    const { app, nativeImage } = require('electron');
    app.setAppPath(${JSON.stringify(root)});
    globalThis.dockIconCalls = [];
    const setIcon = app.dock.setIcon.bind(app.dock);
    app.dock.setIcon = (image) => {
      globalThis.dockIconCalls.push({ empty: image.isEmpty(), size: image.getSize(), pixels: image.toDataURL() });
      return setIcon(image);
    };
    const createImage = nativeImage.createFromPath.bind(nativeImage);
    nativeImage.createFromPath = (path) => {
      const image = createImage(path);
      if (path.endsWith('/TrayTemplate.png')) {
        const setTemplate = image.setTemplateImage.bind(image);
        image.setTemplateImage = (enabled) => {
          setTemplate(enabled);
          const bitmap = image.toBitmap({ scaleFactor: 2 });
          let visiblePixels = 0, coloredPixels = 0;
          for (let i = 0; i < bitmap.length; i += 4) {
            if (!bitmap[i + 3]) continue;
            visiblePixels++;
            if (bitmap[i] || bitmap[i + 1] || bitmap[i + 2]) coloredPixels++;
          }
          globalThis.trayIcon = { template: image.isTemplateImage(), size: image.getSize(), scales: image.getScaleFactors(), retinaBytes: bitmap.length,
            visiblePixels, coloredPixels, sparkleAlpha: bitmap[(14 * 36 + 14) * 4 + 3], retinaPixels: bitmap.toString('base64') };
        };
      }
      return image;
    };
    require(${JSON.stringify(join(root, 'out/main/index.js'))});
  `);
  const instance = await electron.launch({ args: [bootstrap, `--user-data-dir=${join(directory, 'data')}`], env: {
    ...process.env, SNIPVIA_CONSOLE_ORIGIN: 'http://127.0.0.1:1', SNIPVIA_CAPTURE_BACKEND: 'electron', SNIPVIA_CAPTURE_WARMUP: '0'
  } });
  type IconCall = { empty: boolean; size: { width: number; height: number }; pixels: string };
  const calls = () => instance.evaluate(() => (globalThis as typeof globalThis & { dockIconCalls: IconCall[] }).dockIconCalls);
  try {
    const page = await instance.firstWindow();
    // Icon assertions can finish before React mounts the editor's flush listener.
    // Wait for the real UI so normal app.close() can use the production save-on-quit path.
    await expect(page.getByRole('button', { name: 'AI 笔记', exact: true })).toBeVisible();
    await expect.poll(async () => (await calls()).length).toBeGreaterThan(0);
    const tray = await instance.evaluate(() => (globalThis as typeof globalThis & { trayIcon: {
      template: boolean; size: { width: number; height: number }; scales: number[]; retinaBytes: number;
      visiblePixels: number; coloredPixels: number; sparkleAlpha: number; retinaPixels: string;
    } }).trayIcon);
    expect(tray).toMatchObject({ template: true, size: { width: 18, height: 18 }, retinaBytes: 36 * 36 * 4, coloredPixels: 0, sparkleAlpha: 0 });
    expect(tray.scales).toEqual(expect.arrayContaining([1, 2]));
    expect(tray.visiblePixels).toBeGreaterThan(200);
    const retinaPixels = await instance.evaluate(({ nativeImage }, path) => nativeImage.createFromPath(path).toBitmap({ scaleFactor: 2 }).toString('base64'), join(root, 'build/TrayTemplate@2x.png'));
    expect(tray.retinaPixels).toBe(retinaPixels);
    const expected = await instance.evaluate(({ nativeImage }, path) => nativeImage.createFromPath(path).toDataURL(), join(root, 'src/renderer/src/assets/snipvia-app-icon.png'));
    const initial = await calls();
    expect(initial.at(-1)).toEqual({ empty: false, size: { width: 256, height: 256 }, pixels: expected });
    await instance.evaluate(({ app, Menu }) => {
      app.dock?.hide();
      const show = Menu.getApplicationMenu()?.items[0].submenu?.items.find(item => item.label === '显示截然');
      if (!show) throw new Error('Main window menu unavailable');
      show.click();
    });
    await expect.poll(async () => (await calls()).length).toBeGreaterThan(initial.length);
    expect((await calls()).at(-1)).toEqual(initial.at(-1));
    expect(await instance.evaluate(({ app }) => app.dock?.isVisible())).toBe(true);
  } finally {
    await instance.close();
    await rm(directory, { recursive: true, force: true });
  }
});
