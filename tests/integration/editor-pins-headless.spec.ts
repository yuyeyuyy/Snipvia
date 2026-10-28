import { _electron as electron, expect, test, type Page } from '@playwright/test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
test.use({ trace: 'off', screenshot: 'off', video: 'off' });

test('hidden editor resizes crops and annotations, re-edits text and keeps independently authorized pins', async () => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(join(tmpdir(), 'snipvia-editor-pins-')), root = resolve('.');
  const mainPath = join(root, 'out/main/index.js');
  const source = (await readFile(mainPath, 'utf8')).replace('show: !launchedAtLogin()', 'show: false').replace('const webPreferences = {', 'const webPreferences = { offscreen: true,');
  const bootstrap = join(directory, 'bootstrap.cjs');
  await writeFile(bootstrap, [
    "const {app,BrowserWindow,globalShortcut,clipboard,desktopCapturer,systemPreferences,screen}=require('electron');",
    "if(process.platform==='darwin'){app.setActivationPolicy('prohibited');app.setActivationPolicy=()=>{};if(app.dock){app.dock.show=async()=>{};app.dock.setIcon=()=>{};}}",
    "const originalVisible=BrowserWindow.prototype.isVisible;globalThis.actualVisible=w=>originalVisible.call(w);BrowserWindow.prototype.show=()=>{};BrowserWindow.prototype.showInactive=()=>{};BrowserWindow.prototype.focus=()=>{};",
    "const shortcuts=new Map();globalShortcut.register=(key,fn)=>{shortcuts.set(key,fn);return true;};globalShortcut.unregisterAll=()=>shortcuts.clear();globalThis.editorProbe={shortcuts,fail:false,copies:0};",
    "clipboard.write=async()=>{if(globalThis.editorProbe.fail)throw Error('synthetic clipboard denied');globalThis.editorProbe.copies++;};",
    "systemPreferences.getMediaAccessStatus=()=>'granted';",
    "app.whenReady().then(()=>{const display={...screen.getPrimaryDisplay(),bounds:{x:0,y:0,width:1000,height:720},workArea:{x:0,y:0,width:1000,height:720},size:{width:1000,height:720},scaleFactor:1};screen.getPrimaryDisplay=()=>display;screen.getDisplayNearestPoint=()=>display;screen.getCursorScreenPoint=()=>({x:20,y:20});desktopCapturer.getSources=async(options)=>{const size=options.thumbnailSize,bytes=Buffer.alloc(size.width*size.height*4,255);return[{id:'screen:fixture',name:'synthetic',display_id:String(display.id),appIcon:require('electron').nativeImage.createEmpty(),thumbnail:require('electron').nativeImage.createFromBitmap(bytes,size)}];};});",
    'app.setAppPath(' + JSON.stringify(root) + ');',
    'require("node:module")._extensions[".js"]=((original)=>(module,path)=>path===' + JSON.stringify(mainPath) + '?module._compile(' + JSON.stringify(source) + ',path):original(module,path))(require("node:module")._extensions[".js"]);',
    'globalThis.client=require(' + JSON.stringify(mainPath) + ');'
  ].join('\n'));
  const app = await electron.launch({ args: [bootstrap, '--user-data-dir=' + join(directory, 'data')], env: { ...process.env, ELECTRON_RENDERER_URL: '', SNIPVIA_CAPTURE_BACKEND: 'electron', SNIPVIA_CAPTURE_WARMUP: '0' } });
  const errors: string[] = [];
  try {
    const main = await app.firstWindow(); await main.locator('.app-shell').waitFor({ state: 'attached' });
    await expect.poll(() => app.windows().some(page => page.url().endsWith('#capture'))).toBe(true);
    const overlay = app.windows().find(page => page.url().endsWith('#capture'))!;
    overlay.on('pageerror', error => errors.push(error.message));
    expect((await main.evaluate(() => window.snipvia.permissions.screen())).ok).toBe(true);
    expect((await main.evaluate(async () => {
      const current = await window.snipvia.settings.get(); if (!current.ok) throw Error(current.error);
      return window.snipvia.settings.saveShortcuts({ ...current.value, editorShortcut: 'CommandOrControl+2' });
    })).ok).toBe(true);
    const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
    const drag = async (from: [number, number], to: [number, number]) => {
      await overlay.mouse.move(...from); await overlay.mouse.down(); await overlay.mouse.move(...to, { steps: 5 }); await overlay.mouse.up();
    };
    const start = async () => {
      await app.evaluate(() => {
        const callback = (globalThis as typeof globalThis & { editorProbe: { shortcuts: Map<string, () => void> } }).editorProbe.shortcuts.get('CommandOrControl+2');
        if (!callback) throw Error('Editor shortcut missing'); callback();
      });
      await expect(overlay.locator('.screen-frame')).toHaveCount(1);
      await expect(overlay.locator('.screenshot-editor')).toHaveCount(0);
      await drag([150, 120], [700, 450]);
      await expect(overlay.getByRole('toolbar', { name: '截图标注工具栏' })).toBeVisible();
    };
    process.stderr.write('[editor pins] resize crop and rectangle\n');
    await start();
    // Edge hit area works between the visible dots, including slightly outside the crop.
    await drag([704, 220], [784, 220]);
    await drag([450, 454], [450, 494]);
    await expect(overlay.locator('.editor-selection')).toHaveCSS('width', '630px');
    await expect(overlay.locator('.editor-selection')).toHaveCSS('height', '370px');
    await button(overlay, '矩形').click(); await drag([200, 170], [380, 260]);
    await button(overlay, '选择与移动').click(); await overlay.mouse.click(270, 215);
    await expect(overlay.locator('.editor-annotation-selection')).toHaveCSS('width', '180px');
    await drag([380, 260], [430, 300]);
    await expect(overlay.locator('.editor-annotation-selection')).toHaveCSS('width', '230px');
    await expect(overlay.locator('.editor-annotation-selection')).toHaveCSS('height', '130px');
    await button(overlay, '撤销').click();
    await overlay.mouse.click(270, 215);
    await expect(overlay.locator('.editor-annotation-selection')).toHaveCSS('width', '180px');

    process.stderr.write('[editor pins] edit text repeatedly and preserve undo\n');
    await button(overlay, '文字').click(); await overlay.mouse.click(230, 340);
    const input = overlay.getByRole('textbox', { name: '标注文字' });
    await input.fill('原始文字'); await input.press('Enter');
    // Still in Text mode: clicking existing text must edit it, not overlay a new empty item.
    await overlay.mouse.click(240, 350); await expect(input).toHaveValue('原始文字');
    await input.fill('二次编辑'); await input.press('Enter');
    await button(overlay, '选择与移动').click();
    await overlay.mouse.click(240, 350);
    await button(overlay, '撤销').click();
    await overlay.mouse.dblclick(240, 350); await expect(input).toHaveValue('原始文字');
    await input.fill('未确认草稿'); await input.press('Escape');
    await overlay.mouse.dblclick(240, 350); await expect(input).toHaveValue('原始文字');
    await input.press('Enter');
    await button(overlay, '重做').click();
    await overlay.mouse.dblclick(240, 350); await expect(input).toHaveValue('二次编辑');
    await input.press('Enter');

    process.stderr.write('[editor pins] first pin\n');
    await button(overlay, '定住截图').click();
    const pinPages = () => app.windows().filter(page => page.url().endsWith('#pin'));
    await expect.poll(async () => { const p = pinPages()[0]; return p ? p.getByAltText('置顶截图').count() : 0; }).toBe(1);
    const first = pinPages()[0];
    const firstState = await first.evaluate(() => window.snipvia.pin.current()); if (!firstState.ok) throw Error(firstState.error);
    expect(firstState.value.capture.width).toBe(630); expect(firstState.value.capture.height).toBe(370);

    process.stderr.write('[editor pins] next shortcut retains old pin; two independent windows\n');
    await start();
    const retained = await first.evaluate(() => window.snipvia.pin.current()); expect(retained.ok && retained.value.capture.id).toBe(firstState.value.capture.id);
    await button(overlay, '定住截图').click();
    await expect.poll(() => pinPages().length).toBe(2);
    const second = pinPages().find(page => page !== first)!;
    await expect(second.getByAltText('置顶截图')).toHaveCount(1);
    const secondState = await second.evaluate(() => window.snipvia.pin.current()); if (!secondState.ok) throw Error(secondState.error);
    expect(secondState.value.capture.id).not.toBe(firstState.value.capture.id);
    expect((await first.evaluate(id => window.snipvia.screenshots.save(id), secondState.value.capture.id)).ok).toBe(false);
    const forgedAck = await first.evaluate(id => window.snipvia.pin.sessionRendered(id), secondState.value.performanceSessionId);
    expect(forgedAck.ok && forgedAck.value).toBe(false);
    expect((await main.evaluate(() => window.snipvia.pin.current())).ok).toBe(false);
    expect((await main.evaluate(() => window.snipvia.screenshots.list())).ok).toBe(true);
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(w => w.webContents.getURL().endsWith('#pin')).every(w => w.isResizable()))).toBe(true);

    process.stderr.write('[editor pins] drag remains usable and validates session ownership\n');
    const boundsFor = (id: string) => app.evaluate(({ BrowserWindow }, id) => {
      const page = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('#pin') && w.webContents.id.toString() === id);
      if (!page) throw Error('Pin missing'); return page.getBounds();
    }, id);
    const nativeIds = [
      await (await app.browserWindow(first)).evaluate(window => window.webContents.id.toString()),
      await (await app.browserWindow(second)).evaluate(window => window.webContents.id.toString())
    ];
    const beforeMove = await boundsFor(nativeIds[0]), secondBounds = await boundsFor(nativeIds[1]);
    expect(await first.locator('.pinned-image-area').evaluate(element => getComputedStyle(element).getPropertyValue('-webkit-app-region'))).toBe('no-drag');
    const request = { sessionId: firstState.value.performanceSessionId, x: beforeMove.x + 20, y: beforeMove.y + 20 };
    expect((await main.evaluate(value => window.snipvia.pin.move(value), request)).ok).toBe(false);
    expect((await second.evaluate(value => window.snipvia.pin.move(value), request)).ok).toBe(false);
    for (const value of [{ ...request, x: NaN }, { ...request, x: Infinity }, { ...request, x: 100001 }, { ...request, width: 12 }]) {
      expect((await first.evaluate(value => window.snipvia.pin.move(value), value)).ok).toBe(false);
    }
    // Hidden offscreen renderers report screenX/Y = 0. Supply the measured
    // native origin to model the on-screen renderer, without moving the OS cursor.
    await first.evaluate(origin => {
      Object.defineProperty(window, 'screenX', { configurable: true, get: () => origin.x });
      Object.defineProperty(window, 'screenY', { configurable: true, get: () => origin.y });
    }, beforeMove);
    await first.mouse.move(200, 160); await first.mouse.down(); await first.mouse.move(245, 185, { steps: 5 }); await first.mouse.up();
    await expect.poll(async () => (await boundsFor(nativeIds[0])).x).toBe(beforeMove.x + 45);
    expect(await boundsFor(nativeIds[1])).toEqual(secondBounds);
    // A drag-associated double-click notification must not remove the image.
    await first.locator('.pinned-image-area').dispatchEvent('dblclick', { button: 0, detail: 2 });
    expect((await first.evaluate(() => window.snipvia.pin.current())).ok).toBe(true);
    expect((await first.evaluate(id => window.snipvia.screenshots.save(id), firstState.value.capture.id)).ok).toBe(true);
    const savedPath = join(directory, 'data', 'screenshots', firstState.value.capture.id + '.png'), savedBytes = await readFile(savedPath);

    process.stderr.write('[editor pins] copy error retains both; close only the requested pin\n');
    await app.evaluate(() => { (globalThis as typeof globalThis & { editorProbe: { fail: boolean } }).editorProbe.fail = true; });
    await second.locator('.pinned-image-area').hover(); await button(second, '复制并关闭钉图').click();
    await expect(second.getByRole('alert')).toContainText('synthetic clipboard denied');
    expect((await first.evaluate(() => window.snipvia.pin.current())).ok).toBe(true);
    await app.evaluate(() => { (globalThis as typeof globalThis & { editorProbe: { fail: boolean } }).editorProbe.fail = false; });
    await first.locator('.pinned-image-area').click({ position: { x: 200, y: 140 } });
    expect((await first.evaluate(() => window.snipvia.pin.current())).ok).toBe(true);
    await first.locator('.pinned-image-area').dispatchEvent('dblclick', { button: 2, detail: 2 });
    expect((await first.evaluate(() => window.snipvia.pin.current())).ok).toBe(true);
    await first.locator('.pinned-image-area').dblclick({ position: { x: 200, y: 140 } });
    await expect.poll(async () => (await first.evaluate(() => window.snipvia.pin.current())).ok).toBe(false);
    expect((await second.evaluate(() => window.snipvia.pin.current())).ok).toBe(true);
    expect(await readFile(savedPath)).toEqual(savedBytes);
    const saved = await main.evaluate(() => window.snipvia.screenshots.list());
    expect(saved.ok && saved.value.map(item => item.id)).toEqual([firstState.value.capture.id]);
    await Promise.all([second.waitForEvent('close'), button(second, '复制并关闭钉图').click()]);
    expect(await app.evaluate(() => (globalThis as typeof globalThis & { editorProbe: { copies: number } }).editorProbe.copies)).toBe(1);

    process.stderr.write('[editor pins] primary reuse and escape; all native windows hidden\n');
    await start(); await button(overlay, '定住截图').click(); await expect(first.getByAltText('置顶截图')).toHaveCount(1);
    await start(); await button(overlay, '定住截图').click();
    await expect.poll(() => pinPages().length).toBe(2);
    const extra = pinPages().find(page => page !== first)!;
    await expect(extra.getByAltText('置顶截图')).toHaveCount(1);
    await Promise.all([extra.waitForEvent('close'), extra.locator('.pinned-image-area').dblclick({ position: { x: 180, y: 130 } })]);
    expect((await first.evaluate(() => window.snipvia.pin.current())).ok).toBe(true);
    await first.locator('.pinned-image-area').hover(); await button(first, '关闭钉图').click();
    await expect.poll(async () => (await first.evaluate(() => window.snipvia.pin.current())).ok).toBe(false);
    await start(); await button(overlay, '定住截图').click(); await expect(first.getByAltText('置顶截图')).toHaveCount(1);
    await first.keyboard.press('Escape');
    await expect.poll(async () => (await first.evaluate(() => window.snipvia.pin.current())).ok).toBe(false);
    const status = await main.evaluate(() => window.snipvia.performance.captureBackendStatus());
    expect(status.ok && status.value.runtimeScreenshots).toEqual({ items: 0, bytes: 0 });
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every(w => !(globalThis as typeof globalThis & { actualVisible(w: unknown): boolean }).actualVisible(w)))).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) if (w.webContents.isOffscreen()) w.webContents.stopPainting(); }).catch(() => {});
    await app.close(); await rm(directory, { recursive: true, force: true });
  }
});
