import { expect, test, type ElectronApplication } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { launchDesktop } from '../helpers/desktop';

// Synthetic v0.2.3 on-disk shapes, seeded BEFORE Main loads its storage modules.
// Do not use current storage writers to manufacture the compatibility input.
const bookId = '20000000-0000-4000-8000-000000000001';
const conversationId = '20000000-0000-4000-8000-000000000002';
const captureId = '20000000-0000-4000-8000-000000000003';
const branchId = 'custom:20000000-0000-4000-8000-000000000004';
const syntheticKey = 'synthetic-phase2-user-owned-key';
const oldNote = '# 旧版笔记\n\n此内容必须保留。\n';
const legacyCookie = '{"version":1,"encryptedSession":"synthetic-obsolete-cookie"}';
const oldSettings = {
  provider: 'custom', endpoint: '', model: 'synthetic-legacy-vision',
  shortcut: 'CommandOrControl+Shift+F8', editorShortcut: 'CommandOrControl+Shift+F9', continueShortcut: 'CommandOrControl+Shift+F10',
  predictionBranches: [{ id: branchId, trigger: 'unknown', label: '旧版自定义分支', runningLabel: '正在验收…',
    applicableContent: '合成截图中的代码；排除自然风景。', prompt: 'SYNTHETIC_PRIVATE_EXECUTION_PROMPT',
    enabled: true, builtin: false, mode: 'ai', notebookId: bookId }]
};
type Probe = { blocked: string[]; updates: number; updateAnonymous: boolean };
type ModelRequest = { authorized: boolean; cookie: boolean; body: { model: string; messages: { role: string; content: unknown }[]; tools?: unknown[] } };

