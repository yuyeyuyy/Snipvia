import { launchMemberDesktop } from '../helpers/desktop-account';
import { expect, test } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('ordinary capture annotates, flattens, copies, saves, pins locally and hands off to AI', async () => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(join(tmpdir(), 'snipvia-editor-'));
  const app = await launchMemberDesktop({ args: ['.', `--user-data-dir=${directory}`], env: { ...process.env, SNIPVIA_CAPTURE_BACKEND: 'electron' } });
  try {
    const page = await app.firstWindow();
    await expect(page.getByRole('button', { name: 'AI 笔记', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect.poll(() => app.windows().some((window) => window.url().endsWith('#capture'))).toBe(true);
    const overlay = app.windows().find((window) => window.url().endsWith('#capture'))!;
    await expect.poll(() => app.windows().some((window) => window.url().endsWith('#pin'))).toBe(true);
    const pinned = app.windows().find((window) => window.url().endsWith('#pin'))!;
    const errors: string[] = [];
    overlay.on('pageerror', (error) => errors.push(error.message));
    const visible = (hash: string) => app.evaluate(({ BrowserWindow }, route) => BrowserWindow.getAllWindows().some((window) => window.webContents.getURL().endsWith(route) && window.isVisible()), hash);
    await app.evaluate(({ desktopCapturer, nativeImage, screen, systemPreferences }) => {
      systemPreferences.getMediaAccessStatus = () => 'granted';
      desktopCapturer.getSources = async (options) => {
        const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()), size = options.thumbnailSize!;
        const bytes = Buffer.alloc(size.width * size.height * 4, 255);
        // Fine alternating lines make mosaic pixel changes measurable.
        for (let y = 0; y < size.height; y++) for (let x = 0; x < size.width; x++) {
          const i = (y * size.width + x) * 4;
          bytes[i] = bytes[i + 1] = bytes[i + 2] = x % 4 < 2 ? 225 : 255;
        }
        return [{ id: 'screen:mock', name: 'Editor fixture', display_id: String(display.id), appIcon: nativeImage.createEmpty(), thumbnail: nativeImage.createFromBuffer(bytes, size) }];
      };
    });
    await page.evaluate(() => window.snipvia.permissions.screen());
    await page.getByRole('button', { name: '模型与设置' }).click();
    await page.getByRole('button', { name: '设置普通截图快捷键' }).click();
    await page.getByRole('button', { name: '设置普通截图快捷键' }).press('ControlOrMeta+Alt+F8');
    await expect(page.locator('.preference-status[role="status"]')).toHaveText('普通截图快捷键已生效');
    const settings = await page.evaluate(() => window.snipvia.settings.get());
    expect(settings.ok && settings.value.editorShortcut).toBe('CommandOrControl+Alt+F8');
    expect(await app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('CommandOrControl+Alt+F8'))).toBe(true);
    await page.screenshot({ path: 'test-results/editor-settings.png' });
    expect((await page.evaluate(async () => {
      const settings = await window.snipvia.settings.get();
      if (!settings.ok) throw new Error(settings.error);
      return window.snipvia.settings.save({ ...settings.value, provider: 'custom', endpoint: 'http://127.0.0.1:9/v1', model: 'editor-offline-test', apiKey: '' });
    })).ok).toBe(true);
    const history = () => page.evaluate(async () => { const result = await window.snipvia.history.list(); if (!result.ok) throw new Error(result.error); return result.value; });
    const start = async () => {
      expect((await page.evaluate(() => window.snipvia.capture.start('standard'))).ok).toBe(true);
      await expect(overlay.locator('.screen-frame')).toBeVisible();
      await overlay.mouse.move(120, 110); await overlay.mouse.down(); await overlay.mouse.move(720, 510); await overlay.mouse.up();
      await expect(overlay.getByRole('toolbar', { name: '截图标注工具栏' })).toBeVisible();
      expect(await visible('#capture')).toBe(true);
    };
    const draw = async (tool: string, from: [number, number], to: [number, number]) => {
      await overlay.getByRole('button', { name: tool, exact: true }).click();
      await overlay.mouse.move(...from); await overlay.mouse.down(); await overlay.mouse.move(...to, { steps: 5 }); await overlay.mouse.up();
    };
    await start();
    expect(await history()).toHaveLength(0);
    expect(await visible('#quick-chat')).toBe(false);
    const session = await overlay.locator('.capture-overlay').getAttribute('data-performance-session');
    expect(session).toBeTruthy();
    const forbidden = await page.evaluate((sessionId) => window.snipvia.capture.editorCrop({ sessionId, selection: { x: 0, y: 0, width: 10, height: 10 } }), session!);
    expect(forbidden.ok).toBe(false);
    const stale = await overlay.evaluate(() => window.snipvia.capture.editorCrop({ sessionId: 'capture_123_stale', selection: { x: 0, y: 0, width: 10, height: 10 } }));
    expect(stale.ok).toBe(false);
    await draw('矩形', [150, 145], [295, 240]);
    await draw('椭圆', [330, 145], [470, 240]);
    await draw('箭头', [170, 280], [285, 330]);
    await draw('铅笔', [340, 270], [470, 330]);
    await overlay.getByRole('button', { name: '文字', exact: true }).click();
    await overlay.mouse.click(170, 365);
    await overlay.getByRole('textbox', { name: '标注文字' }).fill('普通截图');
    await overlay.getByRole('textbox', { name: '标注文字' }).press('Enter');
    await overlay.getByRole('button', { name: '选择与移动', exact: true }).click();
    await overlay.mouse.dblclick(180, 375);
    await expect(overlay.getByRole('textbox', { name: '标注文字' })).toHaveValue('普通截图');
    await overlay.getByRole('textbox', { name: '标注文字' }).fill('截然 · 标注截图');
    await overlay.getByRole('textbox', { name: '标注文字' }).press('Enter');
    await overlay.getByRole('button', { name: '序号', exact: true }).click();
    await overlay.mouse.click(550, 180); await overlay.mouse.click(600, 180); await overlay.mouse.click(650, 180);
    await draw('打码', [540, 260], [670, 330]);
    await overlay.getByRole('button', { name: '撤销', exact: true }).click();
    await expect(overlay.getByRole('button', { name: '重做', exact: true })).toBeEnabled();
    await overlay.getByRole('button', { name: '重做', exact: true }).click();
    await overlay.screenshot({ path: 'test-results/screenshot-editor.png' });
    // Compare actual mosaic output to the untouched full-resolution crop, then use clipboard export.
    const original = await overlay.evaluate(async (sessionId) => {
      const crop = await window.snipvia.capture.editorCrop({ sessionId, selection: { x: 120, y: 110, width: 600, height: 400 } });
      if (!crop.ok) throw new Error(crop.error);
      return { width: crop.value.width, height: crop.value.height, scale: crop.value.scaleX, bytes: Array.from(crop.value.bytes) };
    }, session!);
    await overlay.keyboard.press('Control+C');
    await expect.poll(() => visible('#capture')).toBe(false);
    const flattened = await app.evaluate(async ({ clipboard, nativeImage }, original) => {
      const items = await clipboard.read();
      const mime = items[0].types.find((type) => type.startsWith('image/'))!;
      const blob = await items[0].getType(mime);
      if (!(blob instanceof Blob)) throw new Error('Missing clipboard image');
      const data = await blob.arrayBuffer();
      const decoded = nativeImage.createFromBuffer(Buffer.from(data));
      const before = nativeImage.createFromBuffer(Buffer.from(original.bytes)).toBitmap(), after = decoded.toBitmap();
      const sample = (dipX: number, dipY: number) => (Math.round(dipY * original.scale) * original.width + Math.round(dipX * original.scale)) * 4;
      let mosaicChanges = 0;
      for (let x = 425; x < 540; x += 1) { const i = sample(x, 170); if (before[i] !== after[i]) mosaicChanges++; }
      const border = sample(30, 50);
      return { size: decoded.getSize(), red: after[border + 2], blue: after[border], mosaicChanges };
    }, original);
    expect(flattened.size).toEqual({ width: original.width, height: original.height });
    expect(flattened.red).toBeGreaterThan(flattened.blue + 60);
    expect(flattened.mosaicChanges).toBeGreaterThan(20);
    expect(await history()).toHaveLength(0);

    // Native save dialog cancel and success: do not open dialogs over the user's desktop.
    await start();
    await app.evaluate(({ dialog }) => { dialog.showSaveDialog = async () => ({ canceled: true, filePath: '' }); });
    await overlay.getByRole('button', { name: '保存图片', exact: true }).click();
    await expect(overlay.getByRole('button', { name: '保存图片', exact: true })).toBeEnabled();
    expect(await visible('#capture')).toBe(true);
    const savePath = join(directory, 'edited.png');
    await app.evaluate(({ dialog }, path) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: path }); }, savePath);
    await draw('箭头', [180, 160], [400, 300]);
    await overlay.getByRole('button', { name: '保存图片', exact: true }).click();
    await expect.poll(() => visible('#capture')).toBe(false);
    // The overlay is also hidden while the save dialog/write is in progress.
    // Wait for the saved bytes rather than treating that hide as completion.
    await expect.poll(async () => (await readFile(savePath).catch(() => Buffer.alloc(0))).subarray(0, 8))
      .toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(await history()).toHaveLength(0);

    await start();
    await overlay.getByRole('button', { name: '定住截图', exact: true }).click();
    await expect.poll(() => visible('#pin')).toBe(true);
    await expect(pinned.getByAltText('置顶截图')).toBeVisible();
    await expect(pinned.getByRole('button')).toHaveCount(0);
    expect(await history()).toHaveLength(0);
    const local = await pinned.evaluate(() => window.snipvia.pin.current());
    expect(local.ok && local.value.localOnly).toBe(true);
    expect((await pinned.evaluate(() => window.snipvia.pin.startChat())).ok).toBe(true);
    await expect.poll(async () => (await history()).length).toBe(1);
    await expect.poll(() => app.windows().some((window) => window.url().endsWith('#quick-chat'))).toBe(true);
    await pinned.evaluate(() => window.snipvia.pin.close());
    await start();
    await overlay.getByRole('button', { name: '问 AI', exact: true }).click();
    await expect.poll(() => visible('#capture')).toBe(false);
    await expect.poll(() => visible('#pin')).toBe(true);
    const promoted = await pinned.evaluate(() => window.snipvia.pin.current());
    expect(promoted.ok && promoted.value.localOnly).toBeFalsy();
    expect((await history()).length).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});
