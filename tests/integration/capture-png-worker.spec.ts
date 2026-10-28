import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test('PNG Worker preserves real NativeImage pixels while Main remains responsive without any window', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'snipvia-png-hidden-')), bootstrap = join(directory, 'main.cjs');
  await writeFile(bootstrap, "const{app}=require('electron');globalThis.testWorkerThreads=require('node:worker_threads');if(process.platform==='darwin')app.setActivationPolicy('prohibited');app.whenReady();");
  const app = await electron.launch({ args: [bootstrap, '--user-data-dir=' + join(directory, 'data')] });
  try {
    await app.evaluate(({ app }) => app.whenReady());
    const result = await app.evaluate(async ({ nativeImage, BrowserWindow }, workerPath) => {
      const { Worker } = (globalThis as typeof globalThis & { testWorkerThreads: typeof import('node:worker_threads') }).testWorkerThreads;
      const worker = new Worker(workerPath), width = 2400, height = 1500;
      const bitmap = Buffer.alloc(width * height * 4); let seed = 12345;
      for (let i = 0; i < bitmap.length; i += 4) { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; bitmap[i] = seed >>> 24; bitmap[i + 1] = (seed >>> 16) & 255; bitmap[i + 2] = (seed >>> 8) & 255; bitmap[i + 3] = 255; }
      const source = nativeImage.createFromBitmap(bitmap, { width, height, scaleFactor: 1 });
      const ticks: number[] = []; let last = performance.now();
      const timer = setInterval(() => { const now = performance.now(); ticks.push(Math.max(0, now - last - 5)); last = now; }, 5);
      try {
        const started = performance.now();
        const bytes = Uint8Array.from(source.toBitmap());
        const png = await new Promise<Uint8Array>((resolve, reject) => {
          worker.once('error', reject);
          worker.once('message', (message: { bytes?: Uint8Array; error?: string }) => message.bytes ? resolve(message.bytes) : reject(Error(message.error)));
          worker.postMessage({ id: 1, bytes, width, height, rect: { x: 0, y: 0, width, height } }, [bytes.buffer]);
        });
        const elapsed = performance.now() - started;
        clearInterval(timer);
        const decoded = nativeImage.createFromBuffer(Buffer.from(png)), roundTrip = decoded.toBitmap();
        return { width: decoded.getSize().width, height: decoded.getSize().height, pixelsEqual: roundTrip.equals(bitmap), pngBytes: png.length, elapsedMs: elapsed, mainTimerSamples: ticks.length, maximumMainTimerDelayMs: Math.max(0, ...ticks), windows: BrowserWindow.getAllWindows().length };
      } finally { clearInterval(timer); await worker.terminate(); }
    }, resolve('out/main/capture-png-worker.js'));
    expect(result.pixelsEqual).toBe(true);
    expect(result.width).toBe(2400); expect(result.height).toBe(1500);
    expect(result.windows).toBe(0); expect(result.mainTimerSamples).toBeGreaterThan(3);
    await mkdir('test-results', { recursive: true });
    await writeFile('test-results/capture-worker-metrics.json', JSON.stringify(result, null, 2));
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});
