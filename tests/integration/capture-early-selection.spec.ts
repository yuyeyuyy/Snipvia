import { expect, test } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { launchDesktop } from '../helpers/desktop';

for (const fallback of [false, true]) {
  test(`selection starts before pixels arrive and survives ${fallback ? 'fallback' : 'native capture'}`, async () => {
    test.skip(process.platform !== 'darwin', 'Early self-excluding capture is macOS only');
    const directory = await mkdtemp(join(tmpdir(), 'snipvia-early-selection-'));
    const root = resolve('.'), mainPath = join(root, 'out/main/index.js'), bootstrap = join(directory, 'bootstrap.cjs');
    const instrument = `
      ScreenCaptureKitBackend.prototype.initialize = async function () {};
      ScreenCaptureKitBackend.prototype.isAvailable = async function () { return true; };
      ScreenCaptureKitBackend.prototype.shouldAttemptCapture = function () { return true; };
      ScreenCaptureKitBackend.prototype.captureDisplay = async function (request) {
        await new Promise(resolve => { globalThis.releasePixels = resolve; });
        ${fallback ? "throw new Error('synthetic native failure');" : `const width = Math.round(request.display.size.width * request.display.scaleFactor), height = Math.round(request.display.size.height * request.display.scaleFactor);
        return { width, height, displayId: request.display.id, scaleFactor: request.display.scaleFactor, capturedAt: Date.now(), format: 'bgra', image: require('electron').nativeImage.createFromBuffer(Buffer.alloc(width * height * 4,255), {width,height}) };`}
      };
    `;
    await writeFile(bootstrap, `
      const {app,systemPreferences,desktopCapturer,nativeImage,screen,clipboard} = require('electron');
      clipboard.write = async () => {};
      app.setAppPath(${JSON.stringify(root)});
      systemPreferences.getMediaAccessStatus = () => 'granted';
      desktopCapturer.getSources = async options => {
        const size=options.thumbnailSize, display=screen.getPrimaryDisplay();
        return [{id:'screen:synthetic',name:'Synthetic',display_id:String(display.id),appIcon:nativeImage.createEmpty(),thumbnail:nativeImage.createFromBuffer(Buffer.alloc(size.width*size.height*4,255),size)}];
      };
      const Module=require('node:module'), load=Module._extensions['.js'];
      Module._extensions['.js']=(module,path)=>{if(path!==${JSON.stringify(mainPath)})return load(module,path);module._compile(require('node:fs').readFileSync(path,'utf8')+${JSON.stringify(instrument)},path);};
      require(${JSON.stringify(mainPath)});
    `);
    const app = await launchDesktop({ args: [bootstrap, `--user-data-dir=${join(directory, 'data')}`], env: { ...process.env, SNIPVIA_CAPTURE_BACKEND: 'auto', SNIPVIA_CAPTURE_WARMUP: '0' } });
    try {
      const main = await app.firstWindow();
      await expect.poll(() => app.windows().some(window => window.url().endsWith('#capture'))).toBe(true);
      const overlay = app.windows().find(window => window.url().endsWith('#capture'))!;
      await main.evaluate(() => { void window.snipvia.capture.start(); });
      await expect.poll(() => app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows().some(window => window.webContents.getURL().endsWith('#capture') && window.isVisible()))).toBe(true);
      await expect(overlay.locator('.screen-frame')).toHaveCount(0);
      await overlay.mouse.move(100,100); await overlay.mouse.down(); await overlay.mouse.move(350,250); await overlay.mouse.up();
      await expect(overlay.locator('.selection')).toBeVisible();
      const sessionId = await overlay.locator('.capture-overlay').getAttribute('data-performance-session');
      await app.evaluate(() => (globalThis as typeof globalThis & {releasePixels:()=>void}).releasePixels());
      await expect.poll(async () => { const r = await main.evaluate(id => window.snipvia.performance.report(id!), sessionId); return r.ok && r.value?.marks.some(mark => mark.event === 'clipboard_committed'); }).toBe(true);
      expect(app.windows().some(window => window.url().endsWith('#quick-chat'))).toBe(false);
      expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('#pin'))!.isVisible())).toBe(false);
      // Queued selection still retains exact DIP dimensions after delayed pixels.
      const report = await main.evaluate(id => window.snipvia.performance.report(id!), sessionId);
      expect(report.ok && report.value?.metadata.selectionWidthDip).toBe(250);
      expect(report.ok && report.value?.metadata.selectionHeightDip).toBe(150);
      expect(report.ok && report.value?.measures.find(m => m.id === 'selection-clipboard')?.durationMs).toBeGreaterThan(0);
      await expect.poll(() => app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows().some(window => ['#capture','#pin','#quick-chat'].some(hash => window.webContents.getURL().endsWith(hash)) && window.isVisible()))).toBe(false);
    } finally { await app.close(); await rm(directory, {recursive:true,force:true}); }
  });
}
