import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchDesktop } from '../helpers/desktop';

async function synthetic(app: ElectronApplication) {
  await app.evaluate(({ clipboard, desktopCapturer, nativeImage, screen, systemPreferences }) => {
    systemPreferences.getMediaAccessStatus = () => 'granted';
    const probe = { copies: 0, fail: false };
    (globalThis as typeof globalThis & { continuousProbe: typeof probe }).continuousProbe = probe;
    clipboard.write = async () => { if (probe.fail) throw new Error('synthetic clipboard denied'); probe.copies++; };
    desktopCapturer.getSources = async options => {
      const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()), size = options.thumbnailSize!;
      const frame = nativeImage.createFromBitmap(Buffer.alloc(size.width * size.height * 4, 255), size);
      return [{ id: 'screen:continuous', name: 'Synthetic', display_id: String(display.id), appIcon: nativeImage.createEmpty(), thumbnail: frame }];
    };
  });
}
async function select(page: Page, overlay: Page, mode: 'quick' | 'collect' | 'edit', index = 0) {
  const started = await page.evaluate(mode => window.snipvia.capture.start(mode), mode);
  if (!started.ok) throw new Error(started.error);
  await expect(overlay.locator('.screen-frame')).toBeVisible();
  const id = await overlay.locator('.capture-overlay').getAttribute('data-performance-session');
  await overlay.mouse.move(70, 70); await overlay.mouse.down(); await overlay.mouse.move(210 + index, 160 + index); await overlay.mouse.up();
  return id!;
}
test('Quick copies directly, retries clipboard failures, isolates sessions and never shows Pin', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'snipvia-v2-quick-'));
  const app = await launchDesktop({ args: ['.', '--user-data-dir=' + dir], env: { ...process.env, SNIPVIA_CAPTURE_BACKEND: 'electron', SNIPVIA_CAPTURE_WARMUP: '0' } });
  try {
    await synthetic(app);
    const page = await app.firstWindow(), overlay = app.windows().find(p => p.url().endsWith('#capture'))!;
    const ids = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(w => w.id));
    const samples = [];
    for (let i = 0; i < 3; i++) {
      const id = await select(page, overlay, 'quick', i);
      await expect.poll(async () => { const r = await page.evaluate(id => window.snipvia.performance.report(id), id); return r.ok && r.value?.marks.some(m => m.event === 'clipboard_committed'); }).toBe(true);
      const r = await page.evaluate(id => window.snipvia.performance.report(id), id);
      samples.push(r);
      expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('#pin'))!.isVisible())).toBe(false);
    }
    expect(await page.evaluate(() => window.snipvia.screenshots.list())).toEqual({ ok: true, value: [] });
    const usage = await page.evaluate(() => window.snipvia.performance.captureBackendStatus());
    expect(usage.ok && usage.value.runtimeScreenshots).toEqual({ items: 0, bytes: 0 });
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(w => w.id))).toEqual(ids);
    await app.evaluate(() => { (globalThis as typeof globalThis & { continuousProbe: { fail: boolean } }).continuousProbe.fail = true; });
    await select(page, overlay, 'quick');
    await expect(overlay.locator('.capture-overlay')).toContainText('synthetic clipboard denied');
    await overlay.keyboard.press('Escape');
    await mkdir('test-results', { recursive: true }); await writeFile('test-results/v2-quick.json', JSON.stringify(samples, null, 2));
  } finally { await app.close(); await rm(dir, { recursive: true, force: true }); }
});

test('Collect keeps ten ordered thumbnails, reuses Shelf, and safely previews, sorts, removes and clears', async () => {
  test.setTimeout(90_000);
  const dir = await mkdtemp(join(tmpdir(), 'snipvia-v2-collection-'));
  const app = await launchDesktop({ args: ['.', '--user-data-dir=' + dir], env: { ...process.env, SNIPVIA_CAPTURE_BACKEND: 'electron', SNIPVIA_CAPTURE_WARMUP: '0' } });
  try {
    await synthetic(app);
    const page = await app.firstWindow(), overlay = app.windows().find(p => p.url().endsWith('#capture'))!, pin = app.windows().find(p => p.url().endsWith('#pin'))!;
    expect(app.windows().some(p => p.url().endsWith('#shelf'))).toBe(false);
    const samples = [];
    for (let i = 0; i < 10; i++) {
      const id = await select(page, overlay, 'collect', i);
      await expect.poll(async () => { const r = await page.evaluate(() => window.snipvia.collection.current()); return r.ok && r.value.collection.count; }).toBe(i + 1);
      const report = await page.evaluate(id => window.snipvia.performance.report(id), id); samples.push(report);
    }
    const shelf = app.windows().find(p => p.url().endsWith('#shelf'))!;
    await expect(shelf.getByRole('button', { name: '展开截图收纳区' })).toBeVisible();
    const windows = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(w => w.id));
    await shelf.getByRole('button', { name: '展开截图收纳区' }).click();
    await expect(shelf.getByRole('heading', { name: '截图收纳', exact: true })).toBeVisible();
    await expect(shelf.locator('.shelf-preview img')).toHaveCount(10);
    const before = await page.evaluate(() => window.snipvia.collection.current());
    if (!before.ok) throw new Error(before.error);
    const ids = before.value.collection.items.map(item => item.id);
    expect(new Set(ids).size).toBe(10);
    await shelf.getByRole('button', { name: '下移截图 1', exact: true }).click();
    await expect.poll(async () => { const r = await page.evaluate(() => window.snipvia.collection.current()); return r.ok && r.value.collection.items[0].id; }).toBe(ids[1]);
    const stale = await shelf.evaluate(value => window.snipvia.collection.reorder(value), { ids, revision: before.value.collection.revision });
    expect(stale.ok).toBe(false);
    await shelf.getByRole('button', { name: '收起收纳区' }).click();
    await shelf.getByRole('button', { name: '展开截图收纳区' }).click();
    expect(await shelf.locator('.shelf-grid article').first().getAttribute('data-id')).toBe(ids[1]);
    await shelf.getByRole('button', { name: '预览截图 1', exact: true }).click();
    await expect(pin.getByAltText('置顶截图')).toBeVisible();
    await shelf.getByRole('button', { name: '删除截图 1', exact: true }).click();
    await expect(pin.getByAltText('置顶截图')).toBeVisible();
    expect((await pin.evaluate(() => window.snipvia.pin.copy())).ok).toBe(true);
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false }); });
    await shelf.getByRole('button', { name: '清空…', exact: true }).click();
    let current = await page.evaluate(() => window.snipvia.collection.current()); expect(current.ok && current.value.collection.count).toBe(9);
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); });
    await shelf.getByRole('button', { name: '清空…', exact: true }).click();
    await expect(shelf.locator('.shelf-grid article')).toHaveCount(0);
    current = await page.evaluate(() => window.snipvia.collection.current()); expect(current.ok && current.value.collection.count).toBe(0);
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(w => w.id))).toEqual(windows);
    expect((await overlay.evaluate(() => window.snipvia.collection.current())).ok).toBe(false);
    const usage = await page.evaluate(() => window.snipvia.performance.captureBackendStatus()); expect(usage.ok && usage.value.runtimeScreenshots).toEqual({ items: 0, bytes: 0 });
    await mkdir('test-results', { recursive: true }); await writeFile('test-results/v2-collect.json', JSON.stringify(samples, null, 2));
  } finally { await app.close(); await rm(dir, { recursive: true, force: true }); }
});

