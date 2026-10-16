import { tokenColor } from '../helpers/appearance';
import { launchDesktop } from '../helpers/desktop';
import { expect, test } from '@playwright/test';
import { createServer, type ServerResponse } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { registerWebTools } from '../../src/main/agent/registerWebTools';

test('prediction precedes Agent, web activity is inline, answers stream and Stop survives handoff', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'snipvia-agent-chat-'));
  let classifier: ServerResponse | undefined; let agentRequests = 0; let classifierRequests = 0;
  let explicitPromptReceived = false;
  let answerStream: ServerResponse | undefined; let cancelledStream = false;
  const deltaEvent = (content: string, finish_reason: string | null = null) => `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason }] })}\n\n`;
  const advertised: string[][] = [];
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    request.on('end', () => {
      if (body.includes('You are a screenshot classifier')) { classifierRequests++; classifier = response; return; }
      const input = JSON.parse(body) as { messages: Array<{ role: string; content: unknown }>; tools: Array<{ function: { name: string } }> };
      agentRequests++; advertised.push(input.tools.map((tool) => tool.function.name));
      const lastUser = input.messages.map((item) => item.role).lastIndexOf('user');
      const turn = input.messages.slice(lastUser);
      if (JSON.stringify(turn[0].content).includes('只提取标题，不要分析代码')) {
        explicitPromptReceived = true;
        expect(body).not.toContain('截图分支预测（仅供参考）');
        response.setHeader('Content-Type', 'text/event-stream');
        response.end(deltaEvent('已按提示词提取标题。', 'stop') + 'data: [DONE]\n\n');
        return;
      }
      if (JSON.stringify(turn[0].content).includes('等待取消')) {
        response.setHeader('Content-Type', 'text/event-stream');
        response.write(deltaEvent('这是一段尚未完成的回答'));
        response.on('close', () => { cancelledStream = true; });
        return;
      }
      const count = turn.filter((item) => item.role === 'tool').length;
      const tool = count === 0 ? { id: `search_${lastUser}`, type: 'function', function: { name: 'web_search', arguments: '{"query":"Electron desktopCapturer"}' } }
        : count === 1 ? { id: `fetch_${lastUser}`, type: 'function', function: { name: 'fetch_url', arguments: '{"url":"https://example.com/docs"}' } } : undefined;
      response.setHeader('Content-Type', 'text/event-stream');
      if (tool) {
        const delta = { content: 'PRIVATE_INTERNAL_TEXT', reasoning_content: 'PRIVATE_REASONING', tool_calls: [{ index: 0, ...tool }] };
        response.end(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: 'tool_calls' }] })}\n\ndata: [DONE]\n\n`);
      } else {
        answerStream = response;
        response.write(deltaEvent('<thi'));
        response.write(deltaEvent('nk>PRIVATE_REASONING</think>已联网核实'));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('mock server unavailable');
  const app = await launchDesktop({ args: ['.', `--user-data-dir=${directory}`],
    env: { ...process.env, SNIPVIA_CAPTURE_BACKEND: 'electron', SNIPVIA_CAPTURE_WARMUP: '0' } });
  try {
    const page = await app.firstWindow(); const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await expect(page.getByRole('button', { name: 'AI 笔记', exact: true })).toHaveAttribute('aria-current', 'page');
    const saved = await page.evaluate(async (endpoint) => {
      const settings = await window.snipvia.settings.get(); if (!settings.ok) throw new Error(settings.error);
      return window.snipvia.settings.save({ ...settings.value, provider: 'custom', endpoint, model: 'mock-agent', apiKey: '' });
    }, `http://127.0.0.1:${address.port}/v1`);
    expect(saved.ok).toBe(true);
    // Mock the external web service only; Runtime, tools, permissions and IPC remain real.
    await app.evaluate(({ app, desktopCapturer, nativeImage, screen, systemPreferences, shell }) => {
      const mainFile = `${app.getAppPath()}/out/main/index.js`;
      const exported = process.getBuiltinModule('node:module').createRequire(mainFile)(mainFile);
      const web = exported.agentWebTools as ReturnType<typeof registerWebTools>;
      exported.agentSourceIcons.get = async () => nativeImage.createFromBitmap(Buffer.from([200, 110, 60, 255]), { width: 1, height: 1 }).toDataURL();
      shell.openExternal = async (url) => { (globalThis as typeof globalThis & { openedSource?: string }).openedSource = url; };
      const gates = globalThis as typeof globalThis & { releaseSearch(): void; releaseFetch(): void };
      web.search.search = async () => {
        await new Promise<void>((resolve) => { gates.releaseSearch = resolve; });
        return { results: [
          { title: 'Electron API', url: 'https://example.com/docs', snippet: 'Synthetic documentation', publishedAt: '2026-09-15' },
          { title: 'ScreenCaptureKit · Apple Developer Documentation', url: 'https://developer.apple.com/documentation/screencapturekit', snippet: '合成搜索摘要：通过系统框架获取屏幕内容，检查显示器、权限和像素尺寸。' },
          { title: 'Desktop capture discussion · GitHub', url: 'https://github.com/electron/electron/issues', snippet: '合成搜索摘要：应用在不同系统版本上的屏幕截图表现和问题讨论。' },
          { title: 'Chromium rendering documentation', url: 'https://chromium.org/developers', snippet: 'Synthetic rendering reference' },
          { title: 'Electron BrowserWindow', url: 'https://example.com/window', snippet: 'Synthetic window documentation' },
          { title: 'Electron security checklist', url: 'https://example.com/security', snippet: 'Synthetic security documentation' }
        ] };
      };
      web.pages.fetch = async (_url, scope) => {
        await new Promise<void>((resolve) => { gates.releaseFetch = resolve; });
        return web.pages.contents.put(scope, { url: 'https://example.com/docs', title: 'Electron API', text: 'Synthetic page content', contentType: 'text/html', charset: 'utf-8', downloadedBytes: 22, decodedBytes: 22, extractionTruncated: false });
      };
      systemPreferences.getMediaAccessStatus = () => 'granted';
      desktopCapturer.getSources = async (options) => {
        const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()); const size = options.thumbnailSize!;
        return [{ id: 'screen:mock', name: 'Synthetic screen', display_id: String(display.id), appIcon: nativeImage.createEmpty(),
          thumbnail: nativeImage.createFromBuffer(Buffer.alloc(size.width * size.height * 4, 255), size) }];
      };
    });
    expect((await page.evaluate(() => window.snipvia.capture.start())).ok).toBe(true);
    await expect.poll(() => app.windows().some((window) => window.url().endsWith('#capture'))).toBe(true);
    const overlay = app.windows().find((window) => window.url().endsWith('#capture'))!;
    await expect(overlay.locator('.screen-frame')).toBeVisible();
    await overlay.mouse.move(100, 100); await overlay.mouse.down(); await overlay.mouse.move(400, 300); await overlay.mouse.up();
    await expect.poll(() => app.windows().some((window) => window.url().endsWith('#quick-chat'))).toBe(true);
    const quick = app.windows().find((window) => window.url().endsWith('#quick-chat'))!;
    quick.on('pageerror', (error) => errors.push(error.message));
    await expect(quick.getByText('按 Enter，开始智能分析')).toBeVisible();
    await expect(quick.getByLabel('悬浮对话问题')).toBeFocused();
    await expect(quick.locator('.agent-run-status')).toHaveCount(0);
    await expect(quick.locator('.quick-chat-header').getByLabel('预测分支')).toHaveCount(0);
    await expect(quick.getByRole('button', { name: 'Agent', exact: true })).toHaveCount(0);
    await expect(quick.getByText('联网 · 只读', { exact: true })).toHaveCount(0);
    await expect(quick.getByText('本地文件需授权', { exact: true })).toHaveCount(0);
    await expect(quick.locator('.quick-workspace-row').getByRole('button', { name: '选择笔记' })).toBeVisible();
    await expect(quick.locator('.quick-composer .agent-workspace')).toHaveCount(0);
    await expect(quick.locator('.quick-composer-footer').getByLabel('悬浮对话模型')).toBeVisible();
    await expect(quick.getByLabel('悬浮对话模型').locator('option:checked')).toHaveText('mock-agent');
    await expect(quick.locator('.quick-composer .model-dot')).toHaveCount(0);
    await expect(quick.locator('.quick-composer')).not.toContainText('发送 ·');
    await expect(quick.locator('.quick-composer')).toHaveCSS('border-top-color', await tokenColor(quick.locator('.quick-composer'), 'focus'));
    await expect(quick.getByLabel('悬浮对话问题')).toHaveCSS('outline-style', 'none');
    await expect(quick.getByRole('button', { name: '开始分析', exact: true })).toHaveCSS('border-radius', '50%');
    await quick.getByLabel('悬浮对话问题').evaluate((element) => element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })));
    await quick.getByLabel('悬浮对话问题').press('Shift+Enter');
    expect(classifierRequests).toBe(0); expect(agentRequests).toBe(0);
    const initial = await quick.evaluate(async () => {
      const state = await window.snipvia.chat.state(); if (!state.ok) throw new Error(state.error);
      const report = await window.snipvia.performance.report(state.value.performanceSessionId!);
      return { state: state.value.autoAction?.state, events: report.ok ? report.value?.marks.map((mark) => mark.event) : [] };
    });
    expect(initial.state).toBe('awaiting_input');
    expect(initial.events).not.toContain('auto_analysis_start');
    expect(initial.events).not.toContain('local_ocr_start');
    await quick.getByLabel('悬浮对话问题').fill('');
    await quick.screenshot({ path: 'docs/ui/agent-awaiting-input.png' });
    // The workspace, model and send control remain reachable at the window's minimum size.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().endsWith('#quick-chat'))!.setSize(340, 360));
    await expect(quick.getByRole('button', { name: '开始分析', exact: true })).toBeInViewport();
    await expect(quick.getByLabel('悬浮对话模型')).toBeInViewport();
    await expect(quick.getByRole('button', { name: '选择笔记' })).toBeInViewport();
    await quick.screenshot({ path: 'docs/ui/agent-awaiting-input-compact.png' });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().endsWith('#quick-chat'))!.setSize(390, 520));
    await quick.getByLabel('悬浮对话问题').press('Enter');
    await expect(quick.locator('.agent-run-status')).toHaveText('正在预测分支');
    await expect(quick.getByLabel('预测分支')).toHaveCount(0);
    await expect(quick.locator('.quick-auto-bar')).toHaveCount(0);
    await expect(quick.getByRole('combobox', { name: '截图操作' })).toHaveCount(0);
    expect(await quick.evaluate(() => 'select' in window.snipvia.autoAction)).toBe(false);
    await quick.screenshot({ path: 'docs/ui/agent-prediction-inline.png' });
    await expect(quick.getByRole('button', { name: '停止执行', exact: true })).toHaveCSS('border-radius', '50%');
    await expect(quick.getByRole('button', { name: '停止执行', exact: true })).toHaveText('');
    await expect(quick.getByRole('button', { name: '停止执行', exact: true }).locator('svg rect')).toHaveCount(1);
    await expect.poll(() => !!classifier).toBe(true); expect(agentRequests).toBe(0);
    await quick.evaluate(async () => {
      const state = await window.snipvia.chat.state(); if (!state.ok) throw new Error(state.error);
      await Promise.all([window.snipvia.autoAction.start(state.value.capture.id), window.snipvia.autoAction.start(state.value.capture.id)]);
    });
    expect(classifierRequests).toBe(1);
    classifier!.setHeader('Content-Type', 'application/json');
    classifier!.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ contentType: 'code', confidence: 0.95, matchedBranchId: 'explain-code', signals: { hasCode: true } }) } }] }));
    await expect(quick.locator('.quick-chat-header').getByLabel('预测分支')).toHaveText('解释代码');
    await expect(quick.getByLabel('预测分支')).not.toHaveAttribute('role', 'button');
    await expect(quick.locator('.agent-run-status')).toHaveText('正在联网搜索 Electron desktopCapturer');
    await expect(quick.locator('.agent-part')).toHaveCount(0);
    await app.evaluate(() => (globalThis as typeof globalThis & { releaseSearch(): void }).releaseSearch());
    await expect(quick.locator('.agent-run-status')).toHaveText('正在读取 example.com');
    await expect(quick.locator('.agent-part')).toHaveCount(1); await expect(quick.locator('.agent-part').first()).toContainText('搜索网页“Electron desktopCapturer”');
    await quick.screenshot({ path: 'docs/ui/agent-inline-web-quick.png' });
    await app.evaluate(() => (globalThis as typeof globalThis & { releaseFetch(): void }).releaseFetch());
    await expect(quick.locator('.agent-message .markdown-body')).toContainText('已联网核实');
    await expect(quick.locator('.agent-answer')).toHaveAttribute('aria-busy', 'true');
    await expect(quick.locator('.agent-run-status')).toHaveCount(0);
    expect(answerStream?.writableEnded).toBe(false);
    await quick.screenshot({ path: 'docs/ui/agent-streaming-quick.png' });
    answerStream!.end(deltaEvent('，参考 [来源](https://example.com/docs)。', 'stop') + 'data: [DONE]\n\n');
    await expect.poll(async () => quick.evaluate(async () => {
      const current = await window.snipvia.chat.state(); if (!current.ok) throw new Error(current.error);
      const state = await window.snipvia.agent.state(current.value.capture.id); if (!state.ok) throw new Error(state.error);
      const run = state.value.runs.at(-1);
      return { state: run?.state, answer: run?.answer, notice: run?.notice };
    })).toEqual({ state: 'completed', answer: '已联网核实，参考 [来源](https://example.com/docs)。', notice: undefined });
    await expect(quick.locator('.agent-answer')).toHaveAttribute('aria-busy', 'false');
    await expect(quick.getByLabel('预测分支')).toHaveText('解释代码');
    await expect(quick.locator('.agent-message .markdown-body')).toHaveText('已联网核实，参考 1。');
    await expect(quick.getByRole('button', { name: '查看 6 个网页来源' })).toBeVisible();
    const storedSources = await quick.evaluate(async () => {
      const current = await window.snipvia.chat.state(); if (!current.ok) throw new Error(current.error);
      return current.value.messages.at(-1)?.sources;
    });
    expect(storedSources).toHaveLength(6); expect(storedSources?.filter((source) => source.read)).toHaveLength(1);
    await quick.getByRole('button', { name: '查看 6 个网页来源' }).click();
    const sourceDialog = quick.getByRole('dialog', { name: '搜索结果' });
    await expect(sourceDialog.locator('li')).toHaveCount(6);
    await expect(sourceDialog.getByText('已读取网页', { exact: true })).toHaveCount(1);
    await expect(sourceDialog.getByText('搜索结果摘要', { exact: true })).toHaveCount(5);
    await expect(sourceDialog.locator('time')).toHaveCount(1);
    await quick.screenshot({ path: 'docs/ui/agent-source-list.png' });
    await sourceDialog.getByRole('link').first().click();
    expect(await app.evaluate(() => (globalThis as typeof globalThis & { openedSource?: string }).openedSource)).toBe('https://example.com/docs');
    await sourceDialog.getByRole('button', { name: '关闭搜索结果' }).click();
    await expect(sourceDialog).toHaveCount(0);
    await quick.getByRole('button', { name: '查看来源 1', exact: true }).click();
    await expect(sourceDialog.locator('li[data-selected="true"]')).toHaveCount(1);
    await quick.keyboard.press('Escape');
    await expect(sourceDialog).toHaveCount(0);
    await quick.screenshot({ path: 'docs/ui/agent-source-badge.png' });
    const iconDenied = await quick.evaluate(async () => {
      const current = await window.snipvia.chat.state(); if (!current.ok) throw new Error(current.error);
      return window.snipvia.agent.sourceIcon(current.value.capture.id, 'https://unrelated.example.org/');
    });
    expect(iconDenied.ok).toBe(false);
    await expect(quick.locator('body')).not.toContainText('PRIVATE_');
    expect(advertised.every((names) => names.includes('web_search') && names.includes('fetch_url') && !names.includes('write_file') && !names.includes('edit_file'))).toBe(true);
    await quick.locator('.agent-message .markdown-body').scrollIntoViewIfNeeded();
    await quick.screenshot({ path: 'docs/ui/agent-readonly-web-quick.png' });
    await quick.getByLabel('悬浮对话问题').fill('等待取消'); await quick.getByLabel('悬浮对话问题').press('Enter');
    await expect(quick.getByRole('button', { name: '停止执行', exact: true })).toBeEnabled();
    await expect(quick.locator('.agent-answer').last()).toHaveAttribute('aria-busy', 'true');
    const state = await quick.evaluate(async () => {
      const current = await window.snipvia.chat.state(); if (!current.ok) throw new Error(current.error);
      return window.snipvia.agent.state(current.value.capture.id);
    });
    if (!state.ok) throw new Error(state.error);
    expect((await overlay.evaluate((id) => window.snipvia.agent.state(id), state.value.captureId!)).ok).toBe(false);
    const pending = state.value.runs.find((run) => !run.finished)!;
    expect((await page.evaluate(({ captureId, runId }) => window.snipvia.agent.stop(captureId, runId), { captureId: state.value.captureId!, runId: pending.runId })).ok).toBe(false);
    const pinned = app.windows().find((window) => window.url().endsWith('#quick-chat'))!;
    await pinned.getByRole('button', { name: '返回软件' }).click();
    await expect(page.getByRole('button', { name: '停止生成', exact: true })).toBeEnabled();
    await expect(page.locator('.workspace-live-answer .agent-answer').last()).toHaveAttribute('aria-busy', 'true');
    await expect(page.locator('.workspace-live-answer .agent-answer').last()).toContainText('这是一段尚未完成的回答');
    await page.screenshot({ path: 'docs/ui/agent-streaming-main.png' });
    await page.getByRole('button', { name: '停止生成', exact: true }).click();
    await expect(page.locator('.workspace-message.assistant').last()).toContainText('取消');
    await expect(page.getByRole('button', { name: '停止生成', exact: true })).toHaveCount(0);
    await expect.poll(() => cancelledStream).toBe(true);
    await expect(page.getByRole('heading', { name: 'AI 对话', exact: true })).toBeVisible();
    await page.screenshot({ path: 'docs/ui/agent-readonly-web.png' });

    // A new capture plus a user prompt goes directly to Agent; even a late empty-start IPC cannot predict it.
    expect((await page.evaluate(() => window.snipvia.capture.start())).ok).toBe(true);
    await expect(overlay.locator('.screen-frame')).toBeVisible();
    await overlay.mouse.move(110, 110); await overlay.mouse.down(); await overlay.mouse.move(410, 310); await overlay.mouse.up();
    await expect.poll(() => app.windows().some((window) => window.url().endsWith('#quick-chat'))).toBe(true);
    const prompted = app.windows().find((window) => window.url().endsWith('#quick-chat'))!;
    await expect(prompted.getByText('按 Enter，开始智能分析')).toBeVisible();
    const requestsBeforePrompt = agentRequests;
    await prompted.getByLabel('悬浮对话问题').fill('只提取标题，不要分析代码');
    expect(agentRequests).toBe(requestsBeforePrompt); expect(classifierRequests).toBe(1);
    await expect(prompted.locator('.agent-run-status')).toHaveCount(0);
    await prompted.getByLabel('悬浮对话问题').press('Enter');
    await expect(prompted.locator('.agent-answer')).toHaveText('已按提示词提取标题。');
    await expect(prompted.locator('.agent-answer')).toHaveAttribute('aria-busy', 'false');
    expect(explicitPromptReceived).toBe(true); expect(classifierRequests).toBe(1);
    await expect(prompted.getByLabel('预测分支')).toHaveCount(0);
    await prompted.evaluate(async () => {
      const state = await window.snipvia.chat.state(); if (!state.ok) throw new Error(state.error);
      return window.snipvia.autoAction.start(state.value.capture.id);
    });
    await expect(prompted.getByRole('button', { name: '停止执行', exact: true })).toHaveCount(0);
    expect(classifierRequests).toBe(1); expect(agentRequests).toBe(requestsBeforePrompt + 1);
    const promptedState = await prompted.evaluate(() => window.snipvia.chat.state());
    expect(promptedState.ok && promptedState.value.autoAction).toMatchObject({ state: 'idle', actionId: 'ask-ai' });
    expect(errors).toEqual([]);
  } finally {
    await app.close(); server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
