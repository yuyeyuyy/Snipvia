import { expect, test, type Page } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { launchMemberDesktop } from '../helpers/desktop-account';
import { chatModelId } from '../../src/renderer/src/chat/model-choice';
import { visionTestImage } from '../../src/main/ai/models/vision-test';

test('native file chooser, Cmd+V, dropped files, screenshot crops and image history use the existing multimodal Agent safely', async () => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(join(tmpdir(), 'snipvia-image-workspace-')), storage = join(directory, 'app');
  const png = join(directory, '测试图.png'); await writeFile(png, Buffer.from(visionTestImage, 'base64'));
  const bodies: Array<{ messages: Array<{ role: string; content: string | Array<{ type: string; text?: string; image_url?: { url: string } }> }> }> = [];
  const server = createServer((request, response) => { let body = ''; request.on('data', chunk => { body += chunk.toString(); }); request.on('end', () => {
    const input = JSON.parse(body); bodies.push(input); const last = input.messages.filter((message: { role: string }) => message.role === 'user').at(-1).content;
    const question = typeof last === 'string' ? last : last.find((part: { type: string }) => part.type === 'text').text;
    if (input.model === 'text-only' && Array.isArray(last)) { response.statusCode = 400; response.end(JSON.stringify({ error: 'unsupported image input' })); return; }
    if (question.includes('鉴权')) { response.statusCode = 401; response.end(JSON.stringify({ error: 'invalid_api_key PRIVATE_REFLECTION' })); return; }
    response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ choices: [{ message: { content: '已分析合成图片。' }, finish_reason: 'stop' }] }));
  }); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); if (!address || typeof address === 'string') throw new Error('Mock unavailable');
  const options = { args: ['.', `--user-data-dir=${storage}`], env: { ...process.env, SNIPVIA_CAPTURE_BACKEND: 'electron', SNIPVIA_CAPTURE_WARMUP: '0' } };
  let app = await launchMemberDesktop(options);
  const configure = async (page: Page, model = 'mock-image') => { const result = await page.evaluate(async ({ endpoint, model }) => { const settings = await window.snipvia.settings.get(); if (!settings.ok) throw new Error(settings.error); return window.snipvia.settings.save({ ...settings.value, provider: 'custom', model, endpoint, apiKey: 'test-key' }); }, { endpoint: `http://127.0.0.1:${address.port}/v1`, model }); if (await page.getByLabel('对话模型', { exact: true }).isVisible()) { await expect(page.getByLabel('对话模型', { exact: true })).toBeEnabled(); await page.getByLabel('对话模型', { exact: true }).selectOption(chatModelId({ provider: 'custom', endpoint: `http://127.0.0.1:${address.port}/v1`, model })); } return result; };
  try {
    let page = await app.firstWindow(); const imageAction = async (name: string) => { await page.getByRole('button', { name: '添加图片', exact: true }).click(); await page.getByRole('button', { name, exact: true }).click(); }; const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    expect((await configure(page)).ok).toBe(true);
    await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: 'AI 对话', exact: true }).click();
    await app.evaluate(({ dialog, nativeImage }, { path, encoded }) => { const fs = process.getBuiltinModule('node:fs'); fs.writeFileSync(path + '.jpg', nativeImage.createFromBuffer(Buffer.from(encoded, 'base64')).toJPEG(90)); dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path, path + '.jpg'] }); }, { path: png, encoded: visionTestImage });
    await imageAction('添加本地图片'); await expect(page.getByRole('group', { name: '待发送图片' }).locator('img')).toHaveCount(2);
    // Use the real native clipboard with a synthetic image, then exercise the actual keyboard path.
    await app.evaluate(async ({ clipboard, ClipboardItem }, encoded) => { await clipboard.write([new ClipboardItem({ 'image/png': new Blob([Buffer.from(encoded, 'base64')], { type: 'image/png' }) })]); }, visionTestImage);
    await page.getByLabel('AI 对话输入').focus(); await page.keyboard.press('ControlOrMeta+V'); await expect(page.getByRole('group', { name: '待发送图片' }).locator('img')).toHaveCount(3);
    await page.locator('.ai-workspace').evaluate((element, encoded) => { const files = new DataTransfer(); files.items.add(new File([Uint8Array.from(atob(encoded), char => char.charCodeAt(0))], '拖放图.png', { type: 'image/png' })); element.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: files })); }, visionTestImage);
    await expect(page.getByRole('group', { name: '待发送图片' }).locator('img')).toHaveCount(4);
    await imageAction('粘贴图片'); await expect(page.getByRole('alert')).toContainText('最多 4 张');
    await page.getByRole('button', { name: '移除图片 测试图.png.jpg', exact: true }).click(); await expect(page.getByRole('group', { name: '待发送图片' }).locator('img')).toHaveCount(3);
    await page.getByRole('button', { name: '查看图片 测试图.png', exact: true }).click(); await expect(page.getByRole('dialog', { name: '查看消息图片' })).toBeVisible(); await page.getByRole('button', { name: '关闭图片预览' }).click();
    await mkdir('docs/ui/chat-workspace-phase4', { recursive: true });
    for (const mode of ['light', 'dark'] as const) { await page.evaluate(mode => window.snipvia.appearance.set(mode), mode); await expect(page.locator('html')).toHaveAttribute('data-theme', mode); await page.screenshot({ path: `docs/ui/chat-workspace-phase4/images-${mode}.png` }); }
    await page.getByLabel('AI 对话输入').fill('比较这三张图片'); await page.getByLabel('AI 对话输入').press('Enter'); await expect(page.locator('.workspace-message.assistant')).toContainText('已分析合成图片');
    await expect(page.getByRole('group', { name: '待发送图片' })).toHaveCount(0);
    expect((bodies[0].messages.at(-1)!.content as unknown[])).toHaveLength(4);
    const id = await page.getByLabel('选择对话', { exact: true }).inputValue();
    const index = JSON.parse(await readFile(join(storage, 'history/conversations.json'), 'utf8')); expect(index[0].messages[0].images).toHaveLength(3); expect(JSON.stringify(index)).not.toContain('data:image');
    await page.getByRole('button', { name: '重新生成', exact: true }).click(); await expect.poll(() => bodies.length).toBe(2); await expect(page.getByRole('group', { name: '消息图片' }).locator('img')).toHaveCount(3);
    expect((bodies[1].messages.at(-1)!.content as unknown[])).toHaveLength(4);
    const filesBefore = await readdir(join(storage, 'history/attachments')); expect(filesBefore).toHaveLength(3);
    await app.close(); app = await launchMemberDesktop(options); page = await app.firstWindow();
    await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: 'AI 对话', exact: true }).click(); await page.getByLabel('选择对话', { exact: true }).selectOption(id);
    await expect(page.getByRole('group', { name: '消息图片' }).locator('img')).toHaveCount(3);
    await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '历史对话', exact: true }).click();
    await expect(page.locator('.history-panel').getByRole('group', { name: '消息图片' }).locator('img')).toHaveCount(3);
    await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: 'AI 对话', exact: true }).click();
    // A text-only model blocks current images before network IO, but the text workflow stays usable.
    await imageAction('粘贴图片'); await expect(page.getByRole('group', { name: '待发送图片' }).locator('img')).toHaveCount(1);
    // The restarted application requires native confirmation before a vision probe.
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); });
    expect((await page.evaluate(endpoint => window.snipvia.models.testVision({ provider: 'custom', endpoint, model: 'text-only', confirmCost: true }), `http://127.0.0.1:${address.port}/v1`)).ok).toBe(true);
    expect((await configure(page, 'text-only')).ok).toBe(true);
    await expect(page.getByRole('alert')).toContainText('已确认不支持图片'); await expect(page.getByRole('button', { name: '发送', exact: true })).toBeDisabled();
    const count = bodies.length; await page.getByLabel('AI 对话输入').fill('不要发送'); await page.getByLabel('AI 对话输入').press('Enter'); expect(bodies).toHaveLength(count);
    const blocked = await page.evaluate(async ({ id, encoded }) => { const image = await window.snipvia.chatImages.import(id, [{ name: '拒绝图.png', bytes: Uint8Array.from(atob(encoded), char => char.charCodeAt(0)) }]); if (!image.ok) throw new Error(image.error); const result = await window.snipvia.agent.workspaceStart(id, '带图请求应拒绝', false, [image.value[0].id]); await window.snipvia.chatImages.remove(id, image.value[0].id); return result; }, { id, encoded: visionTestImage });
    expect(blocked).toMatchObject({ ok: false, error: expect.stringContaining('不支持图片') }); expect(bodies).toHaveLength(count);
    await page.getByRole('group', { name: '待发送图片' }).getByRole('button', { name: /移除图片/ }).click();
    await page.getByLabel('AI 对话输入').fill('只发送文本'); await page.getByLabel('AI 对话输入').press('Enter'); await expect.poll(() => bodies.length).toBe(count + 1);
    expect(JSON.stringify(bodies.at(-1))).not.toContain('data:image');
    await expect(page.getByRole('button', { name: '发送', exact: true })).toBeDisabled();
    await imageAction('粘贴图片'); await expect(page.getByRole('group', { name: '待发送图片' }).locator('img')).toHaveCount(1);
    const overlay = app.windows().find(window => window.url().endsWith('#capture'))!;
    expect((await overlay.evaluate(() => window.snipvia.chatImages.paste(null))).ok).toBe(false);
    await configure(page); await page.getByLabel('AI 对话输入').fill('测试图片鉴权错误'); await page.getByLabel('AI 对话输入').press('Enter'); await expect(page.locator('.workspace-message.assistant').last()).toContainText('鉴权失败'); await expect(page.locator('body')).not.toContainText('PRIVATE_REFLECTION');
    await expect(page.getByRole('group', { name: '待发送图片' })).toHaveCount(0);
    // Existing capture flow is synthetic; only the selected crop becomes an attachment.
    await app.evaluate(({ desktopCapturer, nativeImage, screen, systemPreferences }) => { systemPreferences.getMediaAccessStatus = () => 'granted'; desktopCapturer.getSources = async options => { const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()), size = options.thumbnailSize!; return [{ id: 'screen:synthetic', name: 'Synthetic', display_id: String(display.id), appIcon: nativeImage.createEmpty(), thumbnail: nativeImage.createFromBuffer(Buffer.alloc(size.width * size.height * 4, 255), size) }]; }; });
    expect((await page.evaluate(() => window.snipvia.capture.start())).ok).toBe(true); await expect(overlay.locator('.screen-frame')).toBeVisible(); await overlay.mouse.move(100, 100); await overlay.mouse.down(); await overlay.mouse.move(350, 260); await overlay.mouse.up();
    await expect.poll(() => app.windows().some(window => window.url().endsWith('#quick-chat'))).toBe(true); const quick = app.windows().find(window => window.url().endsWith('#quick-chat'))!;
    await quick.getByRole('button', { name: '返回软件', exact: true }).click(); await page.getByRole('button', { name: '添加图片', exact: true }).click(); await expect(page.getByRole('button', { name: '使用来源截图' })).toBeVisible();
    await page.getByRole('button', { name: '使用来源截图' }).click(); await expect(page.getByRole('group', { name: '待发送图片' }).locator('img')).toHaveCount(1);
    await imageAction('添加已有截图'); await expect(page.getByRole('dialog', { name: '添加已有截图' })).toContainText('新截图'); await page.getByRole('button', { name: '关闭截图选择' }).click();
    expect(errors).toEqual([]);
    const history = await page.evaluate(id => window.snipvia.history.delete(id), id); expect(history.ok).toBe(true);
    const remaining = await readdir(join(storage, 'history/attachments')); expect(remaining).toHaveLength(0);
  } finally { await app.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); }
});
