import { _electron as electron, expect, test } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('failed user model prediction is visible, retry remains explicit, and manual chat is still usable', async () => {
  let attempts = 0;
  const directory = await mkdtemp(join(tmpdir(), 'snipvia-prediction-errors-'));
  const model = createServer((request, response) => {
    let body = ''; request.on('data', chunk => { body += String(chunk); }); request.on('end', () => {
      response.setHeader('Content-Type', 'application/json');
      if (body.includes('You are a screenshot classifier')) { response.writeHead(++attempts === 1 ? 401 : 403); response.end('PRIVATE_UPSTREAM_KEY_AND_IMAGE'); }
      else response.end(JSON.stringify({ choices: [{ message: { content: '预测失败后仍可以手动提问。' }, finish_reason: 'stop' }] }));
    });
  });
  await new Promise<void>(resolve => model.listen(0, '127.0.0.1', resolve)); const address = model.address(); if (!address || typeof address === 'string') throw new Error('model fixture missing');
  const app = await electron.launch({ args: ['.', `--user-data-dir=${directory}`], env: { ...process.env, SNIPVIA_CAPTURE_BACKEND: 'electron', SNIPVIA_CAPTURE_WARMUP: '0' } });
  try {
    const page = await app.firstWindow();
    await page.evaluate(async endpoint => {
      const settings = await window.snipvia.settings.get(); if (!settings.ok) throw new Error(settings.error);
      const saved = await window.snipvia.settings.save({ ...settings.value, provider: 'custom', endpoint, model: 'mock-errors', apiKey: '' }); if (!saved.ok) throw new Error(saved.error);
    }, `http://127.0.0.1:${address.port}/v1`);
    await app.evaluate(({ desktopCapturer, nativeImage, screen, systemPreferences }) => {
      systemPreferences.getMediaAccessStatus = () => 'granted';
      desktopCapturer.getSources = async options => { const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()), size = options.thumbnailSize!;
        return [{ id: 'screen:synthetic', name: 'Synthetic screen', display_id: String(display.id), appIcon: nativeImage.createEmpty(), thumbnail: nativeImage.createFromBuffer(Buffer.alloc(size.width * size.height * 4, 255), size) }]; };
    });
    expect((await page.evaluate(() => window.snipvia.capture.start())).ok).toBe(true);
    const overlay = app.windows().find(window => window.url().endsWith('#capture'))!; await expect(overlay.locator('.screen-frame')).toBeVisible();
    await overlay.mouse.move(100, 100); await overlay.mouse.down(); await overlay.mouse.move(400, 300); await overlay.mouse.up();
    await expect.poll(() => app.windows().some(window => window.url().endsWith('#quick-chat'))).toBe(true);
    const quick = app.windows().find(window => window.url().endsWith('#quick-chat'))!;
    await quick.getByLabel('悬浮对话问题').press('Enter');
    await expect(quick.getByRole('alert')).toContainText('视觉理解模型鉴权失败'); await expect(quick.getByRole('alert')).toContainText('HTTP 401');
    await expect(quick.locator('.agent-run-status')).toHaveCount(0); await expect(quick.locator('.agent-part')).toHaveCount(0);
    expect(attempts).toBe(1);
    await quick.screenshot({ path: 'docs/ui/prediction-vision-auth-error.png' });
    await quick.getByRole('button', { name: '开始分析', exact: true }).click();
    await expect(quick.getByRole('alert')).toContainText('HTTP 403'); expect(attempts).toBe(2);
    await expect(quick.locator('body')).not.toContainText('PRIVATE');
    await quick.getByLabel('悬浮对话问题').fill('请直接解释代码'); await quick.getByLabel('悬浮对话问题').press('Enter');
    await expect(quick.locator('.agent-answer')).toContainText('仍可以手动提问'); expect(attempts).toBe(2);
  } finally { await app.close(); await new Promise<void>(resolve => model.close(() => resolve())); await rm(directory, { recursive: true, force: true }); }
});
