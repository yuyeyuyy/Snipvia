import { _electron as electron, expect, test } from '@playwright/test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import tokens from '../../src/shared/design-tokens.json';
import { defaults } from '../../src/shared/contracts';
import { launchMemberDesktop } from '../helpers/desktop-account';

test('appearance synchronizes windows, preserves editor identity, follows system and survives restart', async () => {
  test.setTimeout(90_000);
  const directory = await mkdtemp(join(tmpdir(), 'snipvia-appearance-'));
  const storage = join(directory, 'app'); const location = join(directory, 'books'); await mkdir(location);
  await mkdir('docs/ui/ui2-monochrome', { recursive: true });
  const options = { args: ['.', `--user-data-dir=${storage}`], env: { ...process.env, SNIPVIA_CAPTURE_BACKEND: 'electron', SNIPVIA_CAPTURE_WARMUP: '0' } };
  const app = await launchMemberDesktop(options);
  let closed = false;
  try {
    const page = await app.firstWindow(); const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await expect.poll(() => page.evaluate(() => window.snipvia.appearance.current().mode)).toBe('system');
    const systemDark = await app.evaluate(({ nativeTheme }) => nativeTheme.shouldUseDarkColors);
    await expect(page.locator('html')).toHaveAttribute('data-theme', systemDark ? 'dark' : 'light');
    await app.evaluate(({ dialog }, location) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [location] }); }, location);
    await page.getByRole('button', { name: '创建笔记', exact: true }).click();
    await page.getByLabel('笔记本名称', { exact: true }).fill('主题验证');
    await page.getByRole('button', { name: '创建', exact: true }).click();
    await page.getByRole('button', { name: '新建笔记', exact: true }).click();
    await page.getByLabel('名称', { exact: true }).fill('外观测试');
    await page.getByRole('button', { name: '创建', exact: true }).click();
    const editor = page.getByRole('textbox', { name: '笔记编辑器', exact: true });
    const content = '# 主题验证\n\n切换主题时保留内容。\n\n```python\n# 注释\ndef add(a, b):\n    return a + b\n```';
    await editor.fill(content);
    await expect.poll(() => readFile(join(location, '主题验证', '外观测试.md'), 'utf8')).toBe(content);
    await page.evaluate(() => { (window as typeof window & { editorFixture?: Element | null }).editorFixture = document.querySelector('.cm-editor'); });
    await page.getByRole('button', { name: '模型与设置' }).click();
    await page.evaluate(() => { (window as typeof window & { settingsFixture?: Element | null }).settingsFixture = document.querySelector('.settings-preferences'); });
    await page.getByLabel('外观主题').selectOption('light');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.screenshot({ animations: 'disabled', path: 'docs/ui/ui2-monochrome/settings-light.png' });
    await expect.poll(() => app.windows().some((window) => window.url().endsWith('#pin'))).toBe(true);
    const pinned = app.windows().find((window) => window.url().endsWith('#pin'))!;
    const overlay = app.windows().find((window) => window.url().endsWith('#capture'))!;
    for (const window of [pinned, overlay]) await expect(window.locator('html')).toHaveAttribute('data-theme', 'light');
    const denied = await pinned.evaluate(() => window.snipvia.appearance.set('dark')); expect(denied.ok).toBe(false);
    await page.getByLabel('外观主题').selectOption('dark');
    for (const window of [page, pinned, overlay]) await expect(window.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.screenshot({ animations: 'disabled', path: 'docs/ui/ui2-monochrome/settings-dark.png' });
    expect(await pinned.locator('html').evaluate((element) => getComputedStyle(element).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
    expect(await overlay.locator('html').evaluate((element) => getComputedStyle(element).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
    const backgrounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((window) => ({ hash: new URL(window.webContents.getURL()).hash, color: window.getBackgroundColor() })));
    expect(backgrounds.find((window) => !window.hash)?.color.toLowerCase()).toBe(tokens.dark['bg-window'].toLowerCase());
    expect(backgrounds.filter((window) => ['#capture', '#pin'].includes(window.hash)).every((window) => /^#0{6}(?:00)?$/i.test(window.color))).toBe(true);
    await page.getByRole('button', { name: 'AI 笔记', exact: true }).click();
    expect(await page.evaluate(() => (window as typeof window & { editorFixture?: Element | null }).editorFixture === document.querySelector('.cm-editor'))).toBe(true);
    await expect(editor).toContainText('切换主题时保留内容');
    await page.screenshot({ animations: 'disabled', path: 'docs/ui/ui2-monochrome/notes-dark.png' });
    await page.evaluate(() => window.snipvia.appearance.set('light'));
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.screenshot({ animations: 'disabled', path: 'docs/ui/ui2-monochrome/notes-light.png' });
    for (const label of ['截图日程', '历史对话']) {
      await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: label, exact: true }).click();
      await expect(page.getByRole('heading', { name: label, exact: true })).toBeVisible();
    }
    await page.getByRole('button', { name: '快捷导航' }).click();
    await expect(page.getByRole('dialog', { name: '快捷导航' })).toBeVisible();
    await page.getByLabel('搜索页面与操作').fill('设置'); await page.keyboard.press('Enter');
    await expect(page.getByLabel('外观主题')).toBeVisible();
    expect(await page.evaluate(() => (window as typeof window & { settingsFixture?: Element | null }).settingsFixture === document.querySelector('.settings-preferences'))).toBe(true);
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
    await expect(page.getByRole('dialog', { name: '快捷导航' })).toBeVisible();
    await page.keyboard.press('Escape'); await expect(page.getByRole('dialog', { name: '快捷导航' })).toHaveCount(0);
    await page.getByLabel('外观主题').selectOption('system');
    await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'dark'; nativeTheme.emit('updated'); });
    for (const window of [page, pinned, overlay]) await expect(window.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.getByLabel('外观主题')).toHaveValue('system');
    await page.getByLabel('外观主题').selectOption('light');
    await app.evaluate(({ nativeTheme }) => nativeTheme.emit('updated'));
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.getByLabel('外观主题').selectOption('dark');
    for (const size of [[840, 600], [1600, 1000]]) {
      await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows().find((window) => !new URL(window.webContents.getURL()).hash)!.setSize(size[0], size[1]), size);
      await expect.poll(() => page.evaluate(() => innerWidth)).toBe(size[0]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.querySelector('main')!.scrollWidth <= document.querySelector('main')!.clientWidth)).toBe(true);
    }
    const originalSettings = JSON.parse(await readFile(join(storage, 'settings.json'), 'utf8'));
    expect(originalSettings.appearance.mode).toBe('dark'); expect(originalSettings.settings).toMatchObject({ provider: defaults.provider, model: defaults.model });
    expect(errors).toEqual([]);
    await app.close(); closed = true;
    const restarted = await electron.launch({ ...options, env: { ...options.env, SNIPVIA_CONSOLE_ORIGIN: 'http://127.0.0.1:1' } });
    try {
      const first = await restarted.firstWindow(); await expect(first.locator('html')).toHaveAttribute('data-theme', 'dark');
      expect(await first.evaluate(() => window.snipvia.appearance.current().mode)).toBe('dark');
      await first.getByRole('button', { name: '模型与设置' }).click(); await expect(first.getByLabel('外观主题')).toHaveValue('dark');
    } finally { await restarted.close(); }
  } finally { if (!closed) await app.close(); await rm(directory, { recursive: true, force: true }); }
});

