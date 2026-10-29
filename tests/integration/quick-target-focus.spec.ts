import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { launchDesktop } from '../helpers/desktop';

test('a non-activating Quick bar preserves the previous app and never opens Settings on click or keyboard focus', async () => {
  test.skip(process.platform !== 'darwin', 'macOS foreground acceptance');
  const directory = await mkdtemp(join(tmpdir(), 'snipvia-target-focus-'));
  const app = await launchDesktop({ args: ['.', '--user-data-dir=' + join(directory, 'primary')], env: { ...process.env, SNIPVIA_CAPTURE_BACKEND: 'electron', SNIPVIA_CAPTURE_WARMUP: '0' } });
  const bootstrap = join(directory, 'peer.cjs');
  await writeFile(bootstrap, "const{app,BrowserWindow}=require('electron');app.setName('Snipvia synthetic target peer');app.whenReady().then(()=>{const w=new BrowserWindow({width:420,height:220,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});w.loadURL('data:text/html,<input autofocus placeholder=Synthetic-focus-test>')});app.on('window-all-closed',()=>app.quit());");
  const peer = await electron.launch({ args: [bootstrap, '--user-data-dir=' + join(directory, 'peer')] });
  try {
    await peer.firstWindow();
    await app.evaluate(({ systemPreferences, desktopCapturer, nativeImage, screen, clipboard }) => {
      systemPreferences.getMediaAccessStatus = () => 'granted';
      let items: Electron.ClipboardItem[] = []; clipboard.write = async value => { items = value; }; clipboard.read = async () => items;
      desktopCapturer.getSources = async options => { const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()), size = options.thumbnailSize!; return [{ id: 'screen:target-synthetic', display_id: String(d.id), name: 'Synthetic', appIcon: nativeImage.createEmpty(), thumbnail: nativeImage.createFromBitmap(Buffer.alloc(size.width * size.height * 4, 180), size) }]; };
    });
    const main = await app.firstWindow(), mainNative = await app.browserWindow(main), overlay = app.windows().find(page => page.url().endsWith('#capture'))!;
    await main.evaluate(async () => {
      const result = await window.snipvia.quickTarget.addWebsite({ label: 'Synthetic', url: 'https://example.invalid/' }); if (!result.ok) throw Error(result.error);
      await window.snipvia.quickTarget.configure({ enabled: true, durationMs: 10000, launchApplications: false, order: result.value.targets.map(target => target.id) });
    });
    await expect.poll(() => app.windows().some(page => page.url().endsWith('#quick-target'))).toBe(true);
    const bar = app.windows().find(page => page.url().endsWith('#quick-target'))!;
    await bar.waitForFunction(() => !!window.snipvia?.quickTarget);
    for (const keyboard of [false, true]) {
      console.info('[quick-target focus]', keyboard ? 'keyboard' : 'pointer');
      await peer.evaluate(({ app, BrowserWindow }) => { app.focus({ steal: true }); BrowserWindow.getAllWindows()[0].focus(); });
      await expect.poll(() => peer.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFocused())).toBe(true);
      expect((await main.evaluate(() => window.snipvia.capture.start('quick'))).ok).toBe(true);
      await expect(overlay.locator('.screen-frame')).toBeVisible();
      await overlay.mouse.move(80, 80); await overlay.mouse.down(); await overlay.mouse.move(240, 200); await overlay.mouse.up();
      await expect(bar.locator('.quick-target-item')).toHaveCount(1);
      await expect.poll(() => peer.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFocused())).toBe(true);
      expect(await mainNative.evaluate(window => window.isVisible())).toBe(false);
      if (keyboard) {
        expect((await main.evaluate(() => window.snipvia.quickTarget.focus())).ok).toBe(true);
        const barNative = await app.browserWindow(bar);
        await expect.poll(() => barNative.evaluate(window => window.isFocused())).toBe(true);
        expect(await mainNative.evaluate(window => window.isVisible())).toBe(false);
        await bar.keyboard.press('Escape');
      } else await bar.getByRole('button', { name: '关闭快速切换', exact: true }).click();
      await expect(bar.locator('.quick-target-item')).toHaveCount(0);
      await expect.poll(() => peer.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFocused())).toBe(true);
      expect(await mainNative.evaluate(window => window.isVisible())).toBe(false);
    }
  } finally { await app.close(); await peer.close(); await rm(directory, { recursive: true, force: true }); }
});
