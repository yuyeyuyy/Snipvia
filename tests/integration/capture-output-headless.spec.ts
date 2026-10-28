import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test('hidden real Main detaches output, preserves order and retries failed clipboard without recapturing', async () => {
  const root = resolve('.'), directory = await mkdtemp(join(tmpdir(), 'snipvia-output-hidden-'));
  const mainPath = join(root, 'out/main/index.js'), source = (await readFile(mainPath, 'utf8')).replace('show: !launchedAtLogin()', 'show: false');
  const instrument = [
    "const probe={hold:true,fail:false,crops:0,releases:0,commits:0};",
    "const fixtureImage=require('electron').nativeImage.createFromBitmap(Buffer.alloc(200*100*4,255),{width:200,height:100,scaleFactor:1});const fixturePng=fixtureImage.toPNG();",
    "require('electron').clipboard.write=async()=>{if(probe.fail)throw Error('synthetic clipboard denied');probe.commits++;};",
    "globalThis.outputHarness={probe, ready:()=>!!captureOverlayWindow?.peekWindow()&&!!screenshotToAllWindow?.peekWindow()&&!!require('electron').ipcMain._outputFinish, state:()=>outputQueue.state(), retry:()=>outputQueue.retryFailed(),",
    "async submit(){const id=screenshotPerformance.startSession({});activeCapturePerformanceSessionId=id;modeRouter.begin(id,'quick');view={width:800,height:600};captureDisplay={bounds:{x:0,y:0,width:800,height:600},workArea:{x:0,y:0,width:800,height:600}};",
    "capturedFrame={width:800,height:600,scaleFactor:1,displayId:'test',capturedAt:Date.now(),format:'jpeg',original:{png:async()=>{probe.crops++;while(probe.hold)await new Promise(r=>setTimeout(r,5));return fixturePng;},release:()=>{probe.releases++;}}};",
    "const w=captureOverlayWindow.peekWindow();return require('electron').ipcMain._outputFinish({sender:w.webContents,senderFrame:w.webContents.mainFrame},{sessionId:id,selection:{x:20,y:30,width:200,height:100}});}};"
  ].join('\n');
  const bootstrap = join(directory, 'bootstrap.cjs');
  await writeFile(bootstrap, [
    "const{app,BrowserWindow,globalShortcut,ipcMain}=require('electron');",
    "if(process.platform==='darwin'){app.setActivationPolicy('prohibited');app.setActivationPolicy=()=>{};if(app.dock){app.dock.show=async()=>{};app.dock.setIcon=()=>{};}}",
    "BrowserWindow.prototype.show=()=>{};BrowserWindow.prototype.showInactive=()=>{};BrowserWindow.prototype.focus=()=>{};",
    "globalShortcut.register=()=>true;globalShortcut.unregisterAll=()=>{};",
    "const handle=ipcMain.handle.bind(ipcMain);ipcMain.handle=(channel,fn)=>{if(channel==='capture:finish')ipcMain._outputFinish=fn;return handle(channel,fn);};",
    'app.setAppPath(' + JSON.stringify(root) + ');',
    'require("node:module")._extensions[".js"] = ((original)=>(module,path)=>path===' + JSON.stringify(mainPath) + '?module._compile(' + JSON.stringify(source + '\n' + instrument) + ',path):original(module,path))(require("node:module")._extensions[".js"]);',
    'require(' + JSON.stringify(mainPath) + ');'
  ].join('\n'));
  const app = await electron.launch({ args: [bootstrap, '--user-data-dir=' + join(directory, 'data')], env: { ...process.env, ELECTRON_RENDERER_URL: '', SNIPVIA_CAPTURE_BACKEND: 'electron', SNIPVIA_CAPTURE_WARMUP: '0' } });
  type Harness = { probe: { hold: boolean; fail: boolean; crops: number; releases: number; commits: number }; ready(): boolean; submit(): Promise<{ ok: boolean }>; state(): { pending: number; failed: number }; retry(): void };
  const evaluate = <T>(fn: (h: Harness) => T) => app.evaluate((_electron, code) => {
    const h = (globalThis as typeof globalThis & { outputHarness: Harness }).outputHarness;
    return (0, eval)('(' + code + ')')(h);
  }, fn.toString()) as Promise<Awaited<T>>;
  try {
    await expect.poll(() => evaluate(h => h?.ready())).toBe(true);
    expect((await evaluate(h => h.submit())).ok).toBe(true);
    await expect.poll(() => evaluate(h => h.probe.crops)).toBe(1);
    expect((await evaluate(h => h.submit())).ok).toBe(true);
    expect(await evaluate(h => h.state().pending)).toBe(2);
    expect(await evaluate(h => h.probe.commits)).toBe(0);
    await evaluate(h => { h.probe.hold = false; });
    await expect.poll(() => evaluate(h => h.probe.commits)).toBe(2);
    expect(await evaluate(h => h.probe.releases)).toBe(2);
    await evaluate(h => { h.probe.fail = true; });
    expect((await evaluate(h => h.submit())).ok).toBe(true);
    await expect.poll(() => evaluate(h => h.state().failed)).toBe(1);
    expect(await evaluate(h => h.probe.releases)).toBe(3);
    await evaluate(h => { h.probe.fail = false; h.retry(); });
    await expect.poll(() => evaluate(h => h.probe.commits)).toBe(3);
    expect(await evaluate(h => h.probe.crops)).toBe(3); // Retry uses the encoded PNG.
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every(w => !w.isVisible()))).toBe(true);
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});
