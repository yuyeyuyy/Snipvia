import { expect, test } from '@playwright/test';
import { createServer, type ServerResponse } from 'node:http';
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchDesktop } from '../helpers/desktop';
import type { WorkspaceService } from '../../src/main/agent/WorkspaceService';

test('AI confirms each note change before writing and replying, folds directory work into status, and opens actual changes', async () => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(join(tmpdir(), 'snipvia-note-writing-ui-')), root = join(directory, '算法 AI 笔记');
  await mkdir(root); await mkdir(join(root, 'assets')); await writeFile(join(root, '基础.md'), '# 基础\nleft = mid\n');
  let finalReplies = 0, cancelResponse: ServerResponse | undefined;
  const names: string[][] = [];
  const tool = (id: string, name: string, input: unknown) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(input) } });
  const answer = (response: ServerResponse, content: string, calls?: unknown[]) => {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ choices: [{ message: { content, ...(calls ? { tool_calls: calls } : {}) }, finish_reason: calls ? 'tool_calls' : 'stop' }] }));
  };
  const server = createServer((request, response) => {
    let body = ''; request.on('data', chunk => { body += String(chunk); });
    request.on('end', () => { void (async () => {
      const input = JSON.parse(body) as { messages: Array<{ role: string; content: unknown }>; tools: Array<{ function: { name: string } }> };
      const last = input.messages.map(item => item.role).lastIndexOf('user'), turn = input.messages.slice(last), prompt = JSON.stringify(turn[0].content);
      names.push(input.tools.map(tool => tool.function.name));
      if (prompt.includes('不要写入笔记')) { answer(response, '本轮仅解释，不记录笔记。'); return; }
      const results = turn.filter(item => item.role === 'tool');
      if (prompt.includes('写入后等待取消')) {
        if (!results.length) answer(response, '', [tool('late', 'write_note', { path: '取消前的笔记.md', mode: 'create', content: '# 已完成写入\n' })]);
        else { await readFile(join(root, '取消前的笔记.md')); cancelResponse = response; response.setHeader('Content-Type', 'text/event-stream'); response.flushHeaders(); }
        return;
      }
      if (!results.length) answer(response, 'PRIVATE_TOOL_COMMENTARY', [tool('dir', 'list_directory', { path: '.' })]);
      else if (results.length === 1) answer(response, '', [tool('search-files', 'search_files', { name: '二分' })]);
      else if (results.length === 2) answer(response, '', [tool('read-note', 'read_file', { path: '基础.md' })]);
      else if (results.length === 3) answer(response, '', [
        tool('new', 'write_note', { path: '二分查找.md', mode: 'create', content: '# 二分查找\n\n循环需要缩小区间。\nleft = mid + 1\n' }),
        tool('edit', 'edit_note', { path: '基础.md', edits: [{ search: 'left = mid', replace: 'left = mid + 1' }] })
      ]);
      else {
        expect(await readFile(join(root, '二分查找.md'), 'utf8')).toContain('缩小区间');
        expect(await readFile(join(root, '基础.md'), 'utf8')).toContain('mid + 1');
        finalReplies++; answer(response, '已整理二分查找的循环不变式，并更新两篇算法笔记。');
      }
    })().catch(error => { response.statusCode = 500; response.end(JSON.stringify({ error: String(error) })); }); });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('mock server missing');
  const app = await launchDesktop({ args: ['.', `--user-data-dir=${join(directory, 'client')}`], env: { ...process.env, SNIPVIA_CAPTURE_BACKEND: 'electron', SNIPVIA_CAPTURE_WARMUP: '0' } });
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, root);
    await page.getByRole('button', { name: '打开已有笔记本', exact: true }).click();
    await expect(page.getByRole('button', { name: '切换笔记本' })).toContainText('算法 AI 笔记');
    const books = await page.evaluate(() => window.snipvia.notes.state()); if (!books.ok) throw new Error(books.error);
    const bookId = books.value.notebooks[0].id;
    expect((await page.evaluate(async endpoint => {
      const settings = await window.snipvia.settings.get(); if (!settings.ok) throw new Error(settings.error);
      return window.snipvia.settings.save({ ...settings.value, provider: 'custom', endpoint, model: 'mock-notes', apiKey: '' });
    }, `http://127.0.0.1:${address.port}/v1`)).ok).toBe(true);
    await app.evaluate(({ app, desktopCapturer, nativeImage, screen, systemPreferences }) => {
      systemPreferences.getMediaAccessStatus = () => 'granted';
      desktopCapturer.getSources = async options => { const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()), size = options.thumbnailSize!;
        return [{ id: 'screen:synthetic', name: 'Synthetic screen', display_id: String(display.id), appIcon: nativeImage.createEmpty(), thumbnail: nativeImage.createFromBuffer(Buffer.alloc(size.width * size.height * 4, 255), size) }]; };
      const main = `${app.getAppPath()}/out/main/index.js`, exported = process.getBuiltinModule('node:module').createRequire(main)(main);
      const workspaces = exported.agentFileTools.workspaces as WorkspaceService;
      const globals = globalThis as typeof globalThis & { releaseDirectory?: () => void; releaseSearch?: () => void; releaseRead?: () => void; releaseWrite?: () => void };
      let directoryCalls = 0;
      const create = workspaces.createAccess.bind(workspaces);
      workspaces.createAccess = (grant, signal) => { const access = create(grant, signal); return { ...access, listDirectory: async (path, limit) => {
        if (++directoryCalls === 1) await new Promise<void>(resolve => { globals.releaseDirectory = resolve; });
        else if (directoryCalls === 2) await new Promise<void>(resolve => { globals.releaseSearch = resolve; });
        return access.listDirectory(path, limit);
      }, readText: async (path, limit) => { await new Promise<void>(resolve => { globals.releaseRead = resolve; }); return access.readText(path, limit); } }; };
      const commit = workspaces.commitSnapshot.bind(workspaces);
      let heldWrite = false;
      workspaces.commitSnapshot = async (...args) => {
        // Hold only the Agent's first write; later commits (including Undo) pass through.
        if (args[0].path === '二分查找.md' && !heldWrite) { heldWrite = true; await new Promise<void>(resolve => { globals.releaseWrite = resolve; }); }
        return commit(...args);
      };
    });
    const capture = async () => {
      expect((await page.evaluate(() => window.snipvia.capture.start())).ok).toBe(true);
      const overlay = app.windows().find(window => window.url().endsWith('#capture'))!;
      await expect(overlay.locator('.screen-frame')).toBeVisible();
      await overlay.mouse.move(100, 100); await overlay.mouse.down(); await overlay.mouse.move(400, 300); await overlay.mouse.up();
      await expect.poll(() => app.windows().some(window => window.url().endsWith('#quick-chat'))).toBe(true);
      const quick = app.windows().find(window => window.url().endsWith('#quick-chat'))!;
      const current = await quick.evaluate(() => window.snipvia.chat.state()); if (!current.ok) throw new Error(current.error);
      expect((await quick.evaluate(({ captureId, bookId }) => window.snipvia.agent.selectNotebook(captureId, bookId), { captureId: current.value.capture.id, bookId })).ok).toBe(true);
      return quick;
    };
    let quick = await capture();
    await quick.getByLabel('悬浮对话问题').fill('解释二分查找的循环不变式，并整理我的算法学习知识');
    await quick.getByLabel('悬浮对话问题').press('Enter');
    await expect(quick.locator('.agent-run-status')).toHaveText('正在查看目录');
    await expect(quick.locator('.agent-part')).toHaveCount(0);
    await expect(quick.locator('body')).not.toContainText('list_directory');
    await quick.screenshot({ path: 'docs/ui/agent-directory-inline.png' });
    // Simulate a local edit while the Agent is working. Main must flush this
    // draft before taking the note snapshot, and the AI edit must preserve it.
    await page.getByRole('button', { name: '基础', exact: true }).click();
    await page.locator('.cm-content').click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.insertText('\n我自己的复习问题。\n');
    await app.evaluate(() => (globalThis as typeof globalThis & { releaseDirectory(): void }).releaseDirectory());
    await expect(quick.locator('.agent-run-status')).toHaveText('正在搜索文件 二分');
    await expect(quick.locator('.agent-part')).toHaveCount(1); await expect(quick.locator('.agent-part').first()).toContainText('查看目录');
    await quick.screenshot({ path: 'docs/ui/agent-file-search-inline.png' });
    await app.evaluate(() => (globalThis as typeof globalThis & { releaseSearch(): void }).releaseSearch());
    await expect(quick.locator('.agent-run-status')).toHaveText('正在读取文件 基础.md');
    await expect(quick.locator('.agent-part')).toHaveCount(2); await expect(quick.locator('.agent-part').nth(1)).toContainText('搜索文件二分');
    await app.evaluate(() => (globalThis as typeof globalThis & { releaseRead(): void }).releaseRead());
    await expect(quick.locator('.agent-run-status')).toContainText('等待你确认：编辑笔记');
    expect(finalReplies).toBe(0); await expect(quick.getByLabel('已编辑笔记')).toHaveCount(0);
    await quick.screenshot({ path: 'docs/ui/agent-note-writing.png' });
    const confirmNote = async () => {
      const approval = quick.getByRole('group', { name: 'Agent 操作确认', exact: true });
      await expect(approval).toBeVisible();
      await expect(approval.getByRole('button', { name: '本次会话允许' })).toHaveCount(0);
      await approval.getByRole('button', { name: '查看差异', exact: true }).click();
      await expect(quick.getByRole('dialog', { name: '文件修改差异' })).toBeVisible();
      await quick.getByRole('button', { name: '关闭差异', exact: true }).click();
      await approval.getByRole('button', { name: '允许一次', exact: true }).click();
    };
    await expect(quick.getByRole('group', { name: 'Agent 操作确认' })).toBeVisible();
    expect(await readdir(root)).not.toContain('二分查找.md');
    expect(await readFile(join(root, '基础.md'), 'utf8')).not.toContain('mid + 1');
    await confirmNote();
    // The status appears before the hooked commit is reached; wait for the hook itself.
    await expect.poll(() => app.evaluate(() => typeof (globalThis as typeof globalThis & { releaseWrite?: () => void }).releaseWrite)).toBe('function');
    await app.evaluate(() => (globalThis as typeof globalThis & { releaseWrite(): void }).releaseWrite());
    await confirmNote();
    await expect(quick.locator('.agent-answer')).toContainText('更新两篇算法笔记');
    await expect(quick.getByLabel('已编辑笔记')).toContainText('已编辑 2 篇笔记');
    expect(await readFile(join(root, '基础.md'), 'utf8')).toContain('我自己的复习问题。');
    expect(finalReplies).toBe(1); expect(names[0]).toContain('write_note'); expect(names[0]).not.toContain('write_file');
    await expect(quick.locator('body')).not.toContainText('PRIVATE_TOOL_COMMENTARY');
    await quick.getByRole('button', { name: '查看变更', exact: true }).click();
    await expect(quick.getByRole('dialog', { name: '笔记修改记录' })).toContainText('+left = mid + 1');
    await quick.getByRole('button', { name: '关闭笔记修改记录' }).click();
    await quick.screenshot({ path: 'docs/ui/agent-note-changes.png' });
    await quick.getByRole('button', { name: '打开笔记 二分查找.md', exact: true }).click().catch(error => { if (!quick.isClosed()) throw error; });
    await expect(page.getByRole('button', { name: 'AI 笔记', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('.cm-content')).toContainText('缩小区间');
    const history = JSON.parse(await readFile(join(directory, 'client/history/conversations.json'), 'utf8'));
    expect(history[0].messages.at(-1).noteChanges).toHaveLength(2);
    await page.getByRole('button', { name: '历史对话', exact: true }).click();
    await page.evaluate(async id => { const result = await window.snipvia.history.open(id); if (!result.ok) throw new Error(result.error); }, history[0].id);
    await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.getAllWindows().find(window => !window.webContents.getURL().includes('#'))!.webContents.send('capture:resume-conversation', id), history[0].id);
    await expect(page.getByLabel('已编辑笔记')).toContainText('已编辑 2 篇笔记');
    // Undo works from history too: the checkpoint is persisted, not kept in memory.
    const changes = page.getByLabel('已编辑笔记');
    await changes.getByRole('button', { name: '撤销', exact: true }).click();
    await expect(changes.getByRole('group', { name: '确认撤销笔记修改' })).toContainText('新建的笔记会被删除');
    await page.screenshot({ path: 'docs/ui/agent-note-undo.png' });
    await changes.getByRole('button', { name: '确认撤销', exact: true }).click();
    await expect(changes.getByRole('status')).toContainText('已撤销，恢复了 2 篇笔记');
    expect(await readdir(root)).not.toContain('二分查找.md');
    // Restored to the snapshot taken after the user's unsaved draft was flushed, so the draft survives.
    const restored = await readFile(join(root, '基础.md'), 'utf8');
    expect(restored).toContain('我自己的复习问题。'); expect(restored).toContain('left = mid\n'); expect(restored).not.toContain('mid + 1');
    await expect(changes.getByRole('button', { name: '撤销', exact: true })).toHaveCount(0);

    quick = await capture();
    await quick.getByLabel('悬浮对话问题').fill('不要写入笔记，仅聊天');
    await quick.getByLabel('悬浮对话问题').press('Enter');
    await expect(quick.locator('.agent-answer')).toContainText('不记录笔记');
    expect(names.at(-1)).not.toContain('write_note');
    await expect(quick.getByLabel('已编辑笔记')).toHaveCount(0);
    await quick.getByLabel('悬浮对话问题').fill('写入后等待取消');
    await quick.getByLabel('悬浮对话问题').press('Enter');
    await confirmNote();
    await expect.poll(() => !!cancelResponse).toBe(true);
    await quick.getByRole('button', { name: '停止执行', exact: true }).click();
    await expect(quick.getByLabel('已编辑笔记')).toContainText('取消前的笔记.md');
    expect(await readFile(join(root, '取消前的笔记.md'), 'utf8')).toBe('# 已完成写入\n');
    cancelResponse?.destroy();
    // A stopped run still gets a checkpoint for what it actually wrote.
    const partial = quick.getByLabel('已编辑笔记').last();
    await partial.getByRole('button', { name: '撤销', exact: true }).click();
    await partial.getByRole('button', { name: '确认撤销', exact: true }).click();
    await expect(partial.getByRole('status')).toContainText('已撤销');
    expect(await readdir(root)).not.toContain('取消前的笔记.md');
  } finally {
    cancelResponse?.destroy(); await app.close(); await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
