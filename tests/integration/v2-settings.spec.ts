import { expect, test } from '@playwright/test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { defaults } from '../../src/shared/contracts';
import { launchDesktop } from '../helpers/desktop';

test('V2 boots offline into settings, protects old data and credentials, and captures without a Conversation', async () => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(join(tmpdir(), 'snipvia-v2-compat-')), data = join(directory, 'data');
  await mkdir(join(data, 'history/captures'), { recursive: true }); await mkdir(join(data, 'schedule/captures'), { recursive: true });
  const book = { id: crypto.randomUUID(), name: '原笔记', directory: join(directory, 'notes') }; await mkdir(book.directory);
  const oldCapture = { id: crypto.randomUUID(), fileName: '', width: 2, height: 2, createdAt: new Date().toISOString() }; oldCapture.fileName = oldCapture.id + '.jpg';
  const files: Record<string, string> = {
    'history/conversations.json': JSON.stringify([{ id: crypto.randomUUID(), title: '旧对话保留', createdAt: oldCapture.createdAt, capture: oldCapture, messages: [{ role: 'user', content: '以前的问题' }] }]),
    'schedule/jobs.json': JSON.stringify([{ id: crypto.randomUUID(), createdAt: oldCapture.createdAt, events: [{ title: '原有会议', notes: '原有备注' }] }]),
    'notebooks.json': JSON.stringify({ activeId: book.id, notebooks: [book] }),
    'settings.json': JSON.stringify({ settings: { ...defaults, shortcut: 'CommandOrControl+Alt+F7', editorShortcut: 'CommandOrControl+Alt+F8' }, encryptedKeys: { 'openai:https://api.openai.com/v1': 'SYNTHETIC_ENCRYPTED_CREDENTIAL' }, appearance: { mode: 'dark', chatFontSize: 18 } }),
    'credentials.json': JSON.stringify({ keys: { 'synthetic-service': 'SYNTHETIC_LEGACY_KEY_DO_NOT_MIGRATE' } }),
    'credentials.key': 'SYNTHETIC_32_BYTE_KEY_NOT_USED_0000',
    'prediction-settings.json': '{broken legacy prediction',
    'account/session.json': 'SYNTHETIC_ACCOUNT_DATA'
  };
  await mkdir(join(data, 'account'));
  for (const [name, bytes] of Object.entries(files)) await writeFile(join(data, name), bytes);
  await writeFile(join(book.directory, '保留.md'), '# 原笔记\n\n不要修改。');
  const root = resolve('.'), bootstrap = join(directory, 'bootstrap.cjs'), mainPath = join(root, 'out/main/index.js');
  await writeFile(bootstrap, `
    const {app,clipboard,desktopCapturer,nativeImage,screen,systemPreferences,safeStorage}=require('electron');
    app.setAppPath(${JSON.stringify(root)});
    globalThis.v2Probe={fetches:0,decrypts:0,copies:0,registrations:[]};
    globalThis.fetch=async()=>{globalThis.v2Probe.fetches++;throw new Error('synthetic offline');};
    safeStorage.decryptString=()=>{globalThis.v2Probe.decrypts++;throw new Error('must not decrypt');};
    clipboard.write=async()=>{globalThis.v2Probe.copies++;};
    systemPreferences.getMediaAccessStatus=()=> 'granted';
    app.whenReady().then(()=>{const d=screen.getPrimaryDisplay();desktopCapturer.getSources=async options=>[{id:'screen:synthetic',name:'Synthetic',display_id:String(d.id),appIcon:nativeImage.createEmpty(),thumbnail:nativeImage.createFromBuffer(Buffer.alloc(options.thumbnailSize.width*options.thumbnailSize.height*4,255),options.thumbnailSize)}];});
    require(${JSON.stringify(mainPath)});
  `);
  const options = { args: [bootstrap, '--user-data-dir=' + data], env: { ...process.env, SNIPVIA_CONSOLE_ORIGIN: 'http://127.0.0.1:9', SNIPVIA_CAPTURE_BACKEND: 'electron', SNIPVIA_CAPTURE_WARMUP: '0' } };
  const app = await launchDesktop(options);
  let closed = false;
  try {
    const page = await app.firstWindow();
    await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await page.evaluate(() => ['chat', 'notes', 'agent', 'history', 'models', 'prediction', 'autoAction', 'chatImages', 'editing'].filter(key => key in window.snipvia))).toEqual([]);
    expect(await app.evaluate(({ ipcMain }) => {
      const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, unknown> })._invokeHandlers;
      return [...handlers.keys()].filter(key => /^(chat|agent|notes|history|prediction-settings|auto-action|editing|chat-images):/.test(key));
    })).toEqual([]);
    expect(await app.evaluate(({ globalShortcut }) => [globalShortcut.isRegistered('CommandOrControl+Alt+F7'), globalShortcut.isRegistered('CommandOrControl+Alt+F8'), globalShortcut.isRegistered('CommandOrControl+Shift+Enter'), globalShortcut.isRegistered('Control+2')])).toEqual([true, true, false, false]);
    await expect(page.getByRole('button', { name: 'AI 对话', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'AI 笔记', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '查看旧记录', exact: true }).click();
    const legacy = page.getByRole('dialog', { name: '旧版记录（只读）' });
    await expect(legacy).toContainText('旧对话保留');
    await expect(legacy).toContainText('原笔记');
    await expect(legacy).toContainText('原有会议');
    await page.keyboard.press('Escape');

    const overlay = app.windows().find(window => window.url().endsWith('#capture'))!, pin = app.windows().find(window => window.url().endsWith('#pin'))!;
    const windowIds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(window => window.id));
    expect((await page.evaluate(() => window.snipvia.capture.start('collect'))).ok).toBe(false);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => !new URL(window.webContents.getURL()).hash)!.close());
    for (let index = 0; index < 3; index++) {
      expect((await page.evaluate(() => window.snipvia.capture.start('quick'))).ok).toBe(true);
      await expect(overlay.locator('.screen-frame')).toBeVisible();
      await overlay.mouse.move(80, 80); await overlay.mouse.down(); await overlay.mouse.move(280, 200); await overlay.mouse.up();
      await expect(pin.getByAltText('置顶截图')).toBeVisible();
      const current = await pin.evaluate(() => window.snipvia.pin.current());
      expect(current.ok && current.value.capture).not.toHaveProperty('conversationId');
      expect((await pin.evaluate(() => window.snipvia.legacy.read())).ok).toBe(false);
      expect((await pin.evaluate(() => window.snipvia.settings.saveShortcuts({ shortcut: 'Control+4', editorShortcut: 'Control+5' }))).ok).toBe(false);
      expect((await pin.evaluate(() => window.snipvia.screenshots.delete(crypto.randomUUID()))).ok).toBe(false);
      if (index === 0 && current.ok) {
        expect((await pin.evaluate(id => window.snipvia.screenshots.save(id), current.value.capture.id)).ok).toBe(true);
        await expect(pin.getByAltText('置顶截图')).toBeVisible();
      }
      await pin.keyboard.press('Escape');
    }
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(window => window.id))).toEqual(windowIds);
    expect(app.windows().some(window => window.url().endsWith('#quick-chat'))).toBe(false);
    const probe = await app.evaluate(() => (globalThis as typeof globalThis & { v2Probe: { fetches: number; decrypts: number; copies: number } }).v2Probe);
    expect(probe).toMatchObject({ fetches: 0, decrypts: 0, copies: 3 });
    for (const [name, original] of Object.entries(files)) expect(await readFile(join(data, name), 'utf8'), name).toBe(original);
    expect(await readFile(join(book.directory, '保留.md'), 'utf8')).toBe('# 原笔记\n\n不要修改。');
    await app.evaluate(({ app }) => app.emit('activate', {}, false));
    await page.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name: '通用', exact: true }).click();
    await mkdir('docs/ui/v2', { recursive: true });
    await page.locator('main').evaluate(node => { node.scrollTop = 0; });
    for (const theme of ['light', 'dark'] as const) {
      await page.getByLabel('外观主题').selectOption(theme);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await page.screenshot({ path: 'docs/ui/v2/settings-' + theme + '.png', animations: 'disabled' });
    }
    await app.close(); closed = true;
    const restart = await launchDesktop(options);
    try {
      const page = await restart.firstWindow();
      await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible();
      const saved = await page.evaluate(() => window.snipvia.screenshots.list());
      expect(saved.ok && saved.value).toHaveLength(1);
      if (saved.ok) {
        expect((await page.evaluate(id => window.snipvia.screenshots.copy(id), saved.value[0].id)).ok).toBe(true);
        expect((await page.evaluate(id => window.snipvia.screenshots.delete(id), saved.value[0].id)).ok).toBe(true);
      }
      // A failed registration must restore both old registrations and disk settings.
      await restart.evaluate(({ globalShortcut }) => { const register = globalShortcut.register.bind(globalShortcut); globalShortcut.register = (key, callback) => key === 'Control+F12' ? false : register(key, callback); });
      const failed = await page.evaluate(() => window.snipvia.settings.saveShortcuts({ shortcut: 'Control+F12', editorShortcut: 'Control+F11' }));
      expect(failed.ok).toBe(false);
      const settings = await page.evaluate(() => window.snipvia.settings.get());
      expect(settings.ok && settings.value.shortcut).toBe('CommandOrControl+Alt+F7');
      expect(await restart.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('CommandOrControl+Alt+F7'))).toBe(true);
    } finally { await restart.close(); }
  } finally { if (!closed) await app.close(); await rm(directory, { recursive: true, force: true }); }
});

