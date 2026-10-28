import { expect, test } from '@playwright/test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { launchDesktop } from '../helpers/desktop';
test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test('light real ScreenCaptureKit Quick and Collect regression without persisting screen pixels', async () => {
  test.skip(process.env.SNIPVIA_REAL_SCREEN !== '1' || process.platform !== 'darwin', 'Explicit real-screen opt-in; no endurance run');
  test.setTimeout(60_000);
  const dir = await mkdtemp(join(tmpdir(), 'snipvia-v2-sck-light-'));
  const app = await launchDesktop({ args: ['.', '--user-data-dir=' + dir], env: { ...process.env, SNIPVIA_CAPTURE_BACKEND: 'sck', SNIPVIA_CAPTURE_WARMUP: '0' } });
  const records: unknown[] = [];
  try {
    const main = await app.firstWindow(), overlay = app.windows().find(p => p.url().endsWith('#capture'))!;
    const permission = await main.evaluate(() => window.snipvia.permissions.screen()); records.push({ permission });
    if (!permission.ok || permission.value.status !== 'granted') throw new Error('Real ScreenCaptureKit requires existing macOS permission; TCC was not changed');
    await app.evaluate(({ clipboard }) => { clipboard.write = async () => {}; }); // Never copy private screen content to global clipboard.
    const initial = await main.evaluate(() => window.snipvia.performance.captureBackendStatus()); records.push({ initial });
    for (const mode of ['quick', 'collect', 'quick', 'collect'] as const) {
      const started = await main.evaluate(mode => window.snipvia.capture.start(mode), mode);
      if (!started.ok) throw new Error(started.error);
      await expect(overlay.locator('.screen-frame')).toBeVisible();
      const id = await overlay.locator('.capture-overlay').getAttribute('data-performance-session');
      await overlay.mouse.move(60, 80); await overlay.mouse.down(); await overlay.mouse.move(260, 220); await overlay.mouse.up();
      await expect.poll(async () => { const r = await main.evaluate(id => window.snipvia.performance.report(id!), id); return r.ok && r.value?.marks.some(m => m.event === (mode === 'quick' ? 'clipboard_committed' : 'collection_updated')); }).toBe(true);
      const result = await main.evaluate(id => window.snipvia.performance.report(id!), id);
      records.push({ mode, result });
      expect(result.ok && result.value?.metadata.captureBackend).toBe('screen-capture-kit');
    }
    expect((await main.evaluate(() => window.snipvia.capture.start('collect'))).ok).toBe(true);
    await overlay.keyboard.press('Escape');
    const collected = await main.evaluate(() => window.snipvia.collection.current());
    expect(collected.ok && collected.value.collection.count).toBe(2); records.push({ collectionCount: collected.ok ? collected.value.collection.count : null });
    records.push({ final: await main.evaluate(() => window.snipvia.performance.captureBackendStatus()) });
  } catch (error) {
    const backend = await app.firstWindow().then(main => main.evaluate(() => window.snipvia.performance.captureBackendStatus())).catch(() => null);
    records.push({ error: error instanceof Error ? error.message : String(error), backend }); throw error;
  }
  finally {
    await mkdir('test-results', { recursive: true });
    await writeFile('test-results/v2-sck-light.json', JSON.stringify({ at: new Date().toISOString(), records, privatePixelsPersisted: false, clipboardMocked: true }, null, 2));
    await app.close(); await rm(dir, { recursive: true, force: true });
  }
});
