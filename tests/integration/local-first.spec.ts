import { expect, test } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { launchDesktop } from '../helpers/desktop';

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'snipvia-local-first-'));
  const legacy = '{"version":1,"encryptedSession":"synthetic-obsolete-cookie-do-not-decrypt"}';
  await mkdir(join(directory, 'account')); await writeFile(join(directory, 'account/session.json'), legacy);
  let accountRequests = 0;
  const tripwire = createServer((_request, response) => { accountRequests++; response.writeHead(503); response.end('{}'); });
  await new Promise<void>(resolve => tripwire.listen(0, '127.0.0.1', resolve));
  const address = tripwire.address(); if (!address || typeof address === 'string') throw new Error('Missing local tripwire');
  const app = await launchDesktop({ args: ['.', `--user-data-dir=${directory}`], env: { ...process.env, SNIPVIA_CONSOLE_ORIGIN: `http://127.0.0.1:${address.port}`, MAIN_VITE_CONSOLE_ORIGIN: `http://127.0.0.1:${address.port}`, SNIPVIA_CAPTURE_BACKEND: 'electron', SNIPVIA_CAPTURE_WARMUP: '0' } });
  const page = await app.firstWindow();
  await app.evaluate(({ desktopCapturer, nativeImage, screen, systemPreferences }) => {
    systemPreferences.getMediaAccessStatus = () => 'granted';
    desktopCapturer.getSources = async options => { const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()), size = options.thumbnailSize!;
      return [{ id: 'screen:synthetic', name: 'Synthetic', display_id: String(display.id), appIcon: nativeImage.createEmpty(), thumbnail: nativeImage.createFromBuffer(Buffer.alloc(size.width * size.height * 4, 255), size) }]; };
  });
  const overlay = app.windows().find(window => window.url().endsWith('#capture'))!;
  async function select(mode: 'ai' | 'standard' = 'ai') {
    expect((await page.evaluate(mode => window.snipvia.capture.start(mode), mode)).ok).toBe(true);
    await expect(overlay.locator('.screen-frame')).toBeVisible();
    await overlay.mouse.move(100, 100); await overlay.mouse.down(); await overlay.mouse.move(400, 300); await overlay.mouse.up();
  }
  return { app, page, overlay, select, async verifyLegacy() { expect(await readFile(join(directory, 'account/session.json'), 'utf8')).toBe(legacy); expect(accountRequests).toBe(0); }, async close() { await app.close(); await new Promise<void>(resolve => tripwire.close(() => resolve())); await rm(directory, { recursive: true, force: true }); } };
}

test('clean local client ignores legacy credentials and has no account UI, bridge or IPC', async () => {
  const f = await fixture();
  try {
    await expect(f.page.getByRole('button', { name: '账号与登录' })).toHaveCount(0);
    expect(await f.page.evaluate(() => 'account' in window.snipvia)).toBe(false);
    await f.page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: 'AI 对话', exact: true }).click();
    await expect(f.page.locator('.ai-workspace')).toBeVisible();
    await f.page.screenshot({ path: 'docs/ui/local-first-phase1.png', animations: 'disabled' });
    const legacyIpc = await f.app.evaluate(async ({ BrowserWindow }) => {
      const main = BrowserWindow.getAllWindows().find(window => !window.webContents.getURL().includes('#'))!;
      return main.webContents.executeJavaScript("window.snipvia.account === undefined");
    });
    expect(legacyIpc).toBe(true);
    expect(await f.app.evaluate(({ ipcMain }) => ['account:get', 'account:send-code', 'account:sign-in', 'account:sign-out'].some(channel => (ipcMain as typeof ipcMain & { _invokeHandlers: Map<string, unknown> })._invokeHandlers.has(channel)))).toBe(false);
    await f.select();
    await expect.poll(() => f.app.windows().some(window => window.url().endsWith('#quick-chat'))).toBe(true);
    const quick = f.app.windows().find(window => window.url().endsWith('#quick-chat'))!;
    await quick.getByLabel('悬浮对话问题').press('Enter');
    await expect(quick.getByRole('alert')).toContainText('模型与设置');
    await expect(quick.locator('body')).not.toContainText('联系管理员');
    await f.verifyLegacy();
  } finally { await f.close(); }
});

test('standard local capture keeps editing and pin-to-chat without a login or model', async () => {
  const f = await fixture();
  try {
    await f.select('standard');
    await expect(f.overlay.getByRole('toolbar', { name: '截图标注工具栏' })).toBeVisible();
    await f.overlay.getByRole('button', { name: '定住截图', exact: true }).click();
    const pin = f.app.windows().find(window => window.url().endsWith('#pin'))!;
    await expect(pin.getByAltText('置顶截图')).toBeVisible();
    expect((await pin.evaluate(() => window.snipvia.pin.startChat())).ok).toBe(true);
    await expect.poll(() => f.app.windows().some(window => window.url().endsWith('#quick-chat'))).toBe(true);
    await f.verifyLegacy();
  } finally { await f.close(); }
});
