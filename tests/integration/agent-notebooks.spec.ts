import { launchDesktop } from '../helpers/desktop';
import { expect, test } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readdir, readFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('notebook selection, first-use creation, branch binding and optional automatic note tools', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'snipvia-notebook-chat-')); const location = join(directory, 'books'); await mkdir(location);
  let requests = 0;
  const server = createServer((request, response) => {
    let body = ''; request.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    request.on('end', () => {
      requests++; response.setHeader('Content-Type', 'application/json');
      const content = body.includes('You are a screenshot classifier')
        ? JSON.stringify({ contentType: 'code', confidence: 0.98, matchedBranchId: 'explain-code', signals: { hasCode: true } }) : '这段代码演示了事件循环。可以把关键概念整理成知识点。';
      response.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content } }] }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('mock server unavailable');
  const app = await launchDesktop({ args: ['.', `--user-data-dir=${join(directory, 'app')}`], env: { ...process.env, SNIPVIA_CAPTURE_BACKEND: 'electron', SNIPVIA_CAPTURE_WARMUP: '0' } });
  try {
    const page = await app.firstWindow(); const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
    await expect(page.getByRole('button', { name: 'AI 笔记', exact: true })).toHaveAttribute('aria-current', 'page');
    await app.evaluate(({ dialog, systemPreferences, desktopCapturer, nativeImage, screen }, location) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [location] });
      systemPreferences.getMediaAccessStatus = () => 'granted';
      desktopCapturer.getSources = async (options) => {
        const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()); const size = options.thumbnailSize!;
        return [{ id: 'screen:mock', name: 'Synthetic screen', display_id: String(display.id), appIcon: nativeImage.createEmpty(), thumbnail: nativeImage.createFromBuffer(Buffer.alloc(size.width * size.height * 4, 255), size) }];
      };
    }, location);
    const configured = await page.evaluate(async (endpoint) => {
      const settings = await window.snipvia.settings.get(); if (!settings.ok) throw new Error(settings.error);
      return window.snipvia.settings.save({ ...settings.value, provider: 'custom', endpoint, model: 'mock-agent', apiKey: '' });
    }, `http://127.0.0.1:${address.port}/v1`); expect(configured.ok).toBe(true);
    async function capture() {
      const started = await page.evaluate(() => window.snipvia.capture.start()); expect(started.ok).toBe(true);
      const overlay = app.windows().find((window) => window.url().endsWith('#capture'))!;
      await expect(overlay.locator('.screen-frame')).toBeVisible();
      await overlay.mouse.move(100, 100); await overlay.mouse.down(); await overlay.mouse.move(400, 300); await overlay.mouse.up();
      await expect.poll(() => app.windows().some((window) => window.url().endsWith('#quick-chat') && !window.isClosed())).toBe(true);
      const quick = app.windows().find((window) => window.url().endsWith('#quick-chat') && !window.isClosed())!;
      quick.on('pageerror', (error) => errors.push(error.message));
      await expect(quick.getByText('按 Enter，开始智能分析')).toBeVisible(); return quick;
    }
    let quick = await capture();
    await quick.getByRole('button', { name: '选择笔记', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '创建笔记本', exact: true })).toBeVisible();
    await page.getByLabel('笔记本名称', { exact: true }).fill('编程知识'); await page.getByRole('button', { name: '创建', exact: true }).click();
    await expect.poll(async () => { const current = await page.evaluate(() => window.snipvia.chat.state()); if (!current.ok) return null; const state = await page.evaluate(id => window.snipvia.agent.state(id), current.value.capture.id); return state.ok && state.value.notebook?.name; }).toBe('编程知识');
    const root = join(location, '编程知识'); expect(await readdir(root)).toEqual(['assets']); expect(requests).toBe(0);
    const state = await page.evaluate(() => window.snipvia.notes.state()); if (!state.ok) throw new Error(state.error);
    const notebookId = state.value.notebooks[0].id;
    await page.getByRole('button', { name: '模型与设置', exact: true }).click();
    await page.getByRole('button', { name: '编辑解释代码' }).click();
    await page.getByLabel('绑定笔记本').selectOption(notebookId);
    await page.screenshot({ path: 'docs/ui/notes-branch-binding.png' });
    await page.getByRole('button', { name: '保存修改', exact: true }).click();
    await expect.poll(async () => {
      const settings = await page.evaluate(() => window.snipvia.settings.get()); return settings.ok && settings.value.predictionBranches.find((branch) => branch.id === 'explain-code')?.notebookId;
    }).toBe(notebookId);
    quick = await capture();
    await expect(quick.getByRole('button', { name: '记入笔记', exact: true })).toHaveCount(0);
    await quick.getByLabel('悬浮对话问题').press('Enter');
    await expect(quick.getByLabel('预测分支')).toHaveText('解释代码');
    await expect(quick.getByRole('button', { name: '选择笔记', exact: true })).toHaveText('编程知识⌄');
    await expect(quick.getByRole('button', { name: '记入笔记', exact: true })).toHaveCount(0);
    await quick.screenshot({ path: 'docs/ui/notes-chat-binding.png' });
    // The mock model chose a plain answer. Choosing a notebook does not force a write.
    expect(await readdir(root)).toEqual(['assets']);
    await quick.getByRole('button', { name: '选择笔记', exact: true }).click();
    await quick.getByRole('button', { name: '不选择笔记', exact: true }).click();
    await expect(quick.getByRole('button', { name: '记入笔记', exact: true })).toHaveCount(0);
    const captureState = await quick.evaluate(() => window.snipvia.chat.state()); if (!captureState.ok) throw new Error(captureState.error);
    const overlay = app.windows().find((window) => window.url().endsWith('#capture'))!;
    expect((await overlay.evaluate((id) => window.snipvia.agent.notebooks(id), captureState.value.capture.id)).ok).toBe(false);
    expect((await quick.evaluate((id) => window.snipvia.agent.selectNotebook(id, '00000000-0000-4000-8000-000000000099'), captureState.value.capture.id)).ok).toBe(false);
    const pin = app.windows().find((window) => window.url().endsWith('#quick-chat'))!;
    await pin.getByRole('button', { name: '返回软件' }).click();
    await rename(root, root + '-offline');
    quick = await capture(); await quick.getByLabel('悬浮对话问题').press('Enter');
    await expect(quick.getByText('绑定的笔记本无法打开，请重新选择笔记。当前回答仍可继续。')).toBeVisible();
    await expect(quick.locator('.agent-answer')).toContainText('这段代码演示了事件循环');
    await expect(quick.getByRole('button', { name: '记入笔记', exact: true })).toHaveCount(0);
    expect(JSON.parse(await readFile(join(directory, 'app', 'settings.json'), 'utf8')).settings.predictionBranches.find((branch: { id: string }) => branch.id === 'explain-code').notebookId).toBe(notebookId);
    expect(errors).toEqual([]);
  } finally {
    await app.close(); await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