async function fixture(withKey: boolean) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'snipvia-phase2-')));
  const data = join(directory, 'data'), book = join(directory, '旧版笔记本');
  await mkdir(data); await mkdir(book); await writeFile(join(book, '旧笔记.md'), oldNote);
  const requests: ModelRequest[] = [];
  const model = createServer((request, response) => {
    let body = ''; request.on('data', chunk => { body += String(chunk); });
    request.on('end', () => {
      const parsed = JSON.parse(body);
      requests.push({ authorized: request.headers.authorization === `Bearer ${syntheticKey}`, cookie: !!request.headers.cookie, body: parsed });
      const classification = String(parsed.messages[0].content).includes('You are a screenshot classifier');
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: classification
        ? JSON.stringify({ contentType: 'code', confidence: 0.98, matchedBranchId: branchId, signals: { hasCode: true } })
        : '用户模型直接回答，未经过官方账号服务。' } }] }));
    });
  });
  await new Promise<void>(resolve => model.listen(0, '127.0.0.1', resolve));
  const address = model.address(); if (!address || typeof address === 'string') throw new Error('Missing synthetic model');
  const endpoint = `http://127.0.0.1:${address.port}/v1`;
  const profile = { provider: 'custom', endpoint, model: oldSettings.model };
  const settings = withKey ? { ...oldSettings, endpoint } : { ...oldSettings, provider: 'openai', endpoint: 'https://api.openai.com/v1', model: 'gpt-4.1-mini' };
  await mkdir(join(data, 'account')); await writeFile(join(data, 'account/session.json'), legacyCookie);
  const history = [{ id: conversationId, title: '旧截图对话', createdAt: '2026-10-12T00:00:00Z', updatedAt: '2026-10-12T00:00:00Z', profile,
    capture: { id: captureId, fileName: `${captureId}.jpg`, width: 32, height: 24, createdAt: '2026-10-12T00:00:00Z', continuesConversation: false },
    messages: [{ role: 'user', content: '旧版提问' }, { role: 'assistant', content: '旧版回答' }] }];
  await mkdir(join(data, 'history/captures'), { recursive: true });
  await writeFile(join(data, 'history/conversations.json'), JSON.stringify(history));
  await writeFile(join(data, 'notebooks.json'), JSON.stringify({ notebooks: [{ id: bookId, name: '旧版笔记本', directory: book }], activeId: bookId }));
  const root = resolve('.'), mainPath = join(root, 'out/main/index.js'), bootstrap = join(directory, 'bootstrap.cjs');
  await writeFile(bootstrap, `
    const { app, session, safeStorage, desktopCapturer, nativeImage, screen, systemPreferences } = require('electron');
    const fs = require('node:fs'), path = require('node:path');
    app.setAppPath(${JSON.stringify(root)});
    const probe = globalThis.phase2Probe = { blocked: [], updates: 0, updateAnonymous: true };
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      if (url.origin === ${JSON.stringify(new URL(endpoint).origin)}) return realFetch(input, init);
      if (url.href === 'https://api.github.com/repos/yuyeyuyy/Snipvia/releases/latest') {
        probe.updates++;
        const headers = new Headers(init?.headers);
        probe.updateAnonymous &&= !headers.has('authorization') && !headers.has('cookie') && init.credentials === 'omit';
        return Response.json({ tag_name: 'v9.0.0', body: '合成更新说明', draft: false, prerelease: false, published_at: '2026-10-16T00:00:00Z' });
      }
      probe.blocked.push(url.origin + url.pathname);
      throw new TypeError('Network unavailable in local-first acceptance');
    };
    app.whenReady().then(() => {
      app.setName('截然');
      session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
        probe.blocked.push(new URL(details.url).origin); callback({ cancel: true });
      });
      const file = ${JSON.stringify(join(data, 'settings.json'))};
      if (!fs.existsSync(file)) {
        const settings = ${JSON.stringify(settings)};
        const scope = settings.provider + ':' + settings.endpoint;
        const encryptedKeys = {};
        if (${withKey}) {
          if (!safeStorage.isEncryptionAvailable()) throw new Error('System credential protection unavailable for acceptance');
          encryptedKeys[scope] = safeStorage.encryptString(${JSON.stringify(syntheticKey)}).toString('base64');
        }
        fs.writeFileSync(file, JSON.stringify({ settings, profiles: { [scope]: settings }, encryptedKeys, appearance: { mode: 'dark' } }), { mode: 0o600 });
      }
      const image = path.join(${JSON.stringify(data)}, 'history/captures', ${JSON.stringify(`${captureId}.jpg`)});
      if (!fs.existsSync(image)) fs.writeFileSync(image, nativeImage.createFromBuffer(Buffer.alloc(32 * 24 * 4, 255), { width: 32, height: 24 }).toJPEG(80));
      systemPreferences.getMediaAccessStatus = () => 'granted';
      desktopCapturer.getSources = async options => {
        const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()), size = options.thumbnailSize;
        return [{ id: 'screen:synthetic', name: 'Synthetic', display_id: String(display.id), appIcon: nativeImage.createEmpty(),
          thumbnail: nativeImage.createFromBuffer(Buffer.alloc(size.width * size.height * 4, 255), size) }];
      };
      require(${JSON.stringify(mainPath)});
    });
  `);
  let app: ElectronApplication | undefined;
  let logs = '';
  async function launch() {
    app = await launchDesktop({ args: [bootstrap, `--user-data-dir=${data}`], env: {
      ...process.env, ELECTRON_RENDERER_URL: '', SNIPVIA_CONSOLE_ORIGIN: 'http://127.0.0.1:9', MAIN_VITE_CONSOLE_ORIGIN: 'http://127.0.0.1:9',
      SNIPVIA_CAPTURE_BACKEND: 'electron', SNIPVIA_CAPTURE_WARMUP: '0'
    } });
    app.process().stdout?.on('data', chunk => { logs += String(chunk); });
    app.process().stderr?.on('data', chunk => { logs += String(chunk); });
    return { app, page: await app.firstWindow() };
  }
  return { data, book, endpoint, requests, settings, history, launch,
    async assertNoLeaks(instance: ElectronApplication) {
      const page = await instance.firstWindow();
      expect(JSON.stringify(await page.evaluate(() => window.snipvia.settings.get()))).not.toContain(syntheticKey);
      expect(await page.locator('body').innerText()).not.toContain(syntheticKey);
      expect(logs).not.toContain(syntheticKey);
      expect(await readFile(join(data, 'settings.json'), 'utf8')).not.toContain(syntheticKey);
      expect(await readFile(join(data, 'account/session.json'), 'utf8')).toBe(legacyCookie);
      const probe = await instance.evaluate(() => (globalThis as typeof globalThis & { phase2Probe: Probe }).phase2Probe);
      expect(probe.blocked).toEqual([]); expect(probe.updateAnonymous).toBe(true);
    },
    async close() { await app?.close(); await new Promise<void>(resolve => model.close(() => resolve())); await rm(directory, { recursive: true, force: true }); }
  };
}

