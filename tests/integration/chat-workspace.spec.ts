import { expect, test } from '@playwright/test';
import { createServer, type ServerResponse } from 'node:http';
import { mkdtemp, readFile, readdir, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { tokenColor } from '../helpers/appearance';
import { launchDesktop } from '../helpers/desktop';

test('AI workspace uses real IPC with mock streams, preserves drafts, regenerates, stops and reopens text history', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'snipvia-chat-workspace-'));
  const bodies: Array<{ messages: Array<{ role: string; content: unknown }>; tools: Array<{ function: { name: string } }> }> = [];
  const chunk = (content: string, finish_reason: string | null = null) => `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason }] })}\n\n`;
  let stream: ServerResponse | undefined;
  const server = createServer((request, response) => {
    let raw = ''; request.on('data', chunk => { raw += chunk.toString(); });
    request.on('end', () => {
      const body = JSON.parse(raw); bodies.push(body);
      response.setHeader('Content-Type', 'text/event-stream');
      const last = body.messages.at(-1).content;
      if (last === '等待停止') { response.write(chunk('保留这段部分回答')); stream = response; return; }
      if (bodies.length === 1) { response.write(chunk('正在生成第一段')); stream = response; return; }
      response.end(chunk('## 新回答\n\n```python\nprint(1) # 注释\n```\n\n| 项 | 值 |\n| --- | --- |\n| A | 1 |', 'stop') + 'data: [DONE]\n\n');
    });
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('mock unavailable');
  const options = { args: ['.', `--user-data-dir=${directory}`], env: { ...process.env, SNIPVIA_CAPTURE_BACKEND: 'electron', SNIPVIA_CAPTURE_WARMUP: '0' } };
  let app = await launchDesktop(options);
  try {
    let page = await app.firstWindow(); const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: 'AI 对话', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'AI 对话', exact: true })).toBeVisible();
    await page.getByLabel('AI 对话输入').fill('未配置的问题'); await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('配置模型和 API Key');
    expect(bodies).toHaveLength(0);
    const configured = await page.evaluate(async endpoint => {
      const settings = await window.snipvia.settings.get(); if (!settings.ok) throw new Error(settings.error);
      return window.snipvia.settings.save({ ...settings.value, provider: 'custom', model: 'mock-text', endpoint, apiKey: 'test-key' });
    }, `http://127.0.0.1:${address.port}/v1`);
    expect(configured.ok).toBe(true);
    await page.getByLabel('AI 对话输入').fill('解释二分查找'); await page.getByLabel('AI 对话输入').press('Enter');
    await expect(page.getByLabel('当前回答')).toContainText('正在生成第一段');
    await expect(page.getByRole('button', { name: '停止生成' })).toBeVisible();
    expect(bodies[0].messages.at(-1)?.content).toBe('解释二分查找');
    expect(bodies[0].tools.map(tool => tool.function.name)).not.toContain('write_note');
    expect(bodies[0].tools.map(tool => tool.function.name)).not.toContain('run_command');
    const firstId = await page.getByLabel('选择对话', { exact: true }).inputValue();
    await page.getByRole('button', { name: '新建对话', exact: true }).click();
    await page.getByLabel('AI 对话输入').fill('草稿保留');
    stream!.end(chunk('，完成。', 'stop') + 'data: [DONE]\n\n');
    await page.getByLabel('选择对话', { exact: true }).selectOption(firstId);
    await expect(page.locator('.workspace-message.assistant')).toContainText('正在生成第一段，完成。');
    await page.getByLabel('选择对话', { exact: true }).selectOption('');
    await expect(page.getByLabel('AI 对话输入')).toHaveValue('草稿保留');
    await page.getByLabel('选择对话', { exact: true }).selectOption(firstId);
    await page.getByRole('button', { name: '重新生成', exact: true }).click();
    await expect(page.locator('.workspace-message.assistant h2')).toHaveText('新回答');
    await expect(page.locator('.workspace-message.assistant table')).toContainText('A');
    await expect(page.getByRole('button', { name: '复制 Python 代码' })).toBeVisible();
    await page.getByRole('button', { name: '复制 Python 代码' }).click();
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe('print(1) # 注释');
    expect(JSON.stringify(bodies[1].messages)).not.toContain('正在生成第一段');
    await page.getByText('查看之前的回答（1）').click(); await expect(page.locator('.previous-answers')).toContainText('正在生成第一段，完成。');
    await page.getByRole('button', { name: '复制回答', exact: true }).click();
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toContain('## 新回答');
    const stored = JSON.parse(await readFile(join(directory, 'history/conversations.json'), 'utf8'));
    expect(stored[0].capture).toBeUndefined(); expect(stored[0].messages).toHaveLength(2); expect(stored[0].messages[1].previousAnswers).toHaveLength(1);
    expect(await readdir(join(directory, 'history/captures'))).toEqual([]);
    const overlay = app.windows().find(window => window.url().endsWith('#capture'))!;
    expect((await overlay.evaluate(id => window.snipvia.agent.workspaceState(id), firstId)).ok).toBe(false);
    const denied = await overlay.evaluate(id => window.snipvia.agent.noteDiff({ conversationId: id }, crypto.randomUUID()), firstId);
    expect(denied).toMatchObject({ ok: false, error: '不允许的窗口请求' });
    expect((await page.evaluate(id => window.snipvia.agent.workspaceStart(id, 'wrong', true), firstId)).ok).toBe(false);
    await mkdir('docs/ui/chat-workspace-phase2', { recursive: true });
    for (const theme of ['light', 'dark'] as const) {
      expect((await page.evaluate(mode => window.snipvia.appearance.set(mode), theme)).ok).toBe(true);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      const selected = page.locator('.sidebar .nav.active');
      await expect(selected).toHaveCSS('background-color', await tokenColor(selected, 'bg-selected'));
      await expect(selected).toHaveCSS('color', await tokenColor(selected, 'text-selected'));
      await page.screenshot({ path: `docs/ui/chat-workspace-phase2/${theme}.png` });
    }
    await page.getByLabel('AI 对话输入').fill('等待停止'); await page.getByLabel('AI 对话输入').press('Enter');
    await expect(page.getByLabel('当前回答')).toContainText('保留这段部分回答');
    await page.getByRole('button', { name: '停止生成' }).click();
    await expect(page.getByRole('button', { name: '停止生成' })).toHaveCount(0);
    await expect(page.locator('.workspace-message.assistant').last()).toContainText('保留这段部分回答');
    expect(errors).toEqual([]);
    await app.close(); app = await launchDesktop(options); page = await app.firstWindow();
    await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '历史对话', exact: true }).click();
    await expect(page.locator('.history-preview-body')).toContainText('新回答');
    await page.getByRole('button', { name: '继续对话', exact: true }).click();
    await expect(page.getByLabel('AI 对话输入')).toBeVisible();
    await expect(page.locator('.workspace-message.assistant').last()).toContainText('保留这段部分回答');
    await page.getByLabel('AI 对话输入').fill('第二行'); await page.getByLabel('AI 对话输入').press('Shift+Enter');
    await expect(page.getByLabel('AI 对话输入')).toHaveValue('第二行\n');
  } finally { stream?.destroy(); await app.close(); await new Promise<void>(done => server.close(() => done())); await rm(directory, { recursive: true, force: true }); }
});
