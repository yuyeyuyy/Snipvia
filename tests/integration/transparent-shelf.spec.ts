import { expect, test } from '@playwright/test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchDesktop } from '../helpers/desktop';

test('transparent stack keeps alpha during fly, expands in place and preserves native hit-test boundaries', async () => {
  test.setTimeout(90_000);
  const directory = await mkdtemp(join(tmpdir(), 'snipvia-stack-'));
  const app = await launchDesktop({ args: ['.', '--user-data-dir=' + directory], env: { ...process.env, SNIPVIA_CAPTURE_BACKEND: 'electron', SNIPVIA_CAPTURE_WARMUP: '0' } });
  const records: unknown[] = [];
  try {
    const main = await app.firstWindow(), overlay = app.windows().find(p => p.url().endsWith('#capture'))!;
    await main.evaluate(() => window.snipvia.appearance.set('light'));
    const preferences = await main.evaluate(() => window.snipvia.collection.current()); if (!preferences.ok) throw Error(preferences.error);
    expect((await main.evaluate(value => window.snipvia.collection.configure({ ...value, autoHide: false }), preferences.value.preferences)).ok).toBe(true);
    const seed = await main.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 900;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#fafafa'; ctx.fillRect(0, 0, 1200, 900);
      ctx.fillStyle = '#222'; ctx.font = '600 32px system-ui'; ctx.fillText('SNIPVIA / LOCAL WORKSPACE', 30, 65);
      ctx.font = '20px system-ui';
      for (let i = 0; i < 12; i++) { ctx.fillStyle = i % 2 ? '#555' : '#333'; ctx.fillText('0' + (i + 1) + '  Capture. Collect. Keep your flow.', 32, 115 + i * 50); }
      ctx.fillStyle = '#dadada'; ctx.fillRect(620, 95, 430, 500);
      ctx.fillStyle = '#555'; ctx.font = '30px system-ui'; ctx.fillText('A small collection', 650, 200); ctx.fillText('of things that matter.', 650, 250);
      return canvas.toDataURL('image/png');
    });
    await app.evaluate(({ desktopCapturer, nativeImage, screen, systemPreferences, clipboard, app, BrowserWindow }, seed) => {
      systemPreferences.getMediaAccessStatus = () => 'granted';
      const image = nativeImage.createFromDataURL(seed);
      desktopCapturer.getSources = async options => { const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()); return [{ id: 'screen:stack-synthetic', name: 'Synthetic', display_id: String(d.id), appIcon: nativeImage.createEmpty(), thumbnail: image.resize(options.thumbnailSize!) }]; };
      const probe = { iconWrites: 0, copies: 0, idleOverlayHides: 0 };
      const overlay = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('#capture'))!;
      const hide = overlay.hide.bind(overlay);
      overlay.hide = () => { if (!overlay.isVisible()) probe.idleOverlayHides++; hide(); };
      clipboard.write = async () => { probe.copies++; };
      (globalThis as typeof globalThis & { stackProbe: typeof probe }).stackProbe = probe;
      if (app.dock) { const setIcon = app.dock.setIcon.bind(app.dock); app.dock.setIcon = icon => { probe.iconWrites++; setIcon(icon); }; }
    }, seed);
    await main.evaluate(() => window.snipvia.collection.toggle());
    const shelf = app.windows().find(p => p.url().endsWith('#shelf'))!;
    await shelf.locator('.shelf').waitFor();
    await shelf.evaluate(() => window.snipvia.collection.reducedMotion(false));
    await shelf.evaluate(() => window.snipvia.collection.collapse());
    await shelf.evaluate(() => {
      const probe = { frames: 0, opaque: 0, motionFrames: [] as number[] }; let last = 0;
      (window as typeof window & { alphaProbe: typeof probe }).alphaProbe = probe;
      const frame = () => { const now = performance.now(); const moving = document.getAnimations().some(a => a.playState === 'running'); if (moving && last) probe.motionFrames.push(now - last); last = moving ? now : 0; probe.frames++; for (const element of [document.documentElement, document.body, document.getElementById('root')!]) if (getComputedStyle(element).backgroundColor !== 'rgba(0, 0, 0, 0)') probe.opaque++; if (probe.frames < 500) requestAnimationFrame(frame); };
      requestAnimationFrame(frame);
    });
    const samples = [];
    for (const [index, size] of [[220, 250], [330, 150], [240, 190], [160, 280]].entries()) {
      const started = await main.evaluate(() => window.snipvia.capture.start('collect')); expect(started.ok).toBe(true);
      await expect(overlay.locator('.screen-frame')).toBeVisible();
      const id = await overlay.locator('.capture-overlay').getAttribute('data-performance-session');
      await overlay.mouse.move(45, 45); await overlay.mouse.down(); await overlay.mouse.move(45 + size[0], 45 + size[1]); await overlay.mouse.up();
      await expect(shelf.locator('.shelf-fly')).toBeVisible();
      if (index === 0) {
        const png = await shelf.screenshot({ omitBackground: true });
        await mkdir('test-results/transparent-shelf', { recursive: true }); await writeFile('test-results/transparent-shelf/fly.png', png);
        const alpha = await app.evaluate(({ nativeImage }, bytes) => { const image = nativeImage.createFromBuffer(Buffer.from(bytes)); const p = image.toBitmap(), size = image.getSize(); return [p[3], p[(size.width - 1) * 4 + 3], p[(size.width * (size.height - 1)) * 4 + 3]]; }, [...png]);
        expect(alpha).toEqual([0, 0, 0]); records.push({ flyAlpha: alpha });
      }
      await expect(shelf.locator('.shelf.collapsed')).toBeVisible();
      samples.push(await main.evaluate(id => window.snipvia.performance.report(id!), id));
    }
    const alphaProbe = await shelf.evaluate(() => (window as typeof window & { alphaProbe: { frames: number; opaque: number; motionFrames: number[] } }).alphaProbe);
    expect(alphaProbe.frames).toBeGreaterThan(0); expect(alphaProbe.opaque).toBe(0); records.push({ alphaProbe });
    expect(await app.evaluate(() => (globalThis as typeof globalThis & { stackProbe: { iconWrites: number } }).stackProbe.iconWrites)).toBe(0);
    expect(await app.evaluate(() => (globalThis as typeof globalThis & { stackProbe: { idleOverlayHides: number } }).stackProbe.idleOverlayHides)).toBe(0);
    const nativeBounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('#shelf'))!.getBounds());
    await shelf.getByRole('button', { name: '展开图堆', exact: true }).hover(); await expect.poll(() => shelf.locator('.shelf-card, .shelf-center-image').evaluateAll(nodes => nodes.every(node => node.getAnimations().every(a => a.playState !== 'running')))).toBe(true); await shelf.screenshot({ path: 'test-results/transparent-shelf/stack.png', omitBackground: true, clip: { x: Math.max(0, nativeBounds.width - 330), y: 0, width: Math.min(330, nativeBounds.width), height: Math.min(300, nativeBounds.height) } });
    await shelf.getByRole('button', { name: '展开图堆', exact: true }).click();
    await expect(shelf.locator('.shelf.expanded')).toBeVisible();
    const expandedBounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('#shelf'))!.getBounds());
    expect(expandedBounds.width).toBe(nativeBounds.width); expect(expandedBounds.height).toBeGreaterThanOrEqual(nativeBounds.height);
    await expect(shelf.locator('.shelf-preview img')).toHaveCount(4);
    await shelf.getByRole('button', { name: '预览截图 1', exact: true }).hover(); await shelf.locator('.shelf-output-actions').hover(); await expect.poll(() => shelf.locator('.shelf-card, .shelf-center-image').evaluateAll(nodes => nodes.every(node => node.getAnimations().every(a => a.playState !== 'running')))).toBe(true); await shelf.screenshot({ path: 'test-results/transparent-shelf/expanded.png', omitBackground: true });
    const first = shelf.getByRole('button', { name: '预览截图 1', exact: true }); await first.click();
    await expect(shelf.locator('.shelf-preview-scene')).toBeVisible();
    await expect(shelf.getByAltText('原图预览')).toHaveAttribute('src', /^blob:/);
    await expect.poll(() => shelf.locator('.shelf-card, .shelf-center-image').evaluateAll(nodes => nodes.every(node => node.getAnimations().every(a => a.playState !== 'running')))).toBe(true); await shelf.screenshot({ path: 'test-results/transparent-shelf/focused.png', omitBackground: true });
    await shelf.getByRole('button', { name: '复制当前截图', exact: true }).click();
    await expect(shelf.getByRole('button', { name: '复制当前截图', exact: true })).toHaveAttribute('data-action-state', 'success');
    expect(await app.evaluate(() => (globalThis as typeof globalThis & { stackProbe: { copies: number } }).stackProbe.copies)).toBe(1);
    expect((await main.evaluate(() => window.snipvia.collection.copy(crypto.randomUUID()))).ok).toBe(false);
    expect((await shelf.evaluate(() => window.snipvia.collection.copy(crypto.randomUUID()))).ok).toBe(false);
    await shelf.keyboard.press('Escape'); await expect(shelf.locator('.shelf-preview-scene')).toHaveCount(0); await expect(shelf.locator('.shelf.expanded')).toBeVisible();
    expect((await main.evaluate(() => window.snipvia.collection.hitRegions([]))).ok).toBe(false);
    expect((await shelf.evaluate(() => window.snipvia.collection.hitRegions([{ x: 0, y: 0, width: Infinity, height: 10 }]))).ok).toBe(false);
    const state = await shelf.evaluate(() => window.snipvia.collection.current()); if (!state.ok) throw new Error(state.error);
    expect((await shelf.evaluate(p => window.snipvia.collection.feedbackFinished(p), state.value.presentation - 1))).toEqual({ ok: true, value: false });
    // Exercise Main's hit testing with an isolated cursor probe; never move the user's OS cursor.
    await app.evaluate(({ BrowserWindow, screen }) => {
      const w = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('#shelf'))!;
      const original = w.setIgnoreMouseEvents.bind(w); const calls: boolean[] = [];
      (globalThis as typeof globalThis & { hitCalls: boolean[] }).hitCalls = calls;
      w.setIgnoreMouseEvents = (value, options) => { calls.push(value); original(value, options); };
      const b = w.getBounds(); screen.getCursorScreenPoint = () => ({ x: b.x + 110, y: b.y + 110 });
    });
    await shelf.evaluate(() => window.snipvia.collection.hitRegions([{ x: 100, y: 100, width: 50, height: 50 }]));
    await app.evaluate(({ BrowserWindow, screen }) => { const b = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('#shelf'))!.getBounds(); screen.getCursorScreenPoint = () => ({ x: b.x + 1, y: b.y + 1 }); });
    await expect.poll(() => app.evaluate(() => (globalThis as typeof globalThis & { hitCalls: boolean[] }).hitCalls.at(-1))).toBe(true);
    await app.evaluate(({ BrowserWindow, screen }) => { const b = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('#shelf'))!.getBounds(); screen.getCursorScreenPoint = () => ({ x: b.x + 110, y: b.y + 110 }); });
    await expect.poll(() => app.evaluate(() => (globalThis as typeof globalThis & { hitCalls: boolean[] }).hitCalls.at(-1))).toBe(false);
    await app.evaluate(({ app, BrowserWindow }) => {
      const main = BrowserWindow.getAllWindows().find(w => !new URL(w.webContents.getURL()).hash)!; main.hide();
      BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('#shelf'))!.focus(); app.emit('activate');
    });
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => !new URL(w.webContents.getURL()).hash)!.isVisible())).toBe(false);
    await app.evaluate(({ app, screen }) => { screen.getCursorScreenPoint = () => ({ x: -100000, y: -100000 }); app.emit('activate'); });
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => !new URL(w.webContents.getURL()).hash)!.isVisible())).toBe(true);
    const finalProbe = await shelf.evaluate(() => (window as typeof window & { alphaProbe: { frames: number; opaque: number; motionFrames: number[] } }).alphaProbe);
    records.push({ samples, nativeBounds, repeatedDockWrites: 0, finalProbe });
  } finally {
    await mkdir('test-results/transparent-shelf', { recursive: true });
    await writeFile('test-results/transparent-shelf/validation.json', JSON.stringify(records, null, 2));
    await app.close(); await rm(directory, { recursive: true, force: true });
  }
});
