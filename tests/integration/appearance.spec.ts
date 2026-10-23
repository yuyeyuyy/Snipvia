import { _electron as electron, expect, test } from '@playwright/test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import tokens from '../../src/shared/design-tokens.json';
import { defaults } from '../../src/shared/contracts';
import { launchDesktop } from '../helpers/desktop';

test('appearance synchronizes windows, preserves settings identity and old Markdown, follows system and survives restart', async () => {
  test.setTimeout(90_000);
  const directory = await mkdtemp(join(tmpdir(), 'snipvia-appearance-'));
  const storage = join(directory, 'app'); const location = join(directory, 'books'); await mkdir(location);
  await mkdir('test-results/v2-appearance', { recursive: true });
  const options = { args: ['.', `--user-data-dir=${storage}`], env: { ...process.env, SNIPVIA_CAPTURE_BACKEND: 'electron', SNIPVIA_CAPTURE_WARMUP: '0' } };
  const app = await launchDesktop(options);
  let closed = false;
  try {
    const page = await app.firstWindow(); const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await expect.poll(() => page.evaluate(() => window.snipvia.appearance.current().mode)).toBe('system');
    const systemDark = await app.evaluate(({ nativeTheme }) => nativeTheme.shouldUseDarkColors);
    await expect(page.locator('html')).toHaveAttribute('data-theme', systemDark ? 'dark' : 'light');
    const content = '# 旧版笔记\n\n切换主题仍保留原文件。';
    await writeFile(join(location, 'preserved.md'), content);
    await page.evaluate(() => { (window as typeof window & { settingsFixture?: Element | null }).settingsFixture = document.querySelector('.v2-preferences'); });
    await page.getByLabel('外观主题').selectOption('light');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.screenshot({ animations: 'disabled', path: 'test-results/v2-appearance/settings-light.png' });
    await expect.poll(() => app.windows().some((window) => window.url().endsWith('#pin'))).toBe(true);
    const pinned = app.windows().find((window) => window.url().endsWith('#pin'))!;
    const overlay = app.windows().find((window) => window.url().endsWith('#capture'))!;
    for (const window of [pinned, overlay]) await expect(window.locator('html')).toHaveAttribute('data-theme', 'light');
    const denied = await pinned.evaluate(() => window.snipvia.appearance.set('dark')); expect(denied.ok).toBe(false);
    await page.getByLabel('外观主题').selectOption('dark');
    for (const window of [page, pinned, overlay]) await expect(window.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.screenshot({ animations: 'disabled', path: 'test-results/v2-appearance/settings-dark.png' });
    expect(await pinned.locator('html').evaluate((element) => getComputedStyle(element).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
    expect(await overlay.locator('html').evaluate((element) => getComputedStyle(element).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
    const backgrounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((window) => ({ hash: new URL(window.webContents.getURL()).hash, color: window.getBackgroundColor() })));
    expect(backgrounds.find((window) => !window.hash)?.color.toLowerCase()).toBe(tokens.dark['bg-window'].toLowerCase());
    expect(backgrounds.filter((window) => ['#capture', '#pin'].includes(window.hash)).every((window) => /^#0{6}(?:00)?$/i.test(window.color))).toBe(true);
    expect(await readFile(join(location, 'preserved.md'), 'utf8')).toBe(content);
    expect(await page.evaluate(() => (window as typeof window & { settingsFixture?: Element | null }).settingsFixture === document.querySelector('.v2-preferences'))).toBe(true);
    await expect(page.getByRole('button', { name: 'AI 对话', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'AI 笔记', exact: true })).toHaveCount(0);
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
      await expect(first.getByLabel('外观主题')).toHaveValue('dark');
    } finally { await restarted.close(); }
  } finally { if (!closed) await app.close(); await rm(directory, { recursive: true, force: true }); }
});

test('saved Dark applies to the reused local pin window without changing screenshot close behavior', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'snipvia-theme-chat-'));
  await writeFile(join(directory, 'settings.json'), JSON.stringify({ settings: defaults, appearance: { mode: 'dark' } }));
  const app = await launchDesktop({ args: ['.', `--user-data-dir=${directory}`], env: { ...process.env, SNIPVIA_CAPTURE_BACKEND: 'electron', SNIPVIA_CAPTURE_WARMUP: '0' } });
  try {
    const page = await app.firstWindow(); await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await app.evaluate(({ desktopCapturer, nativeImage, screen, systemPreferences, clipboard }) => {
      clipboard.write = async () => {};
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
    const chat = app.windows().find(window => window.url().endsWith('#pin'))!;
    await expect(chat.getByAltText('置顶截图')).toBeVisible();
    expect(app.windows().some(window => window.url().endsWith('#quick-chat'))).toBe(false);
    await expect(chat.locator('html')).toHaveAttribute('data-theme', 'dark');
    await chat.screenshot({ animations: 'disabled', path: 'test-results/v2-appearance/quick-chat-dark.png' });
    expect(await chat.locator('html').evaluate((element) => getComputedStyle(element).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
    await page.evaluate(() => window.snipvia.appearance.set('light'));
    await expect(chat.locator('html')).toHaveAttribute('data-theme', 'light');
    await chat.screenshot({ animations: 'disabled', path: 'test-results/v2-appearance/quick-chat-light.png' });
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});
