import { _electron as electron, expect, test } from '@playwright/test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { defaults } from '../../src/shared/contracts';
import { launchDesktop } from '../helpers/desktop';

test('chat font persists, synchronizes existing windows and keeps settings typography distinct', async () => {
  test.setTimeout(90_000);
  const directory = await mkdtemp(join(tmpdir(), 'snipvia-chat-controls-'));
  await writeFile(join(directory, 'settings.json'), JSON.stringify({ settings: defaults, appearance: { mode: 'dark' } }));
  await mkdir('docs/ui/chat-controls', { recursive: true });
  const options = { args: ['.', '--user-data-dir=' + directory], env: { ...process.env, SNIPVIA_CAPTURE_BACKEND: 'electron', SNIPVIA_CAPTURE_WARMUP: '0' } };
  const app = await launchDesktop(options); let closed = false;
  try {
    const page = await app.firstWindow();
    await page.getByRole('button', { name: '模型与设置', exact: true }).click();
    await expect(page.getByLabel('AI 对话字号', { exact: true })).toHaveValue('15');
    await page.getByLabel('AI 对话字号', { exact: true }).selectOption('20');
    await expect.poll(() => page.evaluate(() => window.snipvia.appearance.current().chatFontSize)).toBe(20);
    await expect(page.locator('#appearance-settings-title')).toHaveCSS('font-size', '16px');
    const row = page.locator('.preference-row').filter({ has: page.getByLabel('AI 对话字号', { exact: true }) });
    await expect(row.locator('.preference-copy strong')).toHaveCSS('font-size', '13px');
    await expect(row.locator('.preference-copy span')).toHaveCSS('font-size', '12px');
    const pin = app.windows().find(window => window.url().endsWith('#pin'))!;
    expect(await pin.evaluate(() => window.snipvia.appearance.current().chatFontSize)).toBe(20);
    expect((await pin.evaluate(() => window.snipvia.appearance.setChatFontSize(18))).ok).toBe(false);
    expect((await page.evaluate(() => window.snipvia.appearance.setChatFontSize(50))).ok).toBe(false);
    for (const theme of ['light', 'dark'] as const) {
      await page.getByLabel('外观主题').selectOption(theme);
      await page.screenshot({ path: 'docs/ui/chat-controls/settings-' + theme + '.png', animations: 'disabled' });
    }
    await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: 'AI 对话', exact: true }).click();
    await expect(page.getByLabel('AI 对话输入')).toHaveCSS('font-size', '20px');
    const saved = JSON.parse(await readFile(join(directory, 'settings.json'), 'utf8'));
    expect(saved.appearance).toMatchObject({ mode: 'dark', chatFontSize: 20 }); expect(saved.settings).toEqual(defaults);
    await app.close(); closed = true;
    const restarted = await electron.launch(options);
    try {
      const page = await restarted.firstWindow();
      await expect.poll(() => page.evaluate(() => window.snipvia.appearance.current().chatFontSize)).toBe(20);
      await page.getByRole('button', { name: '模型与设置', exact: true }).click();
      await expect(page.getByLabel('AI 对话字号', { exact: true })).toHaveValue('20');
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    } finally { await restarted.close(); }
  } finally { if (!closed) await app.close(); await rm(directory, { recursive: true, force: true }); }
});
