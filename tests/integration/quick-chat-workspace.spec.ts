import { expectNeutralChrome } from '../helpers/neutral-chrome';
import { expect, test } from '@playwright/test';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { launchDesktop } from '../helpers/desktop';

test('floating workspace preserves capture, draft, theme and session across presentation changes', async () => {
  test.setTimeout(90_000);
  const directory = await mkdtemp(join(tmpdir(), 'snipvia-float-'));
  await mkdir('docs/ui/ui2-stage5', { recursive: true });
  const server = createServer((request, response) => {
    request.resume();
    request.on('end', () => { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '## 二分查找\n\n每次缩小一半搜索区间，时间复杂度 **O(log n)**。\n\n```python\nmid = (left + right) // 2\n```' } }] })); });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('mock server');
  const app = await launchDesktop({ args: ['.', `--user-data-dir=${directory}`], env: { ...process.env, SNIPVIA_CAPTURE_BACKEND: 'electron', SNIPVIA_CAPTURE_WARMUP: '0' } });
  try {
    const main = await app.firstWindow();
    await expect.poll(() => app.windows().some(w => w.url().endsWith('#pin'))).toBe(true);
    const pin = app.windows().find(w => w.url().endsWith('#pin'))!;
    const overlay = app.windows().find(w => w.url().endsWith('#capture'))!;
    await app.evaluate(({ desktopCapturer, nativeImage, screen, systemPreferences, clipboard }) => {
      systemPreferences.getMediaAccessStatus = () => 'granted';
      clipboard.write = async () => {};
      desktopCapturer.getSources = async () => {
        const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
        const width = Math.round(display.size.width * display.scaleFactor), height = Math.round(display.size.height * display.scaleFactor);
        const bitmap = Buffer.alloc(width * height * 4, 255);
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
          const offset = (y * width + x) * 4;
          bitmap[offset] = x % 230; bitmap[offset + 1] = y % 210; bitmap[offset + 2] = 110;
        }
        return [{ id: 'screen:fixture', name: 'Synthetic screenshot', display_id: String(display.id), appIcon: nativeImage.createEmpty(), thumbnail: nativeImage.createFromBitmap(bitmap, { width, height }) }];
      };
    });
    const saved = await main.evaluate(async (port) => {
      const settings = await window.snipvia.settings.get(); if (!settings.ok) throw new Error(settings.error);
      return window.snipvia.settings.save({ ...settings.value, provider: 'custom', endpoint: `http://127.0.0.1:${port}/v1`, model: 'workspace-mock', apiKey: '' });
    }, address.port);
    expect(saved.ok).toBe(true);
    // These operations must not be callable from the main or pin renderer.
    expect((await main.evaluate(() => window.snipvia.chat.setExpanded(true))).ok).toBe(false);
    expect((await pin.evaluate(() => window.snipvia.chat.saveImage())).ok).toBe(false);
    expect((await main.evaluate(() => window.snipvia.capture.start())).ok).toBe(true);
    await expect(overlay.locator('.screen-frame')).toBeVisible();
    await overlay.mouse.move(80, 80); await overlay.mouse.down(); await overlay.mouse.move(380, 280); await overlay.mouse.up();
    await expect.poll(() => app.windows().some(w => w.url().endsWith('#quick-chat'))).toBe(true);
    const chat = app.windows().find(w => w.url().endsWith('#quick-chat'))!;
    const errors: string[] = []; chat.on('pageerror', error => errors.push(error.message));
    const input = chat.getByLabel('悬浮对话问题');
    await expect(input).toBeFocused();
    await expect(chat.locator('.quick-chat')).toHaveAttribute('data-mode', 'compact');
    const state = await chat.evaluate(() => window.snipvia.chat.state()); if (!state.ok) throw new Error(state.error);
    const captureId = state.value.capture.id;
    await input.fill('解释这段算法，并帮我整理学习笔记');
    const visible = (hash: string) => app.evaluate(({ BrowserWindow }, hash) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith(hash))?.isVisible(), hash);
    const legacyState = await chat.evaluate(() => window.snipvia.chat.state());
    if (!legacyState.ok) throw new Error(legacyState.error);
    const crossRole = await chat.evaluate(id => window.snipvia.agent.noteDiff({ conversationId: id }, crypto.randomUUID()), legacyState.value.capture.conversationId);
    expect(crossRole).toMatchObject({ ok: false, error: '不允许的窗口请求' });
    for (const theme of ['light', 'dark'] as const) {
      await main.evaluate(theme => window.snipvia.appearance.set(theme), theme);
      await expect(chat.locator('html')).toHaveAttribute('data-theme', theme);
      await expectNeutralChrome(chat);
      await chat.screenshot({ path: `docs/ui/ui2-stage5/compact-${theme}.png`, animations: 'disabled' });
    }
    await chat.getByLabel('展开工作台', { exact: true }).click();
    await expect(chat.locator('.quick-chat')).toHaveAttribute('data-mode', 'expanded');
    await expect.poll(() => visible('#pin')).toBe(false);
    await expect(input).toHaveValue('解释这段算法，并帮我整理学习笔记');
    const separator = chat.getByRole('separator'); await separator.focus(); await separator.press('ArrowRight');
    await expect(separator).toHaveAttribute('aria-valuenow', '44');
    const box = await separator.boundingBox(); if (!box) throw new Error('missing divider');
    await chat.mouse.move(box.x + 3, box.y + 100); await chat.mouse.down(); await chat.mouse.move(box.x + 50, box.y + 100); await chat.mouse.up();
    expect(Number(await separator.getAttribute('aria-valuenow'))).toBeGreaterThan(44);
    await chat.getByLabel('放大截图', { exact: true }).click();
    await expect(chat.getByRole('dialog', { name: '截图放大预览' })).toBeVisible();
    await chat.keyboard.press('Escape');
    await expect(chat.getByRole('dialog')).toHaveCount(0);
    expect(await visible('#quick-chat')).toBe(true);
    await app.evaluate(({ dialog }) => { dialog.showSaveDialog = async () => ({ canceled: true, filePath: '' }); });
    await chat.getByRole('button', { name: '保存图片', exact: true }).click();
    await expect(chat.getByRole('button', { name: '保存图片', exact: true })).toBeEnabled();
    await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }); }, join(directory, 'capture.jpg'));
    await chat.getByRole('button', { name: '保存图片', exact: true }).click();
    await expect(chat.getByRole('button', { name: '已保存', exact: true })).toBeVisible();
    expect((await readFile(join(directory, 'capture.jpg'))).subarray(0, 2).toString('hex')).toBe('ffd8');
    await input.press('Enter');
    await expect(chat.locator('.quick-chat-messages')).toContainText('每次缩小一半搜索区间');
    for (const theme of ['light', 'dark'] as const) {
      await main.evaluate(theme => window.snipvia.appearance.set(theme), theme);
      await expect(chat.locator('html')).toHaveAttribute('data-theme', theme);
      await expectNeutralChrome(chat);
      await chat.screenshot({ path: `docs/ui/ui2-stage5/expanded-${theme}.png`, animations: 'disabled' });
    }
    const after = await chat.evaluate(() => window.snipvia.chat.state());
    expect(after.ok && after.value.capture.id).toBe(captureId);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('#quick-chat'))!.setSize(340, 360));
    expect(await chat.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expectNeutralChrome(chat);
    await chat.screenshot({ path: 'docs/ui/ui2-stage5/narrow-dark.png', animations: 'disabled' });
    await chat.getByLabel('收起工作台', { exact: true }).click();
    await expect.poll(() => visible('#pin')).toBe(true);
    await expect(input).toBeFocused();
    await chat.getByLabel('展开工作台', { exact: true }).click();
    await chat.getByLabel('关闭截图对话', { exact: true }).click();
    await expect.poll(() => app.windows().some(w => w.url().endsWith('#quick-chat'))).toBe(false);
    await expect.poll(() => visible('#pin')).toBe(false);
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => !w.webContents.getURL().includes('#'))!.isVisible())).toBe(false);
    await expect(pin.getByAltText('置顶截图')).toHaveCount(0);
    // A fresh session must begin compact and hand its real conversation back to main.
    expect((await main.evaluate(() => window.snipvia.capture.start())).ok).toBe(true);
    await expect(overlay.locator('.screen-frame')).toBeVisible();
    await overlay.mouse.move(80, 80); await overlay.mouse.down(); await overlay.mouse.move(380, 280); await overlay.mouse.up();
    await expect.poll(() => app.windows().some(w => w.url().endsWith('#quick-chat'))).toBe(true);
    const next = app.windows().find(w => w.url().endsWith('#quick-chat'))!;
    await expect(next.locator('.quick-chat')).toHaveAttribute('data-mode', 'compact');
    await next.getByLabel('悬浮对话问题').press(process.platform === 'darwin' ? 'Meta+Shift+e' : 'Control+Shift+e');
    await expect(next.locator('.quick-chat')).toHaveAttribute('data-mode', 'expanded');
    await next.getByLabel('返回软件', { exact: true }).click();
    await expect(main.getByLabel('AI 对话输入')).toBeFocused();
    const history = await main.evaluate(() => window.snipvia.history.list());
    expect(history.ok && history.value.length).toBeGreaterThanOrEqual(1);
    expect(errors).toEqual([]);
  } finally {
    await app.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