test('saved Dark applies to a newly created QuickChat window without changing screenshot close behavior', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'snipvia-theme-chat-'));
  await writeFile(join(directory, 'settings.json'), JSON.stringify({ settings: defaults, appearance: { mode: 'dark' } }));
  const app = await launchMemberDesktop({ args: ['.', `--user-data-dir=${directory}`], env: { ...process.env, SNIPVIA_CAPTURE_BACKEND: 'electron', SNIPVIA_CAPTURE_WARMUP: '0' } });
  try {
    const page = await app.firstWindow(); await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await app.evaluate(({ desktopCapturer, nativeImage, screen, systemPreferences }) => {
      systemPreferences.getMediaAccessStatus = () => 'granted';
      desktopCapturer.getSources = async (options) => {
        const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()), size = options.thumbnailSize!;
        return [{ id: 'screen:synthetic', name: 'Synthetic screen', display_id: String(display.id), appIcon: nativeImage.createEmpty(), thumbnail: nativeImage.createFromBuffer(Buffer.alloc(size.width * size.height * 4, 255), size) }];
      };
    });
    expect((await page.evaluate(() => window.snipvia.capture.start())).ok).toBe(true);
    const overlay = app.windows().find((window) => window.url().endsWith('#capture'))!;
    await expect(overlay.locator('.screen-frame')).toBeVisible();
    await overlay.mouse.move(100, 100); await overlay.mouse.down(); await overlay.mouse.move(250, 200); await overlay.mouse.up();
    await expect.poll(() => app.windows().some((window) => window.url().endsWith('#quick-chat'))).toBe(true);
    const chat = app.windows().find((window) => window.url().endsWith('#quick-chat'))!;
    await expect(chat.locator('html')).toHaveAttribute('data-theme', 'dark');
    await chat.screenshot({ animations: 'disabled', path: 'docs/ui/ui2-monochrome/quick-chat-dark.png' });
    expect(await chat.locator('html').evaluate((element) => getComputedStyle(element).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
    await page.evaluate(() => window.snipvia.appearance.set('light'));
    await expect(chat.locator('html')).toHaveAttribute('data-theme', 'light');
    await chat.screenshot({ animations: 'disabled', path: 'docs/ui/ui2-monochrome/quick-chat-light.png' });
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});