async function select(instance: ElectronApplication, mode: 'ai' | 'standard') {
  const page = await instance.firstWindow();
  expect((await page.evaluate(mode => window.snipvia.capture.start(mode), mode)).ok).toBe(true);
  const overlay = instance.windows().find(window => window.url().endsWith('#capture'))!;
  await expect(overlay.locator('.screen-frame')).toBeVisible();
  await overlay.mouse.move(100, 100); await overlay.mouse.down(); await overlay.mouse.move(400, 300); await overlay.mouse.up();
  return overlay;
}

async function verifyLegacy(instance: ElectronApplication, directory: string, expectedSettings: typeof oldSettings) {
  const page = await instance.firstWindow();
  const state = await page.evaluate(async ({ bookId, conversationId }) => ({
    settings: await window.snipvia.settings.get(), history: await window.snipvia.history.read(conversationId),
    notes: await window.snipvia.notes.state(), note: await window.snipvia.notes.read(bookId, '旧笔记.md')
  }), { bookId, conversationId });
  expect(state.settings).toMatchObject({ ok: true, value: { ...expectedSettings, hasApiKey: true } });
  expect(state.history).toMatchObject({ ok: true, value: { id: conversationId, messages: [{ role: 'user', content: '旧版提问' }, { role: 'assistant', content: '旧版回答' }], capture: { width: 32, height: 24 } } });
  if (!state.history.ok) throw new Error(state.history.error);
  expect(state.history.value.capture?.dataUrl).toMatch(/^data:image\/jpeg;base64,/);
  expect(state.notes).toMatchObject({ ok: true, value: { activeId: bookId } });
  expect(state.note).toMatchObject({ ok: true, value: { content: oldNote } });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await instance.evaluate(({ app }) => app.getPath('userData'))).toBe(directory);
  expect(await instance.evaluate(({ globalShortcut }, shortcuts) => shortcuts.every(key => globalShortcut.isRegistered(key)),
    [expectedSettings.shortcut, expectedSettings.editorShortcut, expectedSettings.continueShortcut])).toBe(true);
}

test('offline startup without a key preserves local notes, editing, history and protected IPC', async () => {
  const f = await fixture(false);
  try {
    const { app, page } = await f.launch();
    await expect(page.getByRole('button', { name: '账号与登录' })).toHaveCount(0);
    expect(await page.evaluate(() => 'account' in window.snipvia)).toBe(false);
    expect(await page.evaluate(() => typeof (window as unknown as { require?: unknown }).require)).toBe('undefined');
    expect(await app.evaluate(({ app, BrowserWindow }) => {
      const metrics = app.getAppMetrics();
      return BrowserWindow.getAllWindows().map(window => metrics.find(metric => metric.pid === window.webContents.getOSProcessId())?.sandboxed);
    })).toEqual([true, true, true]);
    expect(await page.evaluate(() => Object.isFrozen(window.snipvia))).toBe(true);
    const local = await page.evaluate(async id => {
      const note = await window.snipvia.notes.read(id, '旧笔记.md'); if (!note.ok) throw new Error(note.error);
      return { saved: await window.snipvia.notes.save(id, { ...note.value, content: note.value.content + '\n离线编辑成功。\n' }),
        denied: await window.snipvia.notes.read(id, '../settings.json'), history: await window.snipvia.history.list() };
    }, bookId);
    expect(local.saved).toMatchObject({ ok: true, value: { conflict: false } }); expect(local.denied.ok).toBe(false);
    expect(local.history).toMatchObject({ ok: true, value: [{ id: conversationId }] });
    expect(await readFile(join(f.book, '旧笔记.md'), 'utf8')).toContain('离线编辑成功。');
    const overlay = await select(app, 'standard');
    await expect(overlay.getByRole('toolbar', { name: '截图标注工具栏' })).toBeVisible();
    await overlay.getByRole('button', { name: '定住截图', exact: true }).click();
    const pin = app.windows().find(window => window.url().endsWith('#pin'))!;
    expect((await pin.evaluate(() => window.snipvia.pin.startChat())).ok).toBe(true);
    await expect.poll(() => app.windows().some(window => window.url().endsWith('#quick-chat'))).toBe(true);
    const quick = app.windows().find(window => window.url().endsWith('#quick-chat'))!;
    await quick.getByLabel('悬浮对话问题').press('Enter');
    await expect(quick.getByRole('alert')).toContainText('模型与设置');
    const manual = await quick.evaluate(async () => {
      const state = await window.snipvia.chat.state(); if (!state.ok) throw new Error(state.error);
      return window.snipvia.chat.send({ captureId: state.value.capture.id, question: '解释合成图片' });
    });
    expect(manual).toMatchObject({ ok: false, error: expect.stringContaining('模型与设置') });
    expect(f.requests).toHaveLength(0);
    expect((await page.evaluate(() => window.snipvia.updates.check()))).toMatchObject({ ok: true, value: { status: 'available', latestVersion: '9.0.0' } });
    await f.assertNoLeaks(app);
  } finally { await f.close(); }
});

