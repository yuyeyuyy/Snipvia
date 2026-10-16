import { launchDesktop } from '../helpers/desktop';
import { expect, test } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('editable applicability persists and determines prediction independently of fixed screenshot types', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'snipvia-prediction-criteria-'));
  let matchedBranchId: string | null = null;
  const classifications: { branches: { id: string; applicableContent: string }[] }[] = [];
  const executionRequests: string[] = [];
  const server = createServer((request, response) => {
    let body = ''; request.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    request.on('end', () => {
      response.setHeader('Content-Type', 'application/json');
      const parsed = JSON.parse(body);
      const classification = body.includes('You are a screenshot classifier');
      if (classification) classifications.push(JSON.parse(parsed.messages[1].content[0].text));
      else executionRequests.push(body);
      response.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: classification
        ? JSON.stringify({ contentType: 'code', confidence: 0.98, matchedBranchId, signals: { hasCode: true } })
        : '发票金额：128 元。' } }] }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('mock server unavailable');
  const app = await launchDesktop({ args: ['.', `--user-data-dir=${directory}`], env: { ...process.env, SNIPVIA_CONSOLE_ORIGIN: 'http://127.0.0.1:1', SNIPVIA_CAPTURE_BACKEND: 'electron', SNIPVIA_CAPTURE_WARMUP: '0' } });
  try {
    const page = await app.firstWindow(); const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
    await expect(page.getByRole('button', { name: 'AI 笔记', exact: true })).toHaveAttribute('aria-current', 'page');
    await app.evaluate(({ systemPreferences, desktopCapturer, nativeImage, screen }) => {
      systemPreferences.getMediaAccessStatus = () => 'granted';
      desktopCapturer.getSources = async (options) => {
        const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()); const size = options.thumbnailSize!;
        return [{ id: 'screen:mock', name: 'Synthetic screen', display_id: String(display.id), appIcon: nativeImage.createEmpty(), thumbnail: nativeImage.createFromBuffer(Buffer.alloc(size.width * size.height * 4, 255), size) }];
      };
    });
    const configured = await page.evaluate(async (endpoint) => {
      const settings = await window.snipvia.settings.get(); if (!settings.ok) throw new Error(settings.error);
      return window.snipvia.settings.save({ ...settings.value, provider: 'custom', endpoint, model: 'mock-criteria', apiKey: '' });
    }, `http://127.0.0.1:${address.port}/v1`); expect(configured.ok).toBe(true);
    await page.getByRole('button', { name: '模型与设置', exact: true }).click();
    await page.getByRole('button', { name: '编辑解释代码', exact: true }).click();
    await expect(page.getByLabel('适用内容')).toHaveValue('源代码、代码片段或编程实现。');
    const builtinCriteria = '仅 Python 异步代码。\n不包括 JavaScript、报错堆栈或普通需求说明。';
    await page.getByLabel('适用内容').fill(builtinCriteria);
    await page.screenshot({ path: 'docs/ui/settings-prediction-criteria.png' });
    await page.getByRole('button', { name: '保存修改', exact: true }).click();
    await expect(page.locator('.preference-status[role="status"]')).toHaveText('预测分支已更新');
    await page.getByRole('button', { name: '新增预测分支', exact: true }).click();
    await page.getByLabel('分支名称').fill('整理发票');
    await page.getByLabel('执行指令').fill('提取发票的金额和开票日期，输出表格。');
    await page.getByLabel('适用内容').fill('   ');
    await expect(page.getByRole('button', { name: '新增分支', exact: true })).toBeDisabled();
    const customCriteria = '用于报销的发票、收据或付款凭证。\n不包括广告中的价格和购物车。';
    await page.getByLabel('适用内容').fill(customCriteria);
    await page.getByRole('button', { name: '新增分支', exact: true }).click();
    await expect(page.locator('.preference-status[role="status"]')).toHaveText('自定义预测分支已新增');
    const stored = JSON.parse(await readFile(join(directory, 'settings.json'), 'utf8')).settings.predictionBranches;
    const custom = stored.find((branch: { label: string }) => branch.label === '整理发票');
    expect(custom).toMatchObject({ applicableContent: customCriteria, trigger: 'unknown', enabled: true, builtin: false });
    expect(stored.find((branch: { id: string }) => branch.id === 'explain-code').applicableContent).toBe(builtinCriteria);
    await page.reload();
    await page.getByRole('button', { name: '模型与设置', exact: true }).click();
    await expect(page.locator('.prediction-row').filter({ hasText: '整理发票' })).toContainText(customCriteria);
    await page.getByRole('button', { name: '编辑整理发票', exact: true }).click();
    await expect(page.getByLabel('适用内容')).toHaveValue(customCriteria);
    await page.getByRole('button', { name: '关闭编辑预测分支' }).click();

    async function predict() {
      const started = await page.evaluate(() => window.snipvia.capture.start()); expect(started.ok).toBe(true);
      const overlay = app.windows().find((window) => window.url().endsWith('#capture'))!;
      await expect(overlay.locator('.screen-frame')).toBeVisible();
      await overlay.mouse.move(100, 100); await overlay.mouse.down(); await overlay.mouse.move(400, 300); await overlay.mouse.up();
      await expect.poll(() => app.windows().some((window) => window.url().endsWith('#quick-chat') && !window.isClosed())).toBe(true);
      const quick = app.windows().find((window) => window.url().endsWith('#quick-chat') && !window.isClosed())!;
      quick.on('pageerror', (error) => errors.push(error.message));
      await expect(quick.getByText('按 Enter，开始智能分析')).toBeVisible();
      await quick.getByLabel('悬浮对话问题').press('Enter');
      return quick;
    }
    async function returnToSettings() {
      const pin = app.windows().find((window) => window.url().endsWith('#quick-chat'))!;
      await pin.getByRole('button', { name: '返回软件' }).click();
      await page.getByRole('button', { name: '模型与设置', exact: true }).click();
    }
    matchedBranchId = custom.id;
    let quick = await predict();
    await expect(quick.getByLabel('预测分支')).toHaveText('整理发票');
    await expect(quick.locator('.agent-answer')).toContainText('发票金额：128 元');
    expect(executionRequests).toHaveLength(1);
    expect(executionRequests[0]).toContain('提取发票的金额和开票日期');
    expect(classifications.at(-1)?.branches.find((branch) => branch.id === custom.id)?.applicableContent).toBe(customCriteria);
    await returnToSettings();
    matchedBranchId = null;
    quick = await predict();
    await expect.poll(async () => { const state = await quick.evaluate(() => window.snipvia.chat.state()); return state.ok && state.value.autoAction?.state; }).toBe('idle');
    await expect(quick.getByLabel('预测分支')).toHaveCount(0);
    expect(executionRequests).toHaveLength(1);
    await returnToSettings();
    await page.getByLabel('关闭整理发票').click();
    await expect(page.locator('.preference-status[role="status"]')).toHaveText('预测分支已关闭');
    // A stale or hallucinated disabled ID must never execute, even with a strong fixed type.
    matchedBranchId = custom.id;
    quick = await predict();
    await expect.poll(async () => { const state = await quick.evaluate(() => window.snipvia.chat.state()); return state.ok && state.value.autoAction?.state; }).toBe('error');
    expect(classifications.at(-1)?.branches.some((branch) => branch.id === custom.id)).toBe(false);
    expect(executionRequests).toHaveLength(1);
    expect(errors).toEqual([]);
  } finally {
    await app.close(); await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
