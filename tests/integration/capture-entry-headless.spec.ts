import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test('hidden real Renderer can select before a delayed frame, including the next capture', async () => {
  const root = resolve('.'), directory = await mkdtemp(join(tmpdir(), 'snipvia-entry-hidden-'));
  const mainPath = join(root, 'out/main/index.js'), original = await readFile(mainPath, 'utf8');
  expect(original).toContain('show: !launchedAtLogin()');
  const source = original.replace('show: !launchedAtLogin()', 'show: false').replace('const webPreferences = {', 'const webPreferences = { offscreen: true,');
  const instrument = [
    '(() => {',
    "const probe={hold:true,commits:0,frameReady:false,wakeBeforeFrame:0};",
    "const image=require('electron').nativeImage.createFromBitmap(Buffer.alloc(200*100*4,255),{width:200,height:100,scaleFactor:1});",
    "const png=image.toPNG();require('electron').clipboard.write=async()=>{probe.commits++;};",
    "globalThis.entryHarness={probe, ready:()=>captureOverlayPreloaded&&!!screenshotToAllWindow?.peekWindow(),",
    "start(){probe.hold=true;probe.frameReady=false;process.env.SNIPVIA_CAPTURE_BACKEND='sck';",
    "captureEngine={dispose:async()=>{},invalidateDisplays:async()=>{},captureDisplay:async()=>{while(probe.hold)await new Promise(r=>setTimeout(r,5));probe.frameReady=true;return{backend:'screen-capture-kit',fallbackUsed:false,frame:{width:200,height:100,scaleFactor:1,displayId:'synthetic',capturedAt:Date.now(),format:'jpeg',preview:{bytes:image.toJPEG(95),mimeType:'image/jpeg',transport:'jpeg-95'},original:{png:async()=>png,release:()=>{}}}};}};",
    "const w=captureOverlayWindow.peekWindow();w.show=()=>{if(!probe.frameReady)probe.wakeBeforeFrame++;};",
    "void startCapture('hotkey','quick').catch(e=>{probe.error=e.message;});return activeCapturePerformanceSessionId;}};",
    '})();'
  ].join('\n');
  const bootstrap = join(directory, 'bootstrap.cjs');
  await writeFile(bootstrap, [
    "const{app,BrowserWindow,globalShortcut,systemPreferences}=require('electron');",
    "if(process.platform==='darwin'){app.setActivationPolicy('prohibited');app.setActivationPolicy=()=>{};if(app.dock){app.dock.show=async()=>{};app.dock.setIcon=()=>{};}}",
    "BrowserWindow.prototype.show=()=>{};BrowserWindow.prototype.showInactive=()=>{};BrowserWindow.prototype.focus=()=>{};",
    "globalShortcut.register=()=>true;globalShortcut.unregisterAll=()=>{};systemPreferences.getMediaAccessStatus=()=> 'granted';",
    'app.setAppPath(' + JSON.stringify(root) + ');',
    'require("node:module")._extensions[".js"]=((original)=>(module,path)=>path===' + JSON.stringify(mainPath) + '?module._compile(' + JSON.stringify(source + '\n' + instrument) + ',path):original(module,path))(require("node:module")._extensions[".js"]);',
    'require(' + JSON.stringify(mainPath) + ');'
  ].join('\n'));
  const app = await electron.launch({ args: [bootstrap, '--user-data-dir=' + join(directory, 'data')], env: { ...process.env,
    ELECTRON_RENDERER_URL: '', SNIPVIA_CAPTURE_BACKEND: 'electron', SNIPVIA_CAPTURE_WARMUP: '0', SNIPVIA_PERF: '' } });
  type Harness = { ready(): boolean; start(): string; probe: { hold: boolean; frameReady: boolean; commits: number; wakeBeforeFrame: number; error?: string } };
  const evaluate = <T>(fn: (h: Harness) => T) => app.evaluate((_electron, code) => {
    const h = (globalThis as typeof globalThis & { entryHarness: Harness }).entryHarness;
    return (0, eval)('(' + code + ')')(h);
  }, fn.toString()) as Promise<Awaited<T>>;
  try {
    await expect.poll(() => evaluate(h => h?.ready())).toBe(true);
    const overlay = app.windows().find(page => page.url().endsWith('#capture'))!;
    for (let capture = 1; capture <= 2; capture++) {
      const sessionId = await evaluate(h => h.start());
      await expect(overlay.locator('.capture-overlay')).toHaveAttribute('data-performance-session', sessionId);
      await overlay.evaluate(() => {
        const element = document.querySelector('.capture-overlay')! as HTMLElement;
        element.setPointerCapture = () => {};
        element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1, clientX: 20, clientY: 30 }));
        element.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, clientX: 180, clientY: 90 }));
        element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, clientX: 180, clientY: 90 }));
      });
      await expect(overlay.locator('.selection')).toHaveCount(1);
      expect(await evaluate(h => h.probe.frameReady)).toBe(false);
      expect(await evaluate(h => h.probe.wakeBeforeFrame)).toBe(capture);
      expect(await evaluate(h => h.probe.commits)).toBe(capture - 1);
      await evaluate(h => { h.probe.hold = false; });
      await expect.poll(() => evaluate(h => h.probe.commits)).toBe(capture);
      await expect(overlay.locator('.capture-overlay[data-performance-session]')).toHaveCount(0);
      expect(await evaluate(h => h.probe.error)).toBeUndefined();
    }
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every(window => !window.isVisible()))).toBe(true);
  } finally {
    await evaluate(h => { h.probe.hold = false; }).catch(() => {});
    await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) if (w.webContents.isOffscreen()) w.webContents.stopPainting(); }).catch(() => {});
    await app.close(); await rm(directory, { recursive: true, force: true });
  }
});
