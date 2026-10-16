// Real pixels, temporary profile, normal Electron launch (no Playwright switches).
// Invokes the registered shortcut callback; does not measure physical key dispatch.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import console from 'node:console';
import { setTimeout, clearTimeout } from 'node:timers';

async function probe(electron, load, config) {
  const { app, BrowserWindow, globalShortcut, ipcMain, systemPreferences } = electron;
  const pause = ms => new Promise(resolvePause => setTimeout(resolvePause, ms));
  const waitFor = async get => {
    for (let attempt = 0; attempt < 200; attempt++) {
      const value = await get();
      if (value) return value;
      await pause(50);
    }
    throw new Error('Capture probe readiness timed out');
  };
  app.setAppPath(config.root);
  app.setName('Snipvia Isolated Capture Test');
  const callbacks = new Map();
  const register = globalShortcut.register.bind(globalShortcut);
  globalShortcut.register = (key, callback) => {
    callbacks.set(key, callback);
    return register(key, callback);
  };
  load(config.root + '/out/main/index.js');
  await app.whenReady();
  if (systemPreferences.getMediaAccessStatus('screen') !== 'granted') {
    throw new Error('Screen recording permission is required for this opt-in test');
  }
  const main = await waitFor(() => BrowserWindow.getAllWindows().find(window => /index\.html$/.test(window.webContents.getURL()) && !window.webContents.isLoading()));
  const invoke = expression => main.webContents.executeJavaScript(expression);
  await waitFor(async () => {
    const result = await invoke('window.snipvia.performance.startupReport()');
    const ready = result.ok && result.value?.marks.filter(mark => mark.event === 'window_preload_ready');
    return ready && ready.length >= 2;
  });
  await waitFor(async () => {
    const result = await invoke('window.snipvia.performance.captureBackendStatus()');
    return result.ok && result.value.screenCaptureKit?.healthy;
  });
  const settings = await invoke('window.snipvia.settings.get()');
  if (!settings.ok) throw new Error(settings.error);
  const callback = callbacks.get(settings.value.editorShortcut);
  if (!callback) throw new Error('Standard screenshot shortcut was not registered');
  const overlay = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('#capture'));
  if (!overlay) throw new Error('Preloaded overlay is missing');
  const reports = [];
  for (let index = 0; index < config.samples; index++) {
    main.hide();
    // Includes background/idle starts, not only captures immediately after launch.
    await pause(index === 0 ? config.idleMs : 300);
    let sessionId;
    const listener = (_event, value) => { if (value.event === 'capture_overlay_visible') sessionId = value.sessionId; };
    ipcMain.on('performance:mark', listener);
    try {
      callback();
      await waitFor(() => sessionId);
      const result = await invoke(`window.snipvia.performance.report(${JSON.stringify(sessionId)})`);
      if (!result.ok || !result.value) throw new Error('Capture report unavailable');
      reports.push(result.value);
      const cancelled = await overlay.webContents.executeJavaScript('window.snipvia.capture.cancel()');
      if (!cancelled.ok || overlay.isVisible() || main.isVisible()) throw new Error('Cancel did not leave capture and main windows hidden');
    } finally { ipcMain.removeListener('performance:mark', listener); }
  }
  load('node:fs').writeFileSync(config.result, JSON.stringify(reports));
  app.quit();
}

if (process.env.SNIPVIA_REAL_SCREEN !== '1' || process.platform !== 'darwin') {
  throw new Error('Opt in on macOS with SNIPVIA_REAL_SCREEN=1; this captures real screen pixels in memory only.');
}
const require = createRequire(import.meta.url);
const root = resolve('.');
const executable = process.env.SNIPVIA_TEST_ELECTRON_PATH || require('electron');
const samples = Math.max(1, Math.min(10, Number(process.env.SNIPVIA_CAPTURE_LATENCY_SAMPLES) || 3));
const idleMs = Math.max(0, Math.min(60_000, Number(process.env.SNIPVIA_CAPTURE_IDLE_MS) || 1500));
const directory = await mkdtemp(join(tmpdir(), 'snipvia-normal-capture-'));
const result = join(directory, 'timings.json');
const bootstrap = join(directory, 'bootstrap.cjs');
const output = resolve(process.env.SNIPVIA_CAPTURE_LATENCY_OUTPUT || 'performance-results/capture-normal-launch.json');
try {
  await writeFile(bootstrap, `(${probe.toString()})(require('electron'), require, ${JSON.stringify({ root, samples, idleMs, result })}).catch(error => { console.error(error); require('electron').app.exit(1); });`);
  // Discard capture/test overrides from the caller so the baseline uses normal defaults.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('SNIPVIA_') && !key.startsWith('ELECTRON_')));
  Object.assign(env, { ELECTRON_RENDERER_URL: '', SNIPVIA_CONSOLE_ORIGIN: 'http://127.0.0.1:1' });
  const child = spawn(executable, [bootstrap, `--user-data-dir=${directory}`], { env, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-4000); });
  const timer = setTimeout(() => child.kill(), idleMs + 45_000);
  try {
    const code = await new Promise((resolveExit, reject) => { child.once('exit', resolveExit); child.once('error', reject); });
    if (code !== 0) throw new Error(`Normal launch probe failed (${code}): ${stderr}`);
  } finally { clearTimeout(timer); }
  const reports = JSON.parse(await readFile(result, 'utf8'));
  const summary = reports.map(report => ({
    readyMs: report.metrics.captureStartToOverlayVisibleMs,
    responseMs: report.metrics.captureStartToOverlayShellVisibleMs,
    nativeMs: report.metadata.screenCaptureKitCaptureMs,
    backend: report.metadata.captureBackend,
    fallbackUsed: report.metadata.captureFallbackUsed
  }));
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify({ scenario: 'normal Electron launch; registered callback; real pixels; temporary profile; no physical key injection', idleMs, summary, reports }, null, 2));
  console.info(JSON.stringify(summary, null, 2));
  if (reports.some(report => report.metadata.captureBackend !== 'screen-capture-kit' || report.metadata.captureFallbackUsed)) {
    throw new Error('Native capture regressed to fallback; see timing report');
  }
} finally { await rm(directory, { recursive: true, force: true }); }
