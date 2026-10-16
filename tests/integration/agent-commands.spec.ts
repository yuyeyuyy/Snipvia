import { _electron as electron, expect, test } from '@playwright/test';
import { createServer, type ServerResponse } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchMemberDesktop } from '../helpers/desktop-account';
import type { CommandRunner } from '../../src/main/agent/commands/CommandRunner';

test('organize commands run directly, scripts wait for inline approval, and Stop preserves actual changes', async () => {
  test.skip(!!process.env.SNIPVIA_TEST_APP_BINARY, 'Packaged validation uses a local Main-only fixture without calling the production account server.');
  test.setTimeout(60_000);
  const directory = await mkdtemp(join(tmpdir(), 'snipvia-commands-ui-')), root = join(directory, '算法 AI 笔记');
  await mkdir(root); await mkdir(join(root, 'assets')); await writeFile(join(root, '二分查找.md'), '# 二分查找\nleft = mid\n');
  let finalReplies = 0;
  const tool = (id: string, name: string, input: unknown) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(input) } });
  const answer = (response: ServerResponse, content: string, calls?: unknown[]) => {
    response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ choices: [{ message: { content, ...(calls ? { tool_calls: calls } : {}) }, finish_reason: calls ? 'tool_calls' : 'stop' }] }));
  };
  const server = createServer((request, response) => {
    let body = ''; request.on('data', chunk => { body += String(chunk); }); request.on('end', () => { void (async () => {
      const input = JSON.parse(body) as { messages: Array<{ role: string; content: unknown }>; tools: Array<{ function: { name: string } }> };
      const last = input.messages.map(item => item.role).lastIndexOf('user'), turn = input.messages.slice(last), prompt = JSON.stringify(turn[0].content), results = turn.filter(item => item.role === 'tool');
      expect(input.tools.map(tool => tool.function.name)).toContain('run_command');
      if (prompt.includes('停止测试')) {
        if (!results.length) answer(response, '', [tool('cancel', 'run_command', { command: "printf '# 已完成\\n' > '停止前.md'; (sleep 2; printf bad > '不应存在.md') & wait" })]);
        else answer(response, '不应继续回复'); return;
      }
      if (!results.length) answer(response, '', [tool('move', 'run_command', { command: "mkdir -p '算法题目' && mv -n '二分查找.md' '算法题目/二分查找.md'" })]);
      else if (results.length === 1) answer(response, '', [tool('script', 'run_script', { language: 'javascript', code: "import { writeFileSync } from 'node:fs';\nconsole.log([1, 3, 5].indexOf(3));\nwriteFileSync('算法题目/算法验证.md', '# 算法验证\\n\\n返回下标 1。\\n');" })]);
      else {
        expect(await readFile(join(root, '算法题目/算法验证.md'), 'utf8')).toContain('返回下标 1');
        expect(await readFile(join(root, '算法题目/二分查找.md'), 'utf8')).toContain('left = mid');
        expect(results.map(result => JSON.parse(String(result.content)).success)).toEqual([true, true]); finalReplies++; answer(response, '已创建算法题目目录，移动二分查找笔记，并运行脚本验证算法。');
      }
    })().catch(error => { response.statusCode = 500; response.end(JSON.stringify({ error: String(error) })); }); });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); if (!address || typeof address === 'string') throw new Error('missing server');
  const app = await launchMemberDesktop({ args: ['.', `--user-data-dir=${join(directory, 'client')}`], env: { ...process.env, SNIPVIA_CAPTURE_BACKEND: 'electron', SNIPVIA_CAPTURE_WARMUP: '0' } });
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, root);
    await page.getByRole('button', { name: '打开已有笔记本', exact: true }).click();
    const books = await page.evaluate(() => window.snipvia.notes.state()); if (!books.ok) throw new Error(books.error); const bookId = books.value.notebooks[0].id;
    await page.evaluate(async endpoint => {
      const settings = await window.snipvia.settings.get(); if (!settings.ok) throw new Error(settings.error);
      const saved = await window.snipvia.settings.save({ ...settings.value, provider: 'custom', endpoint, model: 'mock-commands', apiKey: '' }); if (!saved.ok) throw new Error(saved.error);
    }, `http://127.0.0.1:${address.port}/v1`);
    await app.evaluate(({ app, desktopCapturer, nativeImage, screen, systemPreferences }) => {
      systemPreferences.getMediaAccessStatus = () => 'granted';
      desktopCapturer.getSources = async options => { const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()), size = options.thumbnailSize!;
        return [{ id: 'screen:synthetic', name: 'Synthetic screen', display_id: String(display.id), appIcon: nativeImage.createEmpty(), thumbnail: nativeImage.createFromBuffer(Buffer.alloc(size.width * size.height * 4, 255), size) }]; };
      const main = `${app.getAppPath()}/out/main/index.js`, exported = process.getBuiltinModule('node:module').createRequire(main)(main), runner = exported.agentFileTools.commandRunner as CommandRunner;
      const run = runner.run.bind(runner); let calls = 0;
      runner.run = async (...args) => {
        if (++calls <= 2) await new Promise<void>(resolve => { (globalThis as typeof globalThis & { releaseCommand?: () => void }).releaseCommand = resolve; });
        return run(...args);
      };
    });
    expect((await page.evaluate(() => window.snipvia.capture.start())).ok).toBe(true);
    const overlay = app.windows().find(window => window.url().endsWith('#capture'))!; await expect(overlay.locator('.screen-frame')).toBeVisible();
    await overlay.mouse.move(100, 100); await overlay.mouse.down(); await overlay.mouse.move(400, 300); await overlay.mouse.up();
    await expect.poll(() => app.windows().some(window => window.url().endsWith('#quick-chat'))).toBe(true);
    const quick = app.windows().find(window => window.url().endsWith('#quick-chat'))!;
    const current = await quick.evaluate(() => window.snipvia.chat.state()); if (!current.ok) throw new Error(current.error);
    expect((await quick.evaluate(({ captureId, bookId }) => window.snipvia.agent.selectNotebook(captureId, bookId), { captureId: current.value.capture.id, bookId })).ok).toBe(true);
    await quick.getByLabel('悬浮对话问题').fill('创建算法题目目录，移动二分查找笔记，再执行脚本验证算法并记录结果'); await quick.getByLabel('悬浮对话问题').press('Enter');
    // mkdir -p / mv -n inside the notebook is a notebook edit: no approval, one timeline row.
    await expect(quick.locator('.agent-run-status')).toHaveText('正在执行命令'); expect(finalReplies).toBe(0);
    await expect(quick.locator('.agent-part')).toHaveCount(0); // The live action is the status line only.
    await expect(quick.getByRole('group', { name: 'Agent 操作确认' })).toHaveCount(0);
    await quick.screenshot({ path: 'docs/ui/agent-command-inline.png' });
    await app.evaluate(() => (globalThis as typeof globalThis & { releaseCommand(): void }).releaseCommand());
    // Scripts always wait for the user, inline in the timeline; Enter must not approve.
    const approval = quick.getByRole('group', { name: 'Agent 操作确认' });
    await expect(quick.locator('.agent-run-status')).toContainText('等待你确认：运行脚本');
    await expect(approval).toContainText('Agent 希望运行此 JavaScript 脚本'); await expect(approval.getByLabel('脚本内容')).toContainText('indexOf(3)');
    await expect(quick.locator('.agent-part')).toHaveCount(2); await expect(quick.locator('.agent-part').first()).toContainText("执行命令$ mkdir -p '算法题目'");
    await expect(approval.getByRole('button', { name: '运行', exact: true })).toBeInViewport();
    await quick.screenshot({ path: 'docs/ui/agent-command-approval.png' });
    await quick.keyboard.press('Enter'); await expect(approval).toBeVisible();
    await approval.getByRole('button', { name: '运行', exact: true }).click();
    await expect(quick.locator('.agent-run-status')).toHaveText('正在运行 JavaScript 脚本');
    await expect(quick.getByLabel('已编辑笔记')).toHaveCount(0); expect(finalReplies).toBe(0);
    await app.evaluate(() => (globalThis as typeof globalThis & { releaseCommand(): void }).releaseCommand());
    await expect(quick.locator('.agent-answer')).toContainText('运行脚本验证算法');
    // Finished runs fold their steps into one summary row.
    await expect(quick.getByRole('button', { name: '已执行 2 个步骤' })).toHaveAttribute('aria-expanded', 'false');
    await expect(quick.getByLabel('已编辑笔记')).toContainText('已编辑 2 篇笔记'); await expect(quick.getByLabel('已编辑笔记')).toContainText('二分查找.md → 算法题目/二分查找.md');
    await quick.getByRole('button', { name: '查看变更', exact: true }).click(); await expect(quick.getByRole('dialog', { name: '笔记修改记录' })).toContainText('rename from 二分查找.md');
    await quick.getByRole('button', { name: '关闭笔记修改记录' }).click(); await quick.screenshot({ path: 'docs/ui/agent-command-changes.png' });
    await quick.getByLabel('悬浮对话问题').fill('停止测试'); await quick.getByLabel('悬浮对话问题').press('Enter');
    await quick.getByRole('group', { name: 'Agent 操作确认' }).getByRole('button', { name: '运行', exact: true }).click();
    await expect.poll(async () => (await readdir(root)).includes('停止前.md')).toBe(true); await quick.getByRole('button', { name: '停止执行', exact: true }).click();
    await expect(quick.getByLabel('已编辑笔记').last()).toContainText('停止前.md'); await new Promise(resolve => setTimeout(resolve, 2200)); expect(await readdir(root)).not.toContain('不应存在.md');
    await quick.getByRole('button', { name: '打开笔记 算法题目/算法验证.md', exact: true }).click().catch(error => { if (!quick.isClosed()) throw error; });
    await expect(page.locator('.cm-content')).toContainText('返回下标 1');
    const history = JSON.parse(await readFile(join(directory, 'client/history/conversations.json'), 'utf8'));
    expect(history[0].messages.find((message: { role: string; noteChanges?: unknown[] }) => message.role === 'assistant' && message.noteChanges?.length === 2).noteChanges).toHaveLength(2);
  } finally { await app.close(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); }
});