test('v0.2.3 data and system-encrypted key survive restart and drive direct prediction and Agent', async () => {
  const f = await fixture(true);
  try {
    let { app, page } = await f.launch();
    const savedSettings = await readFile(join(f.data, 'settings.json'), 'utf8');
    await verifyLegacy(app, f.data, { ...oldSettings, endpoint: f.endpoint });
    expect(await readFile(join(f.data, 'settings.json'), 'utf8')).toBe(savedSettings);
    await app.close();
    ({ app, page } = await f.launch());
    await verifyLegacy(app, f.data, { ...oldSettings, endpoint: f.endpoint });
    expect(await readFile(join(f.data, 'settings.json'), 'utf8')).toBe(savedSettings);
    await select(app, 'ai');
    await expect.poll(() => app.windows().some(window => window.url().endsWith('#quick-chat'))).toBe(true);
    const quick = app.windows().find(window => window.url().endsWith('#quick-chat'))!;
    await quick.getByLabel('悬浮对话问题').press('Enter');
    await expect(quick.getByLabel('预测分支')).toHaveText('旧版自定义分支');
    await expect(quick.locator('.agent-answer')).toContainText('用户模型直接回答');
    expect(f.requests).toHaveLength(2);
    const [classification, agent] = f.requests;
    expect(classification.authorized && agent.authorized).toBe(true);
    expect(classification.cookie || agent.cookie).toBe(false);
    expect(classification.body.model).toBe(oldSettings.model); expect(agent.body.model).toBe(oldSettings.model);
    const wire = JSON.stringify(classification.body);
    expect(wire).toContain(oldSettings.predictionBranches[0].applicableContent);
    expect(wire).toContain('data:image/jpeg;base64,');
    expect(wire).not.toContain('SYNTHETIC_PRIVATE_EXECUTION_PROMPT'); expect(wire).not.toContain(bookId);
    expect(JSON.stringify(agent.body)).toContain('SYNTHETIC_PRIVATE_EXECUTION_PROMPT');
    expect(agent.body.tools?.length).toBeGreaterThan(0);
    const manual = await quick.evaluate(async () => {
      const state = await window.snipvia.chat.state(); if (!state.ok) throw new Error(state.error);
      return window.snipvia.chat.send({ captureId: state.value.capture.id, question: '用我的模型继续回答' });
    });
    expect(manual).toMatchObject({ ok: true, value: { content: expect.stringContaining('用户模型直接回答') } });
    expect(f.requests.at(-1)?.authorized).toBe(true);
    expect(await readFile(join(f.book, '旧笔记.md'), 'utf8')).toBe(oldNote);
    const index = JSON.parse(await readFile(join(f.data, 'history/conversations.json'), 'utf8'));
    expect(index.find((item: { id: string }) => item.id === conversationId)).toEqual(f.history[0]);
    expect((await page.evaluate(() => window.snipvia.updates.check()))).toMatchObject({ ok: true, value: { status: 'available' } });
    expect(await app.evaluate(() => (globalThis as typeof globalThis & { phase2Probe: Probe }).phase2Probe.updates)).toBe(1);
    await f.assertNoLeaks(app);
  } finally { await f.close(); }
});
