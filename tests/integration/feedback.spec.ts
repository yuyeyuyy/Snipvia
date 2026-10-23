import { expect, test } from '@playwright/test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { launchDesktop } from '../helpers/desktop';

test('global feedback shows the QQ group and preserves settings', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'snipvia-feedback-'));
  const app = await launchDesktop({ args: ['.', '--user-data-dir=' + directory],
    env: { ...process.env, SNIPVIA_CAPTURE_BACKEND: 'electron', SNIPVIA_CAPTURE_WARMUP: '0' } });
  try {
    const page = await app.firstWindow();
    // Exercise the real IPC while keeping the user's system clipboard untouched.
    await app.evaluate(({ clipboard }) => {
      const state = { calls: 0, text: '' };
      (globalThis as typeof globalThis & { feedbackClipboardTest?: typeof state }).feedbackClipboardTest = state;
      clipboard.writeText = async value => {
        if (++state.calls === 1) throw new Error('Synthetic clipboard write failure');
        state.text = value;
      };
    });
    const feedback = page.getByRole('button', { name: '反馈', exact: true });
    const dialog = page.getByRole('dialog', { name: '意见反馈', exact: true });
    await feedback.click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('643251313', { exact: true })).toBeVisible();
    const copy = dialog.getByRole('button', { name: '复制群号', exact: true });
    await expect(copy).toBeFocused();
    await copy.click();
    await expect(dialog.getByRole('alert')).toHaveText('复制失败，请重试或选中群号复制。');
    await copy.click();
    await expect(copy).toHaveText('已复制');
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    expect(await app.evaluate(() => (globalThis as typeof globalThis & {
      feedbackClipboardTest?: { calls: number; text: string }
    }).feedbackClipboardTest)).toEqual({ calls: 2, text: '643251313' });
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
    await expect(page.getByRole('dialog', { name: '快捷导航', exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(feedback).toBeFocused();

    await mkdir('test-results/v2-feedback', { recursive: true });
    for (const theme of ['light', 'dark'] as const) {
      expect((await page.evaluate(theme => window.snipvia.appearance.set(theme), theme)).ok).toBe(true);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await feedback.click();
      await expect(dialog).toBeVisible();
      await expect(copy).toHaveText('复制群号');
      await expect(dialog.getByText('643251313', { exact: true })).toHaveCSS('user-select', 'text');
      await page.screenshot({ path: 'test-results/v2-feedback/' + theme + '.png', animations: 'disabled' });
      await dialog.getByRole('button', { name: '关闭', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible();
    }

    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => !new URL(window.webContents.getURL()).hash)!.setSize(840, 600));
    await feedback.click();
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate(node => {
      const bounds = node.getBoundingClientRect();
      return bounds.left >= 0 && bounds.top >= 0 && bounds.right <= innerWidth && bounds.bottom <= innerHeight;
    })).toBe(true);
    await page.screenshot({ path: 'test-results/v2-feedback/compact.png', animations: 'disabled' });
    await page.mouse.click(5, 100);
    await expect(dialog).toHaveCount(0);
    await expect(feedback).toBeFocused();
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});
