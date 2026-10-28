import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);
async function applicationNumber(...args: string[]) { return (await execute('/usr/bin/lsappinfo', args)).stdout.match(/ASN:0x[0-9a-f]+-0x[0-9a-f]+/i)?.[0] ?? ''; }
import { tmpdir } from 'node:os';
import { launchDesktop } from '../helpers/desktop';
test('capture exit releases keyboard focus to the previous application', async () => {
  test.skip(process.platform !== 'darwin', 'macOS activation regression');
  const directory = await mkdtemp(join(tmpdir(), 'snipvia-focus-peer-'));
  const app = await launchDesktop({ args: ['.', '--user-data-dir=' + join(directory, 'primary')], env: { ...process.env, SNIPVIA_CAPTURE_BACKEND: 'electron', SNIPVIA_CAPTURE_WARMUP: '0' } });
  const bootstrap = join(directory, 'peer.cjs');
  await writeFile(bootstrap, "const{app,BrowserWindow}=require('electron');app.setName('Snipvia test peer');app.whenReady().then(()=>{const w=new BrowserWindow({width:500,height:300,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});w.loadURL('data:text/html,<input autofocus placeholder=Keyboard-focus-test>')});app.on('window-all-closed',()=>app.quit());");
  const peer = await electron.launch({ args: [bootstrap, '--user-data-dir=' + join(directory, 'peer')] });
  try {
    await peer.firstWindow();
    const peerNumber = await applicationNumber('find', 'pid=' + peer.process().pid);
    expect(peerNumber).not.toBe('');
    await app.evaluate(({ systemPreferences, desktopCapturer, nativeImage, screen, clipboard }) => {
      systemPreferences.getMediaAccessStatus = () => 'granted'; clipboard.write = async () => {};
      desktopCapturer.getSources = async options => { const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()), size = options.thumbnailSize!;return [{ id: 'screen:focus-synthetic', display_id: String(d.id), name: 'Synthetic', appIcon: nativeImage.createEmpty(), thumbnail: nativeImage.createFromBitmap(Buffer.alloc(size.width * size.height * 4, 180), size) }]; };
    });
    const main = await app.firstWindow(), overlay = app.windows().find(p => p.url().endsWith('#capture'))!;
    for (const mode of ['collect', 'quick'] as const) {
      await execute('/usr/bin/lsappinfo', ['setfront', 'pid=' + peer.process().pid]);
      await peer.evaluate(({ app, BrowserWindow }) => { app.focus({ steal: true }); BrowserWindow.getAllWindows()[0].focus(); });
      await expect.poll(() => peer.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFocused())).toBe(true);
      await expect.poll(() => applicationNumber('front'), { message: 'Peer must be the macOS foreground application before capture' }).toBe(peerNumber);
      expect((await main.evaluate(mode => window.snipvia.capture.start(mode), mode)).ok).toBe(true);
      await expect(overlay.locator('.screen-frame')).toBeVisible();
      await overlay.mouse.move(70, 70); await overlay.mouse.down(); await overlay.mouse.move(240, 200); await overlay.mouse.up();
      try {
        await expect.poll(() => peer.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFocused()), { message: mode + ' must restore keyboard focus' }).toBe(true);
      } catch (error) {
        const primary = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(w => ({ route: w.webContents.getURL().split('#')[1] || 'main-or-loading', visible: w.isVisible(), focused: w.isFocused() })));
        throw new Error(String(error) + '\nPrimary windows: ' + JSON.stringify(primary) + '\nForeground ASN: ' + await applicationNumber('front') + '; peer ASN: ' + peerNumber);
      }
      await expect.poll(() => applicationNumber('front'), { message: mode + ' must return the macOS foreground application' }).toBe(peerNumber);
      expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('#capture'))!.isFocused())).toBe(false);
    }
  } finally { await app.close(); await peer.close(); await rm(directory, { recursive: true, force: true }); }
});
