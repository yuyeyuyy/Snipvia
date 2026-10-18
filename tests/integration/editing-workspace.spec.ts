import { expect, test } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { launchDesktop } from '../helpers/desktop';
import { visionTestImage } from '../../src/main/ai/models/vision-test';

test('notes save without approval and retain diff/undo, rules still require review and Main IPC stays isolated', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'snipvia-editing-ui-')); const root = join(directory, '算法'); await mkdir(root);
  const original = '# 二分查找\n\nleft = mid\n'; await writeFile(join(root, '二分.md'), original);
  await writeFile(join(root, '其他.md'), 'PRIVATE_OTHER_NOTE_DO_NOT_SEND');
  const bodies: string[] = [];
  const server = createServer((request, response) => {
    let raw = ''; request.on('data', data => { raw += data.toString(); });
    request.on('end', () => {
      bodies.push(raw); const body = JSON.parse(raw) as { messages: Array<{ role: string; content: string }>; tools: Array<{ function: { name: string } }> };
      const lastUser = body.messages.map(message => message.role).lastIndexOf('user'); const content = body.messages[lastUser].content;
      const question = typeof content === 'string' ? content : (content as Array<{ type: string; text: string }>).find(part => part.type === 'text')!.text;
      const tools = body.messages.slice(lastUser).filter(message => message.role === 'tool');
      const advertised = body.tools.map(tool => tool.function.name);
      expect(advertised).not.toContain('run_command'); expect(advertised).not.toContain('write_note'); expect(advertised).not.toContain('web_search');
      response.setHeader('Content-Type', 'application/json');
      if (question.includes('只总结')) { response.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '这里只总结，不创建修改提案。' } }] })); return; }
      let call: { name: string; arguments: string } | undefined;
      if (!tools.length) call = { name: 'read_edit_context', arguments: '{}' };
      else if (tools.length === 1) call = question.includes('分支') ? { name: 'propose_branch_changes', arguments: JSON.stringify({ operations: [{ op: 'update', id: 'explain-code', patch: { label: '算法代码讲解', applicableContent: '算法与数据结构代码', prompt: '解释算法，突出边界情况。' } }, { op: 'create', branch: { label: '复杂度分析', runningLabel: '正在分析复杂度…', trigger: 'code', prompt: '分析代码的时间与空间复杂度。', enabled: true } }] }) }
        : { name: 'propose_note_change', arguments: JSON.stringify({ path: '二分.md', mode: 'edit', edits: [{ search: 'left = mid', replace: 'left = mid + 1' }] }) };
      response.end(JSON.stringify({ choices: [{ finish_reason: call ? 'tool_calls' : 'stop', message: call ? { content: null, tool_calls: [{ id: `call_${bodies.length}`, type: 'function', function: call }] } : { content: question.includes('分支') ? '规则建议已准备好，请查看差异后确认。' : '笔记已保存，可以查看变更或撤销。' } }] }));
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); if (!address || typeof address === 'string') throw new Error('mock server unavailable');
  const storage = join(directory, 'app'); const app = await launchDesktop({ args: ['.', `--user-data-dir=${storage}`], env: { ...process.env, SNIPVIA_CAPTURE_BACKEND: 'electron', SNIPVIA_CAPTURE_WARMUP: '0' } });
  try {
    const page = await app.firstWindow(); const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await app.evaluate(({ dialog }, root) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] }); }, root);
    await page.getByRole('button', { name: '打开已有笔记本', exact: true }).click();
    await page.getByRole('button', { name: '二分', exact: true }).click(); await expect(page.locator('.cm-content')).toContainText('left = mid');
    expect((await page.evaluate(async endpoint => { const config = await window.snipvia.settings.get(); if (!config.ok) throw new Error(config.error); return window.snipvia.settings.save({ ...config.value, provider: 'custom', model: 'mock-editor', endpoint, apiKey: 'test-key' }); }, `http://127.0.0.1:${address.port}/v1`)).ok).toBe(true);
    const beforeSettings = await page.evaluate(() => window.snipvia.settings.get()); if (!beforeSettings.ok) throw new Error(beforeSettings.error);
    await page.getByRole('button', { name: '与 AI 讨论', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'AI 对话', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '算法 / 二分.md', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '算法 / 二分.md', exact: true }).click();
    await expect(page.getByLabel('编辑上下文笔记', { exact: true })).toHaveValue('二分.md');
    await page.getByRole('dialog', { name: '选择编辑上下文' }).getByRole('button', { name: '取消', exact: true }).click();
    const noteId = await page.getByLabel('选择对话', { exact: true }).inputValue();
    // Attach the registered image to this turn through the same public start API; no direct file write.
    const pictures = await page.evaluate(async ({ id, encoded }) => window.snipvia.chatImages.import(id, [{ name: '算法图.png', bytes: Uint8Array.from(atob(encoded), char => char.charCodeAt(0)) }]), { id: noteId, encoded: visionTestImage });
    if (!pictures.ok) throw new Error(pictures.error);
    expect((await page.evaluate(({ id, imageId }) => window.snipvia.agent.workspaceStart(id, '整理这篇笔记中的边界错误', false, [imageId]), { id: noteId, imageId: pictures.value[0].id })).ok).toBe(true);
    const pending = () => page.locator('.editing-proposal[data-status="pending"]');
    await expect(page.locator('.editing-proposal[data-status="applied"]')).toContainText('二分.md');
    await expect.poll(() => readFile(join(root, '二分.md'), 'utf8')).toBe('# 二分查找\n\nleft = mid + 1\n');
    await expect(page.locator('.workspace-message.assistant').last()).toContainText('笔记已保存');
    await expect(pending()).toHaveCount(0);
    await expect(page.getByRole('group', { name: 'Agent 操作确认' })).toHaveCount(0);
    expect(bodies[0]).toContain('image_url'); expect(bodies.join('\n')).not.toContain('PRIVATE_OTHER_NOTE_DO_NOT_SEND');
    await page.getByRole('button', { name: '查看变更', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '笔记修改记录' })).toContainText('+left = mid + 1');
    await mkdir('docs/ui/chat-controls', { recursive: true });
    for (const theme of ['light', 'dark'] as const) {
      expect((await page.evaluate(theme => window.snipvia.appearance.set(theme), theme)).ok).toBe(true);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme); await page.mouse.move(0, 0);
      await page.screenshot({ path: 'docs/ui/chat-controls/note-saved-' + theme + '.png' });
    }
    await page.getByRole('button', { name: '关闭笔记修改记录', exact: true }).click();
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    await page.getByRole('button', { name: '确认撤销', exact: true }).click();
    await expect.poll(() => readFile(join(root, '二分.md'), 'utf8')).toBe(original);
    await expect(page.getByText('已撤销，恢复了 1 篇笔记')).toBeVisible();
    await page.getByRole('button', { name: '查看笔记', exact: true }).click(); await expect(page.locator('.cm-content')).toContainText('left = mid');
    await page.getByRole('button', { name: '模型与设置', exact: true }).click();
    await page.getByRole('button', { name: '编辑解释代码', exact: true }).click(); await page.getByRole('button', { name: '用 AI 编辑已保存分支', exact: true }).click();
    await expect(page.getByRole('button', { name: '预测分支 / 解释代码', exact: true })).toBeVisible();
    const keyFileBefore = JSON.parse(await readFile(join(storage, 'settings.json'), 'utf8'));
    await page.getByLabel('AI 对话输入').fill('为这个分支补充复杂度分析，并优化说明'); await page.getByLabel('AI 对话输入').press('Enter'); await expect(pending()).toContainText('截图预测规则');
    const unsaved = await page.evaluate(() => window.snipvia.settings.get()); expect(unsaved.ok && unsaved.value.predictionBranches).toEqual(beforeSettings.value.predictionBranches);
    await pending().getByRole('button', { name: '查看修改' }).click(); await expect(page.getByRole('dialog', { name: '修改预览' })).toContainText('复杂度分析');
    await page.screenshot({ path: 'docs/ui/chat-workspace-phase3/branch-preview-dark.png' });
    await page.getByRole('button', { name: '确认并保存', exact: true }).click();
    await expect(page.locator('.editing-proposal[data-status="applied"]')).toContainText('修改已保存');
    const updated = await page.evaluate(() => window.snipvia.settings.get()); if (!updated.ok) throw new Error(updated.error);
    expect(updated.value.predictionBranches).toHaveLength(5); expect(updated.value.predictionBranches.find(branch => branch.id === 'explain-code')?.label).toBe('算法代码讲解');
    const keyFileAfter = JSON.parse(await readFile(join(storage, 'settings.json'), 'utf8')); expect(keyFileAfter.encryptedKeys).toEqual(keyFileBefore.encryptedKeys); expect(keyFileAfter.appearance).toEqual(keyFileBefore.appearance);
    expect(updated.value.endpoint).toBe(beforeSettings.value.endpoint); expect(updated.value.shortcut).toBe(beforeSettings.value.shortcut);
    const conversationId = await page.getByLabel('选择对话', { exact: true }).inputValue();
    const overlay = app.windows().find(window => window.url().endsWith('#capture'))!;
    const denied = await overlay.evaluate(id => window.snipvia.editing.select(id, { kind: 'branches', branchIds: [] }), conversationId); expect(denied).toMatchObject({ ok: false, error: '不允许的窗口请求' });
    expect((await page.evaluate(id => window.snipvia.editing.apply(id, crypto.randomUUID(), 'a'.repeat(64)), conversationId)).ok).toBe(false);
    await page.getByLabel('AI 对话输入').fill('只总结这些分支'); await page.getByLabel('AI 对话输入').press('Enter');
    await expect(page.locator('.workspace-message.assistant').last()).toContainText('这里只总结'); expect(await readFile(join(root, '其他.md'), 'utf8')).toBe('PRIVATE_OTHER_NOTE_DO_NOT_SEND');
    expect(errors).toEqual([]);
  } finally { await app.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); }
});