test('Shelf animations cancel for new captures, hidden feedback expires, and append never focuses Shelf', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'snipvia-v2-feedback-'));
  const app = await launchDesktop({ args: ['.', '--user-data-dir=' + dir], env: { ...process.env, SNIPVIA_CAPTURE_BACKEND: 'electron', SNIPVIA_CAPTURE_WARMUP: '0' } });
  try {
    await synthetic(app);
    const page = await app.firstWindow(), overlay = app.windows().find(p => p.url().endsWith('#capture'))!;
    await select(page, overlay, 'collect');
    const shelf = await expect.poll(() => app.windows().some(p => p.url().endsWith('#shelf'))).toBe(true).then(() => app.windows().find(p => p.url().endsWith('#shelf'))!);
    await shelf.locator('.shelf-open').waitFor();
    await shelf.evaluate(() => {
      const events: string[] = []; (window as typeof window & { feedbackEvents: string[] }).feedbackEvents = events;
      window.snipvia.collection.onChanged(state => { if (state.feedback) events.push(state.feedback.kind); });
      return window.snipvia.collection.reducedMotion(false);
    });
    await app.evaluate(({ BrowserWindow }) => {
      const shelf = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('#shelf'))!;
      const focus = shelf.focus.bind(shelf);
      (globalThis as typeof globalThis & { shelfFocusCalls: number }).shelfFocusCalls = 0;
      shelf.focus = () => { (globalThis as typeof globalThis & { shelfFocusCalls: number }).shelfFocusCalls++; focus(); };
    });
    await select(page, overlay, 'collect');
    await expect.poll(() => shelf.evaluate(() => (window as typeof window & { feedbackEvents: string[] }).feedbackEvents.includes('fly'))).toBe(true);
    expect((await page.evaluate(() => window.snipvia.capture.start('quick'))).ok).toBe(true);
    const during = await page.evaluate(() => window.snipvia.collection.current());
    expect(during.ok && during.value.feedback).toBeUndefined();
    await overlay.keyboard.press('Escape');
    await expect(shelf.locator('.shelf-open')).toBeVisible();
    expect(await app.evaluate(() => (globalThis as typeof globalThis & { shelfFocusCalls: number }).shelfFocusCalls)).toBe(0);
    await shelf.getByRole('button', { name: '隐藏收纳区' }).click();
    await select(page, overlay, 'collect');
    await expect(shelf.getByRole('status')).toContainText('已收集 3 张');
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('#shelf'))!.isVisible())).toBe(false);
    expect((await page.evaluate(() => window.snipvia.collection.toggle())).ok).toBe(true);
    await expect(shelf.getByRole('heading', { name: '截图收纳' })).toBeVisible();
    await expect(shelf.locator('.shelf-grid article')).toHaveCount(3);
    await shelf.evaluate(() => window.snipvia.collection.reducedMotion(true));
    await select(page, overlay, 'collect');
    await expect(shelf.getByRole('status')).toContainText('已收集 4 张');
    await expect(shelf.locator('.shelf-fly')).toHaveCount(0);
    await expect(shelf.getByRole('heading', { name: '截图收纳' })).toBeVisible();
    await mkdir('docs/ui/v2', { recursive: true });
    for (const mode of ['light', 'dark'] as const) {
      await page.evaluate(mode => window.snipvia.appearance.set(mode), mode);
      await expect(shelf.locator('html')).toHaveAttribute('data-theme', mode);
      await shelf.screenshot({ path: 'docs/ui/v2/shelf-' + mode + '.png' });
    }
  } finally { await app.close(); await rm(dir, { recursive: true, force: true }); }
});
