import { _electron as electron, expect, test } from '@playwright/test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { defaultCapturePreferences } from '../../src/shared/capture-preferences';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test('default shortcuts register in order and toggle shelf visibility without changing expansion or data', async () => {
  test.setTimeout(45_000);
  const directory = await mkdtemp(join(tmpdir(), 'snipvia-shortcuts-visibility-'));
  const root = resolve('.'), mainPath = join(root, 'out/main/index.js');
  const source = (await readFile(mainPath, 'utf8')).replace('show: !launchedAtLogin()', 'show: false').replace('const webPreferences = {', 'const webPreferences = { offscreen: true,');
  const bootstrap = join(directory, 'bootstrap.cjs');
  await writeFile(bootstrap, [
    "const{app,BrowserWindow,globalShortcut,dialog,nativeImage}=require('electron');",
    "if(process.platform==='darwin'){app.setActivationPolicy('prohibited');app.setActivationPolicy=()=>{};if(app.dock){app.dock.show=async()=>{};app.dock.setIcon=()=>{};}}",
    "globalThis.visibilityProbe={callbacks:new Map(),settingsShows:0};",
    "const realVisible=BrowserWindow.prototype.isVisible,realHide=BrowserWindow.prototype.hide,shown=new WeakSet();globalThis.visibilityProbe.realVisible=w=>realVisible.call(w);BrowserWindow.prototype.isVisible=function(){return shown.has(this)||realVisible.call(this);};",
    "BrowserWindow.prototype.show=function(){shown.add(this);if(!new URL(this.webContents.getURL()).hash)globalThis.visibilityProbe.settingsShows++;};BrowserWindow.prototype.showInactive=function(){shown.add(this);};BrowserWindow.prototype.hide=function(){shown.delete(this);realHide.call(this);};BrowserWindow.prototype.focus=()=>{};",
    "globalShortcut.register=(key,callback)=>{globalThis.visibilityProbe.callbacks.set(key,callback);return true;};globalShortcut.unregister=key=>globalThis.visibilityProbe.callbacks.delete(key);globalShortcut.unregisterAll=()=>{};",
    'app.setAppPath(' + JSON.stringify(root) + ');',
    'require("node:module")._extensions[".js"]=((original)=>(module,path)=>path===' + JSON.stringify(mainPath) + '?module._compile(' + JSON.stringify(source) + ',path):original(module,path))(require("node:module")._extensions[".js"]);',
    'const client=require(' + JSON.stringify(mainPath) + ');',
    "globalThis.visibilityProbe.seed=()=>{for(let i=0;i<2;i++){const image=nativeImage.createFromBitmap(Buffer.alloc(24*16*4,i?180:255),{width:24,height:16}),item=client.screenshots.create(image.toPNG(),{width:24,height:16,mimeType:'image/png'});client.collection.append(item.id);}};"
  ].join('\n'));
  const app = await electron.launch({ args: [bootstrap, '--user-data-dir=' + join(directory, 'data')], env: { ...process.env, ELECTRON_RENDERER_URL: '', SNIPVIA_CAPTURE_BACKEND: 'electron', SNIPVIA_CAPTURE_WARMUP: '0' } });
  try {
    const main = await app.firstWindow(); await main.locator('.v2-preferences').waitFor({ state: 'attached' });
    await main.emulateMedia({ reducedMotion: 'reduce' });
    expect(await main.evaluate(() => window.snipvia.settings.get())).toEqual({ ok: true, value: defaultCapturePreferences });
    const registered = await app.evaluate(() => [...(globalThis as typeof globalThis & { visibilityProbe: { callbacks: Map<string, () => void> } }).visibilityProbe.callbacks.keys()]);
    expect(registered).toEqual(Object.values(defaultCapturePreferences));
    const toggle = () => app.evaluate((_electron, key) => (globalThis as typeof globalThis & { visibilityProbe: { callbacks: Map<string, () => void> } }).visibilityProbe.callbacks.get(key)!(), defaultCapturePreferences.collectionShortcut);
    const state = async () => { const result = await main.evaluate(() => window.snipvia.collection.current()); if (!result.ok) throw Error(result.error); return result.value; };
    await toggle(); await expect.poll(() => app.windows().some(page => page.url().endsWith('#shelf'))).toBe(true);
    const shelf = app.windows().find(page => page.url().endsWith('#shelf'))!;
    await shelf.locator('.shelf').waitFor({ state: 'attached' });
    expect(await state()).toMatchObject({ hidden: false, expanded: false, collection: { count: 0 } });
    await toggle(); expect(await state()).toMatchObject({ hidden: true, expanded: false });
    await app.evaluate(() => (globalThis as typeof globalThis & { visibilityProbe: { seed(): void } }).visibilityProbe.seed());
    await toggle(); await shelf.locator('.shelf').waitFor({ state: 'attached' });
    const before = (await state()).collection;
    await shelf.getByRole('button', { name: '展开图堆', exact: true }).evaluate(button => (button as HTMLButtonElement).click());
    await expect(shelf.locator('.shelf.expanded')).toBeAttached();
    await toggle(); expect(await state()).toMatchObject({ hidden: true, expanded: true, collection: before });
    await toggle(); await expect(shelf.locator('.shelf.expanded')).toBeAttached();
    expect(await state()).toMatchObject({ hidden: false, expanded: true, collection: before });
    // Existing shelf IPC still expands/collapses; only Main can use the new toggle.
    expect((await shelf.evaluate(() => window.snipvia.collection.toggleVisibility())).ok).toBe(false);
    await shelf.evaluate(() => window.snipvia.collection.hide());
    await toggle(); expect(await state()).toMatchObject({ hidden: false, expanded: true, collection: before });
    await main.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name: '快捷键', exact: true }).evaluate(button => (button as HTMLButtonElement).click());
    await expect(main.locator('#settings-page-shortcuts').getByText('隐藏 / 显示收纳区', { exact: true })).toBeAttached();
    await expect(main.getByRole('button', { name: '设置收纳区显示快捷键', exact: true })).toHaveText(process.platform === 'darwin' ? '⌘ 4' : 'Ctrl + 4');
    await mkdir('test-results/shortcuts-visibility', { recursive: true });
    for (const theme of ['light', 'dark'] as const) {
      const result = await main.evaluate(value => window.snipvia.appearance.set(value), theme);
      expect(result.ok).toBe(true);
      await expect(main.locator('html')).toHaveAttribute('data-theme', theme);
      await main.evaluate(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
      const bytes = await app.evaluate(async ({ BrowserWindow }) => [...(await BrowserWindow.getAllWindows().find(window => !new URL(window.webContents.getURL()).hash)!.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG()]);
      await writeFile(`test-results/shortcuts-visibility/defaults-${theme}.png`, Buffer.from(bytes));
    }
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false }); });
    const clear = () => app.evaluate((_electron, key) => (globalThis as typeof globalThis & { visibilityProbe: { callbacks: Map<string, () => void> } }).visibilityProbe.callbacks.get(key)!(), defaultCapturePreferences.clearCollectionShortcut);
    await clear(); expect((await state()).collection).toEqual(before);
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); });
    await clear(); await expect.poll(async () => (await state()).collection.count).toBe(0);
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every(window => !(globalThis as typeof globalThis & { visibilityProbe: { realVisible(window: unknown): boolean } }).visibilityProbe.realVisible(window)))).toBe(true);
    expect(await app.evaluate(() => (globalThis as typeof globalThis & { visibilityProbe: { settingsShows: number } }).visibilityProbe.settingsShows)).toBe(0);
  } finally {
    await app.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) if (window.webContents.isOffscreen()) window.webContents.stopPainting(); }).catch(() => {});
    await app.close(); await rm(directory, { recursive: true, force: true });
  }
});
