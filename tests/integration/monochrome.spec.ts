import { expect, test } from '@playwright/test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchMemberDesktop } from '../helpers/desktop-account';
import { tokenColor } from '../helpers/appearance';

import { expectNeutralChrome } from '../helpers/neutral-chrome';

test('Monochrome common controls, menus, dialogs and navigation retain legible interaction states', async () => {
  test.setTimeout(90_000);
  const directory = await mkdtemp(join(tmpdir(), 'snipvia-monochrome-'));
  const output = 'docs/ui/ui2-monochrome'; await mkdir(output, { recursive: true });
  const app = await launchMemberDesktop({ args: ['.', `--user-data-dir=${directory}`], env: { ...process.env, SNIPVIA_CAPTURE_BACKEND: 'electron', SNIPVIA_CAPTURE_WARMUP: '0' } });
  try {
    const page = await app.firstWindow();
    for (const mode of ['light', 'dark'] as const) {
      await page.getByRole('button', { name: '模型与设置' }).click();
      await page.getByLabel('外观主题').selectOption(mode);
      await expect(page.locator('html')).toHaveAttribute('data-theme', mode);
      await expectNeutralChrome(page);
      await expect(page.locator('.titlebar-brand img')).toHaveCount(0);
      await expect(page.locator('.brand-icon svg')).toBeVisible();
      const toggle = page.locator('.config-checkbox input:checked + span').first();
      await expect(toggle).toHaveCSS('background-color', await tokenColor(toggle, 'accent'));
      const thumb = await toggle.evaluate(element => getComputedStyle(element, '::after').backgroundColor);
      expect(thumb).toBe(await tokenColor(toggle, 'control-thumb-active'));

      await page.getByRole('button', { name: '配置…', exact: true }).click();
      const config = page.getByRole('dialog', { name: '配置厂商' }); await expect(config).toBeVisible();
      const input = page.getByLabel('API Key', { exact: true });
      await input.focus(); await expect(input).toHaveCSS('outline-color', await tokenColor(input, 'focus'));
      await expect(input).toHaveCSS('outline-style', 'solid');
      const save = config.getByRole('button', { name: '保存并使用' });
      await expect(save).toHaveCSS('background-color', await tokenColor(save, 'accent'));
      await expect(save).toHaveCSS('color', await tokenColor(save, 'text-on-accent'));
      // Native Electron hover depends on the foreground window, especially after another app closes.
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => !window.webContents.getURL().includes('#'))?.focus());
      await save.hover(); await expect(save).toHaveCSS('background-color', await tokenColor(save, 'accent-hover'));
      const warning = config.locator('.notice');
      await expect(warning).toContainText('API Key');
      expect(await warning.evaluate(element => getComputedStyle(element, '::before').content)).toContain('!');
      await expectNeutralChrome(page);
      await page.screenshot({ animations: 'disabled', path: `${output}/model-dialog-${mode}.png` });
      await config.getByRole('button', { name: '取消', exact: true }).click();

      // The existing controlled switch updates after IPC persistence, not on click's next frame.
      await page.getByRole('checkbox', { name: '关闭解释错误', exact: true }).press('Space');
      await expect(page.getByRole('checkbox', { name: '开启解释错误', exact: true })).not.toBeChecked();
      const success = page.locator('.preference-status.success'); await expect(success).toHaveText('预测分支已关闭');
      expect(await success.evaluate(element => getComputedStyle(element, '::before').content)).toContain('✓');
      await page.getByRole('checkbox', { name: '开启解释错误', exact: true }).press('Space');
      await expect(page.getByRole('checkbox', { name: '关闭解释错误', exact: true })).toBeChecked();

      await page.getByRole('button', { name: '快捷导航', exact: true }).click();
      const commands = page.getByRole('dialog', { name: '快捷导航' }); await expect(commands).toBeVisible();
      await expect(commands.locator('button.selected')).toHaveCSS('background-color', await tokenColor(commands, 'bg-selected'));
      await expectNeutralChrome(page);
      await page.screenshot({ animations: 'disabled', path: `${output}/command-palette-${mode}.png` });
      await page.keyboard.press('Escape');
      await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '截图日程', exact: true }).click();
      await expect(page.locator('.sidebar .nav.active')).toHaveCSS('background-color', await tokenColor(page.locator('.sidebar'), 'bg-selected'));
      await expectNeutralChrome(page);
      await page.screenshot({ animations: 'disabled', path: `${output}/schedule-${mode}.png` });
      await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '历史对话', exact: true }).click();
      await expectNeutralChrome(page);
      await page.screenshot({ animations: 'disabled', path: `${output}/history-${mode}.png` });
    }
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});