if (process.env.SNIPVIA_TEST_APP_BINARY) test('packaged ASAR loads sandbox dependencies and executes its own Node runtime', async () => {
  test.setTimeout(45_000);
  const directory = await mkdtemp(join(tmpdir(), 'snipvia-packaged-commands-')), root = join(directory, '临时算法笔记'); await mkdir(root);
  const app = await electron.launch({ executablePath: process.env.SNIPVIA_TEST_APP_BINARY, args: ['--snipvia-packaged-test', `--user-data-dir=${join(directory, 'client')}`],
    env: { ...process.env, SNIPVIA_CAPTURE_BACKEND: 'electron', SNIPVIA_CAPTURE_WARMUP: '0' } });
  try {
    await app.firstWindow();
    const results = await app.evaluate(async ({ app }, root) => {
      const main = `${app.getAppPath()}/out/main/index.js`, exported = process.getBuiltinModule('node:module').createRequire(main)(main);
      const book = await exported.notebooks.open(root), system = exported.agentFileTools;
      // Supply synthetic qualification locally; never sign in or send email to
      // the production service merely to validate a packaged command runtime.
      system.noteWriter.deps.beforeWrite = async () => {};
      const grant = await system.workspaces.authorizeWorkspace(book.directory), scope = system.noteWriter.createScope(book, grant);
      try {
        // A literal organize command needs no approval; the script checks the packaged Node
        // runtime directly through the runner, since approval UI is covered by the dev spec.
        const moved = await system.executor.execute({ id: 'mkdir', name: 'run_command', input: { command: "mkdir -p '算法题目' && touch '算法题目/说明.md'" } }, { workspace: grant, commandScope: scope });
        const script = await system.commandRunner.run(scope, { kind: 'script', language: 'javascript', cwd: '.', timeoutMs: 10_000, code: "import { writeFileSync } from 'node:fs'; console.log(2 + 2); writeFileSync('算法题目/验证.md', '# 验证\\n返回 4。\\n');" }, new AbortController().signal, 10_000);
        return { packaged: app.isPackaged, executable: process.execPath, moved, script };
      } finally { system.noteWriter.closeScope(scope); system.workspaces.revoke(grant); }
    }, root);
    expect(results).toMatchObject({ packaged: true, moved: { success: true }, script: { success: true, output: { stdout: '4\n' } } });
    expect(await readFile(join(root, '算法题目/验证.md'), 'utf8')).toContain('返回 4');
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});
