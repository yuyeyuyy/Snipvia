import { expect, test } from '@playwright/test';
import { createServer, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchDesktop } from '../helpers/desktop';
import { chatModelId } from '../../src/renderer/src/chat/model-choice';
import { visionTestImage } from '../../src/main/ai/models/vision-test';

test('modern chat welcome, sidebar actions, per-conversation models, responsive composer and streaming scroll preserve real data', async () => {
  test.setTimeout(90_000);
  const directory = await mkdtemp(join(tmpdir(), 'snipvia-chat-redesign-'));
  const requests: Array<{ model: string; messages: Array<{ role: string; content: string }> }> = [];
  let stream: ServerResponse | undefined;
  const chunk = (content: string, finish_reason: string | null = null) => `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason }] })}\n\n`;
  const paragraphs = Array.from({ length: 60 }, (_, i) => `第 ${i + 1} 步：检查区间边界，确认每次迭代都能缩小搜索范围。`).join('\n\n');
  const server = createServer((request, response) => { let raw = ''; request.on('data', data => { raw += data.toString(); }); request.on('end', () => {
    const body = JSON.parse(raw); requests.push(body); const question = body.messages.filter((message: { role: string }) => message.role === 'user').at(-1).content;
    response.setHeader('Content-Type', 'text/event-stream');
    if (question === '慢回复') { stream = response; response.write(chunk(paragraphs)); return; }
    response.end(chunk(question === '长回答' ? `${paragraphs}\n\n\`\`\`python\nleft = mid + 1 # 缩小区间\n\`\`\`\n\n| 项 | 值 |\n| --- | --- |\n| 复杂度 | O(log n) |` : '测试回答已完成。', 'stop') + 'data: [DONE]\n\n');
  }); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); if (!address || typeof address === 'string') throw new Error('Mock unavailable');
  const endpoint = `http://127.0.0.1:${address.port}/v1`, scope = (model: string) => chatModelId({ provider: 'custom', model, endpoint });
  const oldId = randomUUID(), timestamp = new Date().toISOString(); await mkdir(join(directory, 'history'));
  await writeFile(join(directory, 'history/conversations.json'), JSON.stringify([{ id: oldId, title: '旧模型会话', createdAt: timestamp, updatedAt: timestamp, profile: { provider: 'custom', model: 'removed-model', endpoint: endpoint + '/removed' }, messages: [{ role: 'user', content: '旧问题' }, { role: 'assistant', content: '旧回答' }] }, { id: randomUUID(), title: '已用过的 B 模型', createdAt: timestamp, updatedAt: timestamp, profile: { provider: 'custom', endpoint, model: 'mock-b' }, messages: [{ role: 'user', content: 'B 的历史' }, { role: 'assistant', content: 'B 的回答' }] }]));
  const options = { args: ['.', `--user-data-dir=${directory}`], env: { ...process.env, SNIPVIA_CAPTURE_BACKEND: 'electron', SNIPVIA_CAPTURE_WARMUP: '0' } };
  let app = await launchDesktop(options);
  try {
    let page = await app.firstWindow(); const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.evaluate(async endpoint => { const result = await window.snipvia.settings.get(); if (!result.ok) throw new Error(result.error); for (const model of ['mock-b', 'mock-a']) { const saved = await window.snipvia.settings.save({ ...result.value, provider: 'custom', endpoint, model, apiKey: 'test-key' }); if (!saved.ok) throw new Error(saved.error); } }, endpoint);
    await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: 'AI 对话', exact: true }).click();
    await expect(page.locator('.chat-welcome-mode')).toBeVisible(); expect(await page.locator('.app-shell > .sidebar').count()).toBe(1);
    // Read both rectangles in one frame while the existing sidebar animation runs.
    const alignment = await page.locator('.ai-workspace-input').evaluate(node => { const welcome = node.querySelector('.chat-welcome')!.getBoundingClientRect(), composer = node.querySelector('.workspace-composer')!.getBoundingClientRect(); return { center: Math.abs(welcome.x + welcome.width / 2 - composer.x - composer.width / 2), gap: composer.y - welcome.bottom }; });
    expect(alignment.center).toBeLessThan(2); expect(alignment.gap).toBeLessThan(60);
    const input = page.getByLabel('AI 对话输入'); const initialHeight = await input.evaluate(node => node.clientHeight);
    await input.fill(Array.from({ length: 10 }, () => '自动增高测试').join('\n')); expect(await input.evaluate(node => node.clientHeight)).toBeGreaterThan(initialHeight);
    await input.dispatchEvent('keydown', { key: 'Enter', isComposing: true }); expect(requests).toHaveLength(0);
    await input.fill(''); await expect(page.getByRole('button', { name: '发送', exact: true })).toBeDisabled();
    await mkdir('docs/ui/chat-redesign', { recursive: true });
    for (const theme of ['light', 'dark'] as const) { await page.evaluate(theme => window.snipvia.appearance.set(theme), theme); await expect(page.locator('html')).toHaveAttribute('data-theme', theme); await page.screenshot({ path: `docs/ui/chat-redesign/welcome-${theme}.png` }); }
    await input.fill('长回答'); await input.press('Enter'); await expect(page.locator('.workspace-message.assistant table')).toContainText('复杂度');
    await expect(page.locator('.chat-welcome-mode')).toHaveCount(0); const firstId = await page.getByLabel('选择对话', { exact: true }).inputValue();
    const area = page.locator('.ai-workspace-scroll'); const scrollBounds = await area.boundingBox(), formBounds = await page.locator('.workspace-composer').boundingBox();
    expect(scrollBounds!.y + scrollBounds!.height).toBeLessThanOrEqual(formBounds!.y + 2);
    const bubble = await page.locator('.chat-user-bubble').boundingBox(), transcript = await page.locator('.ai-workspace-transcript').boundingBox(); expect(bubble!.x).toBeGreaterThan(transcript!.x + 50);
    await area.evaluate(node => { node.scrollTop = 0; });
    await page.getByRole('button', { name: '复制消息', exact: true }).click(); expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe('长回答');
    for (const theme of ['light', 'dark'] as const) { await page.evaluate(theme => window.snipvia.appearance.set(theme), theme); await page.screenshot({ animations: 'disabled', path: `docs/ui/chat-redesign/messages-${theme}.png` }); }
    await page.getByRole('button', { name: '对话操作：长回答', exact: true }).click(); await page.getByRole('button', { name: '重命名', exact: true }).click();
    const renamed = '算法学习 · ' + '二分查找'.repeat(20); await page.getByLabel('对话名称').fill(renamed); await page.getByRole('button', { name: '保存名称' }).click();
    await expect(page.getByRole('dialog', { name: '重命名对话' })).toHaveCount(0); await expect(page.locator('.chat-sidebar-row.selected')).toContainText(renamed);
    await page.getByLabel('AI 对话输入').fill('慢回复'); await page.getByLabel('AI 对话输入').press('Enter'); await expect(page.getByLabel('当前回答')).toContainText('第 60 步');
    await area.evaluate(node => { node.scrollTop = 80; }); await expect(page.getByRole('button', { name: '回到最新消息' })).toBeVisible();
    const position = await area.evaluate(node => node.scrollTop); stream!.write(chunk('\n\n新追加的流式内容。')); await expect(page.getByLabel('当前回答')).toContainText('新追加的流式内容');
    expect(Math.abs(await area.evaluate(node => node.scrollTop) - position)).toBeLessThan(3);
    await page.getByRole('button', { name: '回到最新消息' }).click(); await expect(page.getByRole('button', { name: '回到最新消息' })).toHaveCount(0);
    await page.getByRole('button', { name: '停止生成' }).click(); await expect(page.getByRole('button', { name: '停止生成' })).toHaveCount(0);
    expect((await page.evaluate(id => window.snipvia.history.read(id), firstId)).ok).toBe(true);
    await page.getByRole('button', { name: '新对话', exact: true }).click(); await page.getByLabel('对话模型', { exact: true }).selectOption(scope('mock-b'));
    await page.getByLabel('AI 对话输入').fill('第二个会话'); await expect(page.getByRole('button', { name: '发送', exact: true })).toBeEnabled(); await page.getByLabel('AI 对话输入').press('Enter'); await expect(page.locator('.workspace-message.assistant')).toContainText('测试回答');
    const secondId = await page.getByLabel('选择对话', { exact: true }).inputValue(); expect(requests.at(-1)?.model).toBe('mock-b');
    await page.locator('.chat-sidebar-select').filter({ hasText: renamed }).click(); await expect(page.getByLabel('对话模型', { exact: true })).toHaveValue(scope('mock-a'));
    await page.locator('.chat-sidebar-select').filter({ hasText: '旧模型会话' }).click(); await expect(page.getByRole('alert')).toContainText('不在配置'); await expect(page.getByLabel('对话模型', { exact: true })).toHaveValue('');
    await page.getByLabel('AI 对话输入').fill('旧会话的新问题'); await expect(page.getByRole('button', { name: '发送', exact: true })).toBeDisabled();
    await page.getByLabel('对话模型', { exact: true }).selectOption(scope('mock-a')); await expect(page.getByRole('button', { name: '发送', exact: true })).toBeEnabled();
    await page.locator('.chat-sidebar-select').filter({ hasText: renamed }).click();
    await page.getByRole('button', { name: '对话操作：第二个会话', exact: true }).click(); await page.getByRole('button', { name: '删除对话', exact: true }).click();
    await expect(page.getByRole('button', { name: '取消', exact: true })).toBeFocused(); await page.getByRole('button', { name: '取消', exact: true }).click();
    await page.getByRole('button', { name: '对话操作：第二个会话', exact: true }).click(); await page.getByRole('button', { name: '删除对话', exact: true }).click(); await page.getByRole('dialog', { name: '删除对话' }).getByRole('button', { name: '删除对话', exact: true }).click();
    await expect(page.locator('.chat-sidebar-select').filter({ hasText: '第二个会话' })).toHaveCount(0); expect((await page.evaluate(id => window.snipvia.history.read(id), secondId)).ok).toBe(false);
    await page.locator('.ai-workspace').evaluate((element, encoded) => { const data = new DataTransfer(); for (let i = 0; i < 4; i++) data.items.add(new File([Uint8Array.from(atob(encoded), c => c.charCodeAt(0))], `截图-${i}.png`, { type: 'image/png' })); element.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data })); }, visionTestImage);
    await expect(page.getByRole('group', { name: '待发送图片' }).locator('img')).toHaveCount(4);
    await page.getByLabel('AI 对话输入').fill(Array.from({ length: 12 }, () => '带附件的长草稿').join('\n'));
    for (const [width, height] of [[1600, 900], [1120, 780], [840, 600]]) {
      await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows().find(win => !win.webContents.getURL().includes('#'))!.setSize(size[0], size[1]), [width, height]);
      await expect(page.getByRole('button', { name: '发送', exact: true })).toBeInViewport();
      await expect(page.getByRole('button', { name: '发送', exact: true })).toBeEnabled();
      expect(await page.locator('.chat-model-control').evaluate(node => { const arrow = node.querySelector('svg')!.getBoundingClientRect(), select = node.querySelector('select')!.getBoundingClientRect(); return Math.abs(arrow.y + arrow.height / 2 - select.y - select.height / 2); })).toBeLessThan(1);
      expect(await page.locator('.ai-workspace').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
      for (const theme of ['light', 'dark'] as const) { await page.evaluate(theme => window.snipvia.appearance.set(theme), theme); await page.screenshot({ path: `docs/ui/chat-redesign/conversation-${theme}-${width}.png` }); }
    }
    await page.getByRole('button', { name: '展开菜单栏', exact: true }).click(); await expect(page.locator('.chat-sidebar-list')).toBeVisible();
    await expect(page.getByRole('button', { name: '发送', exact: true })).toBeInViewport(); expect(await page.locator('.workspace-composer').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await page.getByRole('button', { name: '收起菜单栏', exact: true }).click(); await expect(page.locator('.chat-sidebar-list')).toBeHidden();
    await page.evaluate(() => window.snipvia.appearance.set('system')); await expect(page.locator('html')).toHaveAttribute('data-theme-mode', 'system');
    expect(errors).toEqual([]); await app.close(); app = await launchDesktop(options); page = await app.firstWindow();
    await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: 'AI 对话', exact: true }).click(); await page.getByLabel('选择对话', { exact: true }).selectOption(firstId);
    await expect(page.getByLabel('对话模型', { exact: true })).toHaveValue(scope('mock-a')); const restored = await page.evaluate(id => window.snipvia.history.read(id), firstId); expect(restored.ok && restored.value.title).toBe(renamed);
    await expect(page.getByRole('group', { name: '待发送图片' })).toHaveCount(0);
  } finally { stream?.destroy(); await app.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); }
});
