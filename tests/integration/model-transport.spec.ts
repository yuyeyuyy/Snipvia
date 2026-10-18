import { expect, test } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchDesktop } from '../helpers/desktop';
import { expectNeutralChrome } from '../helpers/neutral-chrome';

test('legacy remote HTTP stays readable with a neutral warning; HTTPS and local models stay unchanged', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'snipvia-transport-'));
  const app = await launchDesktop({ args: ['.', `--user-data-dir=${directory}`], env: { ...process.env, SNIPVIA_CAPTURE_BACKEND: 'electron', SNIPVIA_CAPTURE_WARMUP: '0' } });
  try {
    await app.evaluate(() => { globalThis.fetch = async () => { throw new TypeError('No external services in transport UI acceptance'); }; });
    const page = await app.firstWindow();
    const saved = await page.evaluate(async () => {
      const settings = await window.snipvia.settings.get(); if (!settings.ok) throw new Error(settings.error);
      return window.snipvia.settings.save({ ...settings.value, provider: 'custom', endpoint: 'http://192.0.2.10:8080/v1', model: 'synthetic-transport', apiKey: '' });
    });
    expect(saved.ok).toBe(true);
    const stored = await readFile(join(directory, 'settings.json'), 'utf8');
    await page.getByRole('button', { name: '模型与设置', exact: true }).click();
    await expect(page.getByRole('note', { name: '模型传输提示' })).toContainText('未加密 HTTP');
    await expect(page.locator('body')).not.toContainText('分支预测使用后台配置');
    await expect(page.locator('body')).toContainText('分支预测可选 Jev');
    await page.getByRole('button', { name: '配置…', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '配置厂商' });
    await expect(dialog.getByLabel('API 地址', { exact: true })).toHaveValue('http://192.0.2.10:8080/v1');
    await expect(dialog.getByRole('note', { name: '模型传输提示' })).toContainText('API Key、截图和对话');
    await expectNeutralChrome(page);
    await page.screenshot({ path: 'docs/ui/model-transport-http.png', animations: 'disabled' });
    await dialog.getByLabel('API 地址', { exact: true }).fill('https://models.example.invalid/v1');
    await expect(dialog.getByRole('note', { name: '模型传输提示' })).toHaveCount(0);
    await dialog.getByLabel('API 地址', { exact: true }).fill('http://127.0.0.1:11434/v1');
    await expect(dialog.getByRole('note', { name: '模型传输提示' })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: '保存并使用', exact: true })).toBeEnabled();
    expect(await readFile(join(directory, 'settings.json'), 'utf8')).toBe(stored);
    await page.evaluate(() => window.snipvia.appearance.set('dark'));
    await dialog.getByLabel('API 地址', { exact: true }).fill('http://192.0.2.10:8080/v1');
    await expectNeutralChrome(page);
    await page.screenshot({ path: 'docs/ui/model-transport-dark.png', animations: 'disabled' });
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});