test('broken legacy indexes do not block settings or initialize schedule extraction', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'snipvia-v2-broken-'));
  await mkdir(join(directory, 'history')); await mkdir(join(directory, 'schedule'));
  await writeFile(join(directory, 'history/conversations.json'), '{broken history');
  await writeFile(join(directory, 'schedule/jobs.json'), '{broken schedule');
  const app = await launchDesktop({ args: ['.', '--user-data-dir=' + directory], env: { ...process.env, SNIPVIA_CAPTURE_BACKEND: 'electron', SNIPVIA_CAPTURE_WARMUP: '0' } });
  try {
    const page = await app.firstWindow();
    await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible();
    const result = await page.evaluate(() => window.snipvia.legacy.read());
    expect(result.ok && result.value.errors).toHaveLength(2);
    expect(await readFile(join(directory, 'history/conversations.json'), 'utf8')).toBe('{broken history');
    expect(await readFile(join(directory, 'schedule/jobs.json'), 'utf8')).toBe('{broken schedule');
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});

test('a cancelled quick output cannot replace the next edit session after delayed clipboard completion', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'snipvia-v2-session-race-'));
  const app = await launchDesktop({ args: ['.', '--user-data-dir=' + directory], env: { ...process.env, SNIPVIA_CAPTURE_BACKEND: 'electron', SNIPVIA_CAPTURE_WARMUP: '0' } });
  try {
    const page = await app.firstWindow(), overlay = app.windows().find(window => window.url().endsWith('#capture'))!, pin = app.windows().find(window => window.url().endsWith('#pin'))!;
    await app.evaluate(({ clipboard, desktopCapturer, nativeImage, screen, systemPreferences }) => {
      systemPreferences.getMediaAccessStatus = () => 'granted';
      const probe = { blocked: false, release: () => {} };
      (globalThis as typeof globalThis & { v2SessionRace: typeof probe }).v2SessionRace = probe;
      clipboard.write = async () => { probe.blocked = true; await new Promise<void>(resolve => { probe.release = resolve; }); };
      desktopCapturer.getSources = async options => {
        const display = screen.getPrimaryDisplay(), size = options.thumbnailSize!;
        return [{ id: 'screen:synthetic', name: 'Synthetic', display_id: String(display.id), appIcon: nativeImage.createEmpty(), thumbnail: nativeImage.createFromBuffer(Buffer.alloc(size.width * size.height * 4, 255), size) }];
      };
    });
    expect((await page.evaluate(() => window.snipvia.capture.start('quick'))).ok).toBe(true);
    await expect(overlay.locator('.screen-frame')).toBeVisible();
    const oldId = await overlay.locator('.capture-overlay').getAttribute('data-performance-session');
    await overlay.mouse.move(90, 90); await overlay.mouse.down(); await overlay.mouse.move(290, 230); await overlay.mouse.up();
    await expect.poll(() => app.evaluate(() => (globalThis as typeof globalThis & { v2SessionRace: { blocked: boolean } }).v2SessionRace.blocked)).toBe(true);
    expect((await page.evaluate(() => window.snipvia.capture.start('edit'))).ok).toBe(true);
    const newId = await overlay.locator('.capture-overlay').getAttribute('data-performance-session'); expect(newId).not.toBe(oldId);
    await app.evaluate(() => (globalThis as typeof globalThis & { v2SessionRace: { release(): void } }).v2SessionRace.release());
    await expect(overlay.locator('.screen-frame')).toBeVisible();
    await overlay.mouse.move(100, 100); await overlay.mouse.down(); await overlay.mouse.move(340, 260); await overlay.mouse.up();
    await expect(overlay.getByRole('toolbar', { name: '截图标注工具栏' })).toBeVisible();
    const stale = await overlay.evaluate(sessionId => window.snipvia.capture.finish({ sessionId: sessionId!, selection: { x: 0, y: 0, width: 10, height: 10 } }), oldId);
    expect(stale.ok).toBe(false);
    expect(await overlay.locator('.capture-overlay').getAttribute('data-performance-session')).toBe(newId);
    await expect(pin.getByAltText('置顶截图')).toHaveCount(0);
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('#pin'))!.isVisible())).toBe(false);
    await overlay.getByRole('button', { name: '定住截图', exact: true }).click();
    await expect(pin.getByAltText('置顶截图')).toBeVisible();
    const active = await pin.evaluate(() => window.snipvia.pin.current());
    expect(active.ok && active.value.performanceSessionId).toBe(newId);
    await pin.keyboard.press('Escape');
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});
