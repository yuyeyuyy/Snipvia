import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
test.use({ trace: 'off', screenshot: 'off', video: 'off' });

test('Quick output drives the configured target bar without stale UI, implicit navigation or cross-window IPC', async () => {
  const root = resolve('.'), directory = await mkdtemp(join(tmpdir(), 'snipvia-target-ui-'));
  const mainPath = join(root, 'out/main/index.js'), source = (await readFile(mainPath, 'utf8')).replace('show: !launchedAtLogin()', 'show: false');
  const instrument = [
    "const probe={commits:0,visits:0,hold:false,fail:false,items:[],marker:false,chromeMode:'ambiguous',selections:0,permissionRequests:0};",
    "const fixturePng=require('electron').nativeImage.createFromBitmap(Buffer.alloc(160*100*4,255),{width:160,height:100}).toPNG();",
    "require('electron').clipboard.write=async items=>{if(probe.fail)throw Error('Synthetic clipboard failure');probe.items=items;probe.commits++;probe.marker=items[0].types.includes('web application/x.snipvia.quick-target');};",
    "require('electron').clipboard.read=async()=>probe.items;require('electron').shell.openExternal=async()=>{probe.visits++;};",
    "globalThis.quickTargetHarness={probe,ready:()=>quickTargetWindow?.isReady()??false,state:()=>quickTargetService.current(),queue:()=>outputQueue.state(),",
    "noNetwork(){websiteIcons.configure=()=>{};websiteIcons.current=()=>undefined;quickTargetRegistry.platform.browserIcon=async mode=>mode==='chrome'?'data:image/png;base64,'+fixturePng.toString('base64'):undefined;},",
    "async websiteArtwork(){websiteIcons.current=()=>'data:image/png;base64,'+fixturePng.toString('base64');await publishQuickTargetArtwork();},",
    "invalidate:()=>quickTargetService.beginCapture('next-capture'),retry:()=>outputQueue.retryFailed(),",
    "async collect(){for(let i=0;i<3;i++){const item=screenshots.create(fixturePng,{width:160,height:100,mimeType:'image/png'});collection.append(item.id);}await shelfWindow.toggle();return{ids:collection.snapshot().items.map(item=>item.id),revision:collection.snapshot().revision};},",
    "async icons(){const good='/Applications/Synthetic Artwork.app',bad='/Applications/Synthetic Broken.app';const image=require('electron').nativeImage.createFromBitmap(Buffer.from(Array.from({length:32*32*4},(_,i)=>[180,120,20,255][i%4])),{width:32,height:32});quickTargetRegistry.platform.icon=async path=>path===good?image.toDataURL():'data:image/png;base64,invalid';require('electron').app.getFileIcon=async()=>image;for(const[label,path]of[['Artwork',good],['Broken',bad]])quickTargetRegistry.store.add({id:require('node:crypto').randomUUID(),kind:'application',label,path,bundleId:'com.snipvia.test.'+label});return refreshQuickTargets();},",
    "chrome(){quickTargetRegistry.platform.permissions=async()=>({supported:true,chromeRunning:true,automation:probe.chromeMode==='denied'?'denied':'granted',accessibility:true});",
    "quickTargetRegistry.platform.requestPermission=async()=>{probe.permissionRequests++;return{supported:true,chromeRunning:true,automation:'required',accessibility:true};};",
    "quickTargetRegistry.platform.tabs=async target=>[{windowId:'11',tabId:'22',url:target.url,title:'Synthetic conversation A',index:1},{windowId:'33',tabId:'44',url:target.url,title:'Synthetic conversation B',index:2}];",
    "quickTargetRegistry.platform.resolve=async(target,signal)=>{const permissions=await quickTargetRegistry.platform.permissions();return permissions.automation==='granted'?{kind:'choices',permissions,tabs:await quickTargetRegistry.platform.tabs(target,signal)}:{kind:'unavailable',permissions};};",
    "quickTargetRegistry.platform.select=async(tab,focus)=>{if(probe.chromeMode==='changed')throw Error('标签已关闭或跳转');probe.selections++;return{activated:true,focused:focus&&probe.chromeMode!=='manual',accessibility:true};};},",
    "async submit(mode='quick'){const id=screenshotPerformance.startSession({});quickTargetService.beginCapture(id);activeCapturePerformanceSessionId=id;modeRouter.begin(id,mode);view={width:800,height:600};captureDisplay={bounds:{x:0,y:0,width:800,height:600},workArea:{x:0,y:0,width:800,height:600}};",
    "capturedFrame={width:800,height:600,scaleFactor:1,displayId:'test',capturedAt:Date.now(),format:'jpeg',original:{png:async()=>{while(probe.hold)await new Promise(r=>setTimeout(r,5));return fixturePng;},release:()=>{}}};",
    "const w=captureOverlayWindow.peekWindow();return require('electron').ipcMain._targetFinish({sender:w.webContents,senderFrame:w.webContents.mainFrame},{sessionId:id,selection:{x:20,y:30,width:160,height:100}});}};"
  ].join('\n');
  const bootstrap = join(directory, 'bootstrap.cjs');
  await writeFile(bootstrap, [
    "const{app,BrowserWindow,globalShortcut,ipcMain}=require('electron');",
    "if(process.platform==='darwin'){app.setActivationPolicy('prohibited');app.setActivationPolicy=()=>{};if(app.dock){app.dock.show=async()=>{};app.dock.setIcon=()=>{};}}",
    "BrowserWindow.prototype.show=()=>{};BrowserWindow.prototype.showInactive=()=>{};BrowserWindow.prototype.focus=()=>{};",
    "globalShortcut.register=()=>true;globalShortcut.unregisterAll=()=>{};",
    "const handle=ipcMain.handle.bind(ipcMain);ipcMain.handle=(channel,fn)=>{if(channel==='capture:finish')ipcMain._targetFinish=fn;return handle(channel,fn);};",
    'app.setAppPath(' + JSON.stringify(root) + ');',
    'require("node:module")._extensions[".js"]=((original)=>(module,path)=>path===' + JSON.stringify(mainPath) + '?module._compile(' + JSON.stringify(source + '\n' + instrument) + ',path):original(module,path))(require("node:module")._extensions[".js"]);',
    'require(' + JSON.stringify(mainPath) + ');'
  ].join('\n'));
  const app = await electron.launch({ args: [bootstrap, '--user-data-dir=' + join(directory, 'data')], env: { ...process.env, ELECTRON_RENDERER_URL: '', SNIPVIA_CAPTURE_BACKEND: 'electron', SNIPVIA_CAPTURE_WARMUP: '0' } });
  type Harness = { probe: { commits: number; visits: number; hold: boolean; fail: boolean; items: { types: string[] }[]; marker: boolean; chromeMode: string; selections: number; permissionRequests: number }; noNetwork(): void; websiteArtwork(): Promise<void>; icons(): Promise<unknown>; chrome(): void; ready(): boolean; state(): { visible: boolean; presentationId: number }; queue(): { pending: number; failed: number }; submit(mode?: string): Promise<{ ok: boolean }>; invalidate(): void; retry(): void; collect(): Promise<{ ids: string[]; revision: number }> };
  const evaluate = <T>(fn: (h: Harness) => T) => app.evaluate((_electron, code) => {
    const h = (globalThis as typeof globalThis & { quickTargetHarness: Harness }).quickTargetHarness;
    return (0, eval)('(' + code + ')')(h);
  }, fn.toString()) as Promise<Awaited<T>>;
  try {
    const main = await app.firstWindow(); await main.locator('.app-shell').waitFor();
    await main.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name: '快速切换', exact: true }).click();
    await evaluate(h => h.noNetwork());
    await expect.poll(() => app.windows().some(page => page.url().endsWith('#capture'))).toBe(true);
    await app.windows().find(page => page.url().endsWith('#capture'))!.locator('.capture-overlay').waitFor({ state: 'attached' });
    expect((await main.evaluate(() => window.snipvia.quickTarget.current())).ok).toBe(false);
    for (const [label, url] of [['ChatGPT', 'https://chatgpt.com/'], ['DeepSeek', 'https://chat.deepseek.com/']]) {
      await main.getByRole('button', { name: '添加网页', exact: true }).click();
      await main.getByRole('textbox', { name: '网页目标名称' }).fill(label);
      await main.getByRole('textbox', { name: '网页目标网址' }).fill(url);
      await main.getByRole('button', { name: '添加', exact: true }).click();
      await expect(main.getByRole('textbox', { name: '网页目标名称' })).toHaveCount(0);
    }
    await main.getByRole('checkbox', { name: '显示快速切换条', exact: true }).check();
    await expect.poll(() => evaluate(h => h.ready())).toBe(true);
    const bar = app.windows().find(page => page.url().endsWith('#quick-target'))!;
    expect((await evaluate(h => h.submit())).ok).toBe(true);
    await expect(bar.locator('.quick-target-item')).toHaveCount(2);
    await expect(main.locator('.quick-target-setting-identity .quick-target-artwork > svg path')).toHaveCount(2);
    await expect(bar.locator('.quick-target-artwork > svg path')).toHaveCount(2);
    await expect(bar.locator('.quick-target-browser-badge')).toHaveCount(2);
    expect(await bar.locator('.quick-target-browser-badge').first().evaluate(element => {
      const badge = element.getBoundingClientRect(), icon = element.parentElement!.getBoundingClientRect();
      return badge.left < icon.left && badge.bottom > icon.bottom && badge.width < icon.width / 2;
    })).toBe(true);
    expect(await bar.locator('.quick-target-artwork > svg path').evaluateAll(paths => new Set(paths.map(path => path.getAttribute('d'))).size)).toBe(2);
    expect(await evaluate(h => h.probe.marker)).toBe(true); expect(await evaluate(h => h.probe.visits)).toBe(0);
    const state = await evaluate(h => h.state());
    expect((await main.evaluate(value => window.snipvia.quickTarget.activate(value), { presentationId: state.presentationId, targetId: '00000000-0000-4000-8000-000000000000' })).ok).toBe(false);
    expect((await bar.evaluate(async () => { const state = await window.snipvia.quickTarget.current(); if (!state.ok) throw Error(state.error); return window.snipvia.quickTarget.activate({ presentationId: state.value.presentationId, targetId: '00000000-0000-4000-8000-000000000000' }); })).ok).toBe(false);
    await bar.locator('.quick-target-item').filter({ hasText: 'ChatGPT' }).click();
    await expect.poll(() => evaluate(h => h.probe.visits)).toBe(1); await expect.poll(() => evaluate(h => h.state().visible)).toBe(false);
    for (let index = 0; index < 10; index++) {
      expect((await evaluate(h => h.submit())).ok).toBe(true);
      await expect.poll(() => evaluate(h => h.state().visible)).toBe(true);
    }
    const imageDirectory = join(root, '.dev-runtime/quick-target-phase1'); await mkdir(imageDirectory, { recursive: true });
    await bar.screenshot({ path: join(imageDirectory, 'bar-light.png') });
    await main.evaluate(() => window.snipvia.appearance.set('dark')); await bar.screenshot({ path: join(imageDirectory, 'bar-dark.png') });
    await evaluate(h => { h.probe.items = []; });
    await expect.poll(() => evaluate(h => h.state().visible)).toBe(false); expect(await evaluate(h => h.probe.visits)).toBe(1);
    await evaluate(h => { h.probe.hold = true; }); expect((await evaluate(h => h.submit())).ok).toBe(true);
    await evaluate(h => { h.invalidate(); h.probe.hold = false; }); await expect.poll(() => evaluate(h => h.queue().pending)).toBe(0);
    expect(await evaluate(h => h.state().visible)).toBe(false);
    await evaluate(h => { h.probe.fail = true; }); expect((await evaluate(h => h.submit())).ok).toBe(true);
    await expect.poll(() => evaluate(h => h.queue().failed)).toBe(1); expect(await evaluate(h => h.state().visible)).toBe(false);
    await evaluate(h => { h.probe.fail = false; h.retry(); }); await expect.poll(() => evaluate(h => h.queue().pending)).toBe(0);
    await expect.poll(() => evaluate(h => h.state().visible)).toBe(true);
    const settings = await main.evaluate(() => window.snipvia.quickTarget.settings()); if (!settings.ok) throw Error(settings.error);
    expect(settings.value.targets.map(target => target.label)).toEqual(['ChatGPT', 'DeepSeek']);
    expect(JSON.stringify(settings.value)).not.toContain('bundleId'); expect(JSON.stringify(settings.value)).not.toContain('path');
    await evaluate(h => { h.chrome(); h.probe.chromeMode = 'denied'; });
    await main.getByRole('button', { name: '刷新权限', exact: true }).click();
    await expect(main.getByRole('button', { name: '授权 Chrome…', exact: true })).toBeEnabled();
    await main.getByRole('button', { name: '授权 Chrome…', exact: true }).click();
    await expect(main.locator('.preference-status')).toContainText('尚未授予控制 Chrome');
    expect(await evaluate(h => h.probe.permissionRequests)).toBe(1);
    await evaluate(h => { h.probe.chromeMode = 'ambiguous'; });
    await main.getByRole('combobox', { name: 'ChatGPT 切换方式' }).selectOption('existing-tab');
    await main.getByRole('checkbox', { name: 'ChatGPT 聚焦消息输入框' }).click();
    await expect(main.getByRole('checkbox', { name: 'ChatGPT 聚焦消息输入框' })).toBeChecked();
    expect((await evaluate(h => h.submit())).ok).toBe(true);
    await expect(bar.locator('.quick-target-item')).toHaveCount(2);
    await bar.locator('.quick-target-item').filter({ hasText: 'ChatGPT' }).click();
    await expect(bar.getByRole('group', { name: '选择 Chrome 标签' }).getByRole('button')).toHaveCount(2);
    const chromeState = await bar.evaluate(() => window.snipvia.quickTarget.current());
    if (!chromeState.ok) throw Error(chromeState.error);
    expect(JSON.stringify(chromeState.value.choices)).not.toMatch(/windowId|tabId|https:/);
    expect((await bar.evaluate(value => window.snipvia.quickTarget.activate({ presentationId: value.presentation, targetId: value.id, choiceId: '00000000-0000-4000-8000-000000000000' }), { presentation: chromeState.value.presentationId, id: settings.value.targets[0].id })).ok).toBe(false);
    expect((await bar.evaluate(id => window.snipvia.quickTarget.configureBrowser({ id, mode: 'open', match: 'origin', focusInput: false }), settings.value.targets[0].id)).ok).toBe(false);
    const phase2Images = join(root, '.dev-runtime/quick-target-phase2'); await mkdir(phase2Images, { recursive: true });
    await main.evaluate(() => window.snipvia.appearance.set('light')); await expect(bar.locator('html')).toHaveAttribute('data-theme', 'light');
    await bar.screenshot({ path: join(phase2Images, 'chrome-choices-light.png'), animations: 'disabled' });
    await main.evaluate(() => window.snipvia.appearance.set('dark')); await expect(bar.locator('html')).toHaveAttribute('data-theme', 'dark');
    await bar.screenshot({ path: join(phase2Images, 'chrome-choices-dark.png'), animations: 'disabled' });
    await bar.getByRole('button', { name: /Synthetic conversation B/ }).click();
    await expect.poll(() => evaluate(h => h.probe.selections)).toBe(1);
    await expect.poll(() => evaluate(h => h.state().visible)).toBe(false);
    expect(await evaluate(h => h.probe.visits)).toBe(1);
    await evaluate(h => { h.probe.chromeMode = 'manual'; });
    await evaluate(h => h.submit()); await expect(bar.locator('.quick-target-item')).toHaveCount(2);
    await bar.locator('.quick-target-item').filter({ hasText: 'ChatGPT' }).click();
    await bar.getByRole('button', { name: /Synthetic conversation A/ }).click();
    await expect.poll(() => evaluate(h => h.state().visible)).toBe(false);
    await expect(bar.locator('.quick-target-notice')).toHaveCount(0);
    expect(await evaluate(h => h.probe.marker)).toBe(true);
    await evaluate(h => { h.probe.chromeMode = 'denied'; });
    await evaluate(h => h.submit()); await expect(bar.locator('.quick-target-item')).toHaveCount(2);
    await bar.locator('.quick-target-item').filter({ hasText: 'ChatGPT' }).click();
    await expect(bar.getByRole('alert')).toContainText('授权控制 Chrome');
    await evaluate(h => { h.probe.chromeMode = 'ambiguous'; });
    await bar.locator('.quick-target-item').filter({ hasText: 'ChatGPT' }).click();
    await expect(bar.locator('.quick-target-choice')).toHaveCount(2);
    await evaluate(h => { h.probe.chromeMode = 'changed'; });
    await bar.getByRole('button', { name: /Synthetic conversation A/ }).click();
    await expect(bar.getByRole('alert')).toContainText('关闭或跳转');
    await evaluate(h => h.invalidate()); await expect.poll(() => evaluate(h => h.state().visible)).toBe(false);
    expect(await evaluate(h => h.probe.selections)).toBe(2);
    expect(await evaluate(h => h.probe.permissionRequests)).toBe(1);
    expect(await evaluate(h => h.probe.visits)).toBe(1);
    await main.evaluate(async order => window.snipvia.quickTarget.configure({ enabled: false, durationMs: 4000, launchApplications: false, order }), settings.value.targets.map(target => target.id));
    expect((await evaluate(h => h.submit())).ok).toBe(true); await expect.poll(() => evaluate(h => h.queue().pending)).toBe(0);
    expect(await evaluate(h => h.state().visible)).toBe(false); expect(await evaluate(h => h.probe.marker)).toBe(false);
    // The same component displays native PNGs, local brands and failed-image fallback in both surfaces.
    await evaluate(h => h.icons());
    await main.reload();
    await main.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name: '快速切换', exact: true }).click();
    await expect(main.locator('.quick-target-setting-row').filter({ hasText: 'Artwork' })).toBeVisible();
    await main.getByRole('combobox', { name: '快速切换显示时间' }).selectOption('15000');
    await main.getByRole('checkbox', { name: '显示快速切换条', exact: true }).check();
    await expect.poll(() => evaluate(h => h.ready())).toBe(true);
    const artworkBar = app.windows().find(page => page.url().endsWith('#quick-target'))!;
    expect((await evaluate(h => h.submit())).ok).toBe(true);
    const artwork = artworkBar.locator('.quick-target-item').filter({ hasText: 'Artwork' });
    await expect(artwork.locator('img')).toHaveCount(1);
    await expect.poll(() => artwork.locator('img').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(32);
    if (process.platform === 'darwin') {
      const broken = artworkBar.locator('.quick-target-item').filter({ hasText: 'Broken' });
      await expect(broken.locator('img')).toHaveCount(0); await expect(broken.locator('svg')).toHaveCount(1);
      const settingsBroken = main.locator('.quick-target-setting-row').filter({ hasText: 'Broken' });
      await expect(settingsBroken.locator('img')).toHaveCount(0); await expect(settingsBroken.locator('svg')).toHaveCount(1);
    }
    const artworkImages = join(root, '.dev-runtime/quick-target-phase2');
    for (const theme of ['light', 'dark'] as const) {
      await main.evaluate(value => window.snipvia.appearance.set(value), theme);
      await expect(artworkBar.locator('html')).toHaveAttribute('data-theme', theme);
      const icon = artworkBar.locator('.quick-target-item').filter({ hasText: 'ChatGPT' }).locator('.quick-target-artwork > svg');
      expect(await icon.evaluate(element => getComputedStyle(element).fill)).toBe(theme === 'light' ? 'rgb(23, 23, 23)' : 'rgb(245, 245, 245)');
      await artworkBar.screenshot({ path: join(artworkImages, 'icons-' + theme + '.png'), animations: 'disabled' });
    }
    const beforeArtwork = await evaluate(h => h.state());
    await evaluate(h => h.websiteArtwork());
    const website = artworkBar.locator('.quick-target-item').filter({ hasText: 'ChatGPT' });
    await expect(website.locator('.quick-target-artwork > img')).toHaveCount(1);
    await expect(main.locator('.quick-target-setting-row').filter({ hasText: 'ChatGPT' }).locator('.quick-target-artwork > img')).toHaveCount(1);
    expect((await evaluate(h => h.state())).presentationId).toBe(beforeArtwork.presentationId);
    expect((await evaluate(h => h.state())).visible).toBe(true);
    await expect(website.locator('.quick-target-browser-badge')).toHaveCount(1);
    await expect(website.locator('.quick-target-browser-badge img')).toHaveCount(1);
    expect(await website.locator('.quick-target-browser-badge img').evaluate(element => element.getBoundingClientRect().width)).toBeLessThan(15);
    // Shelf copy paths use the same real Main/Preload routes and optional chooser.
    const collection = await evaluate(h => h.collect());
    await expect.poll(() => app.windows().some(page => page.url().endsWith('#shelf'))).toBe(true);
    const shelf = app.windows().find(page => page.url().endsWith('#shelf'))!;
    await expect(shelf.locator('.shelf.expanded .shelf-preview img')).toHaveCount(3);
    const copied = async () => {
      await expect.poll(() => evaluate(h => h.state().visible)).toBe(true);
      expect(await evaluate(h => h.probe.marker)).toBe(true);
      await expect(artworkBar.locator('.quick-target-item')).toHaveCount(4);
      const popupDisplay = await app.evaluate(({ BrowserWindow, screen }) => {
        const windows = BrowserWindow.getAllWindows();
        const shelf = windows.find(w => w.webContents.getURL().endsWith('#shelf'))!;
        const bar = windows.find(w => w.webContents.getURL().endsWith('#quick-target'))!;
        const area = screen.getDisplayMatching(shelf.getBounds()).workArea;
        const bounds = bar.getBounds();
        return { centered: Math.abs(bounds.x + bounds.width / 2 - (area.x + area.width / 2)) < 1, inside: bounds.y >= area.y && bounds.y + bounds.height <= area.y + area.height };
      });
      expect(popupDisplay).toEqual({ centered: true, inside: true });
      await artworkBar.evaluate(async () => { const state = await window.snipvia.quickTarget.current(); if (!state.ok) throw Error(state.error); return window.snipvia.quickTarget.dismiss({ presentationId: state.value.presentationId }); });
      await expect.poll(() => evaluate(h => h.state().visible)).toBe(false);
    };
    expect((await shelf.evaluate(id => window.snipvia.collection.copy(id), collection.ids[0])).ok).toBe(true);
    await copied();
    expect(await evaluate(h => h.probe.items.map(item => item.types))).toEqual([['image/png', 'web application/x.snipvia.quick-target']]);
    const merge = shelf.getByRole('button', { name: '合并复制', exact: true });
    await merge.evaluate(button => (button as HTMLButtonElement).click());
    await expect(merge).toHaveAttribute('data-action-state', 'success'); await copied();
    expect(await evaluate(h => h.probe.items.map(item => item.types))).toEqual([['image/png', 'web application/x.snipvia.quick-target']]);
    expect((await shelf.evaluate(revision => window.snipvia.collection.copyAll({ revision }), collection.revision)).ok).toBe(true);
    await copied();
    expect(await evaluate(h => h.probe.items.map(item => item.types))).toEqual([['text/uri-list', 'web application/x.snipvia.quick-target']]);
    expect(await app.evaluate(async ({ clipboard }) => {
      const items = await clipboard.read(); const fileList = await items[0].getType('text/uri-list');
      return fileList instanceof Blob ? (await fileList.text()).split('\r\n').length : 0;
    })).toBe(3);
    await evaluate(h => { h.probe.fail = true; });
    for (const request of ['single', 'all'] as const) {
      const result = await shelf.evaluate(({ request, collection }) => request === 'single' ? window.snipvia.collection.copy(collection.ids[0]) : window.snipvia.collection.copyAll({ revision: collection.revision }), { request, collection });
      expect(result.ok).toBe(false); expect(await evaluate(h => h.state().visible)).toBe(false);
    }
    await expect(merge).toHaveAttribute('data-action-state', 'idle');
    await merge.evaluate(button => (button as HTMLButtonElement).click());
    await expect(shelf.getByRole('status')).toContainText('Synthetic clipboard failure');
    expect(await evaluate(h => h.state().visible)).toBe(false);
    await evaluate(h => { h.probe.fail = false; });
    const configured = await main.evaluate(() => window.snipvia.quickTarget.settings()); if (!configured.ok) throw Error(configured.error);
    await main.evaluate(order => window.snipvia.quickTarget.configure({ enabled: false, durationMs: 4000, launchApplications: false, order }), configured.value.targets.map(target => target.id));
    expect((await shelf.evaluate(id => window.snipvia.collection.copy(id), collection.ids[0])).ok).toBe(true);
    expect(await evaluate(h => h.state().visible)).toBe(false);
    expect(await evaluate(h => h.probe.marker)).toBe(false);

  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});
