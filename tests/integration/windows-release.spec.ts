import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const releaseVersion: string = JSON.parse(readFileSync('package.json', 'utf8')).version;

test('installed Windows app loads its icon, encrypts credentials, edits notes and closes capture quietly', async () => {
  test.skip(process.platform !== 'win32' || !process.env.SNIPVIA_TEST_APP_BINARY, 'Requires an installed Windows release in a temporary CI directory');
  test.setTimeout(90_000);
  const directory = await mkdtemp(join(tmpdir(), 'snipvia-win-release-'));
  const app = await electron.launch({ executablePath: process.env.SNIPVIA_TEST_APP_BINARY, args: [`--user-data-dir=${directory}`],
    env: { ...process.env, SNIPVIA_CAPTURE_BACKEND: 'electron', SNIPVIA_CAPTURE_WARMUP: '0' } });
  try {
    const page = await app.firstWindow();
    await expect(page.getByRole('button', { name: 'AI 笔记', exact: true })).toHaveAttribute('aria-current', 'page');
    const status = await app.evaluate(({ app, nativeImage, safeStorage, globalShortcut }) => {
      // Main-only inspection of the temporary installed app, outside Renderer IPC.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const path = require('node:path') as typeof import('node:path');
      const icon = nativeImage.createFromPath(path.join(process.resourcesPath, 'Snipvia.ico'));
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const main = require(path.join(app.getAppPath(), 'out/main/index.js'));
      if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows DPAPI unavailable');
      const ciphertext = safeStorage.encryptString('synthetic-release-credential');
      return { packaged: app.isPackaged, version: app.getVersion(), architecture: process.arch, userData: app.getPath('userData'), iconEmpty: icon.isEmpty(),
        decrypted: safeStorage.decryptString(ciphertext), ciphertextIsPlain: ciphertext.includes(Buffer.from('synthetic-release-credential')),
        commands: main.agentFileTools.registry.descriptors().map((tool: { name: string }) => tool.name),
        shortcut: globalShortcut.isRegistered('CommandOrControl+Shift+A') };
    });
    expect(status).toMatchObject({ packaged: true, version: releaseVersion, architecture: 'x64', iconEmpty: false,
      decrypted: 'synthetic-release-credential', ciphertextIsPlain: false, shortcut: true });
    expect(status.commands).not.toContain('run_command'); expect(status.commands).not.toContain('run_script');
    expect(status.userData.toLowerCase()).toBe(directory.toLowerCase());
    await app.evaluate(({ dialog }, directory) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] });
      // This temporary test never calls the production account or model servers.
      globalThis.fetch = async () => { throw new Error('Release validation blocks network'); };
    }, directory);
    await page.getByRole('button', { name: '创建笔记', exact: true }).click();
    await page.getByLabel('笔记本名称').fill('Windows 验收');
    await page.getByRole('button', { name: '创建', exact: true }).click();
    await page.getByRole('button', { name: '新建笔记', exact: true }).click();
    await page.getByRole('textbox', { name: '名称', exact: true }).fill('验证');
    await page.getByRole('button', { name: '创建', exact: true }).click();
    await page.getByRole('textbox', { name: '笔记编辑器', exact: true }).fill('# Windows 验证\n\n中文路径与自动保存。\n');
    await expect.poll(() => readFile(join(directory, 'Windows 验收', '验证.md'), 'utf8')).toContain('中文路径与自动保存');
    await app.evaluate(({ desktopCapturer, nativeImage, screen }) => {
      desktopCapturer.getSources = async options => {
        const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()), size = options.thumbnailSize!;
        return [{ id: 'screen:synthetic', name: 'Synthetic screen', display_id: String(display.id), appIcon: nativeImage.createEmpty(),
          thumbnail: nativeImage.createFromBuffer(Buffer.alloc(size.width * size.height * 4, 255), size) }];
      };
    });
    expect((await page.evaluate(() => window.snipvia.capture.start('standard'))).ok).toBe(true);
    await expect.poll(() => app.windows().some(window => window.url().endsWith('#capture'))).toBe(true);
    const overlay = app.windows().find(window => window.url().endsWith('#capture'))!;
    await expect(overlay.locator('.screen-frame')).toBeVisible();
    await overlay.keyboard.press('Escape');
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every(window => !window.isVisible()))).toBe(true);
    expect((await page.evaluate(() => window.snipvia.capture.start('standard'))).ok).toBe(true);
    await expect(overlay.locator('.screen-frame')).toBeVisible();
    await overlay.keyboard.press('Enter');
    await expect(overlay.getByRole('button', { name: '复制并关闭', exact: true })).toBeVisible();
    await overlay.getByRole('button', { name: '复制并关闭', exact: true }).click();
    const fullScreen = await app.evaluate(async ({ clipboard, screen }) => {
      const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
      const items = await clipboard.read();
      const item = items.find(item => item.types.includes('image/png'));
      if (!item) throw new Error('Full-screen clipboard PNG missing');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { nativeImage } = require('electron') as typeof import('electron');
      const png = await item.getType('image/png');
      if (!('arrayBuffer' in png)) throw new Error('Invalid clipboard image');
      const image = nativeImage.createFromBuffer(Buffer.from(await png.arrayBuffer()));
      return { actual: image.getSize(), expected: { width: Math.round(display.size.width * display.scaleFactor), height: Math.round(display.size.height * display.scaleFactor) } };
    });
    expect(fullScreen.actual).toEqual(fullScreen.expected);
    expect((await page.evaluate(() => window.snipvia.capture.start('standard'))).ok).toBe(true);
    await expect(overlay.locator('.screen-frame')).toBeVisible();
    await overlay.mouse.move(100, 100); await overlay.mouse.down(); await overlay.mouse.move(400, 300); await overlay.mouse.up();
    await overlay.getByRole('button', { name: '复制并关闭', exact: true }).click();
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every(window => !window.isVisible()))).toBe(true);
    expect(await app.evaluate(async ({ clipboard }) => (await clipboard.read()).some(item => item.types.some(type => type.startsWith('image/'))))).toBe(true);
    await app.evaluate(({ Menu }) => {
      const item = Menu.getApplicationMenu()?.items[0].submenu?.items.find(item => item.label === '显示截然');
      if (!item) throw new Error('Show application menu missing'); item.click();
    });
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(window => !window.webContents.getURL().includes('#') && window.isVisible()))).toBe(true);
    await app.evaluate(({ desktopCapturer }) => { desktopCapturer.getSources = async () => []; });
    const failed = await page.evaluate(() => window.snipvia.capture.start('standard'));
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.error).toContain('没有返回屏幕源');
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(window => !window.webContents.getURL().includes('#') && window.isVisible()))).toBe(true);
  } finally { await app.close(); await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
});
