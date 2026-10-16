const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const process = require('node:process');
const console = require('node:console');
const { createHash, randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { _electron, expect } = require('@playwright/test');
const { root, preflight, readBaseConfig, appBuilderRequire, inventory, entitlementFile, ensure } = require('./common.cjs');
const { repository } = require('../../src/shared/release-source.json');

async function testUpdate() {
  ensure(process.argv.length === 3 && process.argv[2] === '--execute',
    '用法：node scripts/macos-release/test-update.cjs --execute（独立签名测试，不公开发布）');
  ensure(process.platform === 'darwin' && process.arch === 'arm64', '此实机测试目前仅适用于 Apple Silicon Mac');
  const identity = preflight();
  process.env.DEVELOPER_DIR = identity.developerDir;
  const id = randomUUID().slice(0, 8);
  const directory = path.join(root, 'dist', 'macos-update-test', `${Date.now()}-${id}`);
  fs.mkdirSync(directory, { recursive: true });
  const profile = path.join(directory, 'profile'); fs.mkdirSync(profile);
  const bundleId = `com.snipvia.update-test.${id}`;
  const packageName = `snipvia-update-test-${id}`;
  const sourceVersion = '0.2.1', targetVersion = '0.2.2';
  const zipName = `Snipvia-${targetVersion}-arm64.zip`;
  const requests = [];
  let metadata, targetZip, instance, page, stage = 'setup', restartedPid;
  const nativeLog = path.join(directory, 'native-events.jsonl');
  const report = { id, bundleId, sourceVersion, targetVersion, architecture: 'arm64', realNativeInstall: false,
    publicRelease: false, notarizedTestCandidates: false, steps: [] };
  const mark = value => { stage = value; console.log(`[Mac Update Test] ${value}`); report.steps.push(value); };
  const server = http.createServer((request, response) => {
    requests.push(request.url);
    if (request.url === '/release') {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ tag_name: `v${targetVersion}`, draft: false, prerelease: false,
        published_at: '2026-10-12T00:00:00Z', body: '## 独立更新测试\n\n- 真实下载、签名检查和原生重启。' })); return;
    }
    if (request.url?.split('?')[0] === '/latest-mac.yml' && metadata) {
      response.setHeader('Content-Type', 'application/yaml'); response.end(JSON.stringify(metadata)); return;
    }
    if (request.url?.split('?')[0] === '/' + zipName && targetZip) {
      response.setHeader('Content-Length', fs.statSync(targetZip).size);
      response.setHeader('Content-Type', 'application/zip'); fs.createReadStream(targetZip).pipe(response); return;
    }
    response.writeHead(404); response.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const feed = `http://127.0.0.1:${address.port}/`;
  const bootstrapDirectory = path.join(directory, 'bootstrap'); fs.mkdirSync(bootstrapDirectory);
  const bootstrap = `
const { app, systemPreferences, globalShortcut } = require('electron');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
app.setPath('userData', ${JSON.stringify(profile)});
process.env.SNIPVIA_CAPTURE_WARMUP = '0';
// No capture requests, live account credentials, model calls or user-owned data.
systemPreferences.getMediaAccessStatus = () => 'denied';
globalShortcut.register = () => true;
globalShortcut.unregisterAll = () => {};
const nativeFetch = globalThis.fetch;
globalThis.fetch = (url, init) => String(url) === ${JSON.stringify(`https://api.github.com/repos/${repository}/releases/latest`)}
  ? nativeFetch(${JSON.stringify(feed + 'release')}, init) : Promise.reject(new Error('Isolated update test: external requests disabled'));
const entry = path.join(app.getAppPath(), 'out/main/index.js'), load = Module._extensions['.js'];
Module._extensions['.js'] = (module, file) => {
  if (file !== entry) return load(module, file);
  let source = fs.readFileSync(file, 'utf8');
  const origin = ${JSON.stringify('https://github.com/${releaseRepository}/releases/download/${encodeURIComponent(tag)}/')};
  if (source.split(origin).length !== 3) throw new Error('Update test feed instrumentation no longer matches build');
  source = source.split(origin).join(${JSON.stringify(feed)});
  module._compile(source, file);
};
app.on('browser-window-created', (_event, window) => {
  window.webContents.once('did-finish-load', () => {
    if (!window.webContents.getURL().includes('#')) fs.writeFileSync(path.join(${JSON.stringify(directory)}, 'launched-' + app.getVersion() + '.json'),
      JSON.stringify({ version: app.getVersion(), pid: process.pid, executable: process.execPath, userData: app.getPath('userData') }));
  });
});
require(entry);
`;
  fs.writeFileSync(path.join(bootstrapDirectory, 'bootstrap.cjs'), bootstrap);
  const { build, Platform, Arch } = require('electron-builder');
  const { signAsync } = appBuilderRequire('@electron/osx-sign');
  const base = readBaseConfig();
  // Code-signing credentials remain in the approved keychain, never in output.
  for (const key of Object.keys(process.env)) if (/^(APPLE_|CSC_)/.test(key) || key === 'DEBUG') delete process.env[key];
  try {
    for (const version of [sourceVersion, targetVersion]) {
      mark(`build-${version}`);
      const output = path.join(directory, version);
      // A directory-only target omits app-update.yml in builder v26. Use the
      // production ZIP target so builder writes its own cache/feed settings.
      await build({ targets: Platform.MAC.createTarget(['zip'], Arch.arm64), publish: 'never', config: {
        ...base, extends: null, appId: bundleId, productName: 'Snipvia',
        directories: { ...base.directories, output }, forceCodeSigning: false,
        files: [...base.files, { from: bootstrapDirectory, to: 'out/update-test', filter: ['bootstrap.cjs'] }],
        extraMetadata: { name: packageName, version, main: 'out/update-test/bootstrap.cjs', snipviaAutoUpdate: true },
        publish: { provider: 'generic', url: feed },
        mac: { ...base.mac, identity: null, notarize: false, target: [{ target: 'zip', arch: ['arm64'] }],
          extendInfo: { ...base.mac.extendInfo, CFBundleDisplayName: '截然更新测试' } }
      } });
      const app = path.join(output, 'mac-arm64', 'Snipvia.app');
      mark(`sign-${version}`);
      const code = inventory(app);
      const signPaths = new Set([...code.binaries, ...code.bundles].map(file => fs.realpathSync(file)));
      await signAsync({ app, identity: identity.hash, identityValidation: false, keychain: identity.keychain,
        platform: 'darwin', type: 'distribution', preAutoEntitlements: false, strictVerify: true,
        // Sign every Mach-O and code bundle. Ordinary resources are sealed by
        // their parent; treating all .pak/.car data as executable code is costly.
        binaries: code.binaries, ignore: file => !signPaths.has(fs.realpathSync(file)),
        optionsForFile: file => ({ entitlements: entitlementFile(app, file), hardenedRuntime: true, timestamp: 'http://timestamp.apple.com/ts01' }) });
      execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict',
        '-R=anchor apple generic and certificate leaf[subject.OU] = "F76JCDMA4Y"', app], { stdio: 'pipe' });
      const config = fs.readFileSync(path.join(app, 'Contents/Resources/app-update.yml'), 'utf8');
      ensure(config.includes(packageName), '测试更新缓存必须使用独立名称');
      if (version === targetVersion) {
        targetZip = path.join(directory, zipName);
        execFileSync('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, targetZip]);
      }
    }
    const content = fs.readFileSync(targetZip);
    metadata = { version: targetVersion, files: [{ url: zipName, sha512: createHash('sha512').update(content).digest('base64'), size: content.length }],
      path: zipName, sha512: createHash('sha512').update(content).digest('base64'), releaseDate: new Date().toISOString() };
    fs.writeFileSync(path.join(directory, 'latest-mac.yml'), JSON.stringify(metadata, null, 2));
    const installed = path.join(directory, sourceVersion, 'mac-arm64', 'Snipvia.app');
    const executable = path.join(installed, 'Contents/MacOS/Snipvia');
    const env = { ...process.env, SNIPVIA_CAPTURE_WARMUP: '0' };
    for (const key of Object.keys(env)) if (/(TOKEN|PASSWORD|SECRET|API_KEY|SMTP|CSC_|APPLE_)/i.test(key)) delete env[key];
    mark('launch-signed-source');
    instance = await _electron.launch({ executablePath: executable, timeout: 30_000, env });
    await instance.evaluate(({ app, autoUpdater }, file) => {
      const fs = process.getBuiltinModule('node:fs');
      const record = (event, detail) => fs.appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), event, detail }) + '\n');
      for (const event of ['checking-for-update', 'update-available', 'update-not-available', 'before-quit-for-update', 'update-downloaded']) {
        autoUpdater.on(event, () => record(event));
      }
      autoUpdater.on('error', error => record('native-error', error.message));
      app.on('before-quit', event => record('app-before-quit', { prevented: event.defaultPrevented }));
      app.on('will-quit', () => record('app-will-quit'));
      process.on('uncaughtExceptionMonitor', error => record('uncaught', error.message));
    }, nativeLog);
    page = await instance.firstWindow();
    await page.getByRole('button', { name: 'AI 笔记', exact: true }).click();
    const books = path.join(directory, 'books'); fs.mkdirSync(books);
    await instance.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, books);
    await page.getByRole('button', { name: '创建笔记', exact: true }).click();
    await page.getByLabel('笔记本名称', { exact: true }).fill('原生更新验收');
    await page.getByRole('button', { name: '创建', exact: true }).click();
    await page.getByRole('button', { name: '新建笔记', exact: true }).click();
    await page.getByLabel('名称', { exact: true }).fill('保留内容');
    await page.getByRole('button', { name: '创建', exact: true }).click();
    const text = '# 原生更新测试\n\n更新前编辑的临时笔记必须保留。';
    await page.getByRole('textbox', { name: '笔记编辑器', exact: true }).fill(text);
    await page.getByRole('button', { name: '模型与设置', exact: true }).click();
    const row = page.locator('.update-settings-row');
    await row.getByRole('button', { name: '检查更新', exact: true }).click();
    await expect(row.getByRole('status')).toContainText('v0.2.2');
    await expect(row.getByRole('button', { name: '下载更新' })).toBeEnabled();
    mark('download-real-signed-zip');
    await row.getByRole('button', { name: '下载更新' }).click();
    await expect(row.getByRole('button', { name: '重启并更新' })).toBeEnabled({ timeout: 120_000 });
    await page.screenshot({ path: path.join(directory, 'downloaded.png') });
    ensure(JSON.parse(fs.readFileSync(path.join(directory, 'launched-' + sourceVersion + '.json'), 'utf8')).version === sourceVersion, '下载后不能提前安装');
    ensure(!fs.existsSync(path.join(directory, 'launched-' + targetVersion + '.json')), '下载后不能提前重启新版');
    report.waitedForExplicitRestart = true;
    mark('explicit-native-restart');
    await row.getByRole('button', { name: '重启并更新' }).click().catch(error => { if (!page.isClosed()) throw error; });
    const marker = path.join(directory, 'launched-' + targetVersion + '.json');
    await expect.poll(() => fs.existsSync(marker), { timeout: 120_000 }).toBe(true);
    const launched = JSON.parse(fs.readFileSync(marker, 'utf8')); restartedPid = launched.pid;
    ensure(launched.version === targetVersion && launched.userData === profile && launched.executable === executable, '新版本未在原独立应用位置启动');
    ensure(fs.readFileSync(path.join(books, '原生更新验收/保留内容.md'), 'utf8') === text, '真实升级后笔记未保留');
    const version = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', path.join(installed, 'Contents/Info.plist')], { encoding: 'utf8' }).trim();
    ensure(version === targetVersion, '安装后的应用版本不正确');
    execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', installed], { stdio: 'pipe' });
    report.realNativeInstall = true; report.installedVersion = version; report.notePreserved = true; report.requests = requests;
    mark('native-update-passed');
  } catch (error) {
    report.failedStage = stage;
    report.failure = error instanceof Error ? error.message.slice(0, 1800) : 'unknown';
    if (page && !page.isClosed()) report.applicationState = await page.evaluate(() => globalThis.snipvia.updates.current()).catch(() => null);
    console.error(`[Mac Update Test] failed at ${stage}`); process.exitCode = 1;
  } finally {
    if (fs.existsSync(nativeLog)) report.nativeEvents = fs.readFileSync(nativeLog, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    const shipItLog = path.join(os.homedir(), 'Library/Caches', `${bundleId}.ShipIt`, 'ShipIt_stderr.log');
    if (fs.existsSync(shipItLog)) fs.copyFileSync(shipItLog, path.join(directory, 'ShipIt_stderr.log'));
    if (instance) await instance.close().catch(() => undefined);
    const marker = path.join(directory, 'launched-' + targetVersion + '.json');
    if (!restartedPid && fs.existsSync(marker)) restartedPid = JSON.parse(fs.readFileSync(marker, 'utf8')).pid;
    if (restartedPid) { try { process.kill(restartedPid, 'SIGTERM'); } catch { /* Test process already exited. */ } }
    // Squirrel creates a per-bundle launch job. Stop this test's job before
    // removing its cache, otherwise a failed test can leave a restart loop.
    try { execFileSync('/bin/launchctl', ['bootout', `gui/${process.getuid()}/${bundleId}.ShipIt`], { stdio: 'pipe' }); } catch { /* Test job already exited. */ }
    await new Promise(resolve => server.close(resolve));
    report.requests = requests;
    fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2));
    console.log(`测试报告：${path.join(directory, 'report.json')}`);
    // Only the names generated for this test may be removed, never product caches.
    for (const name of [`${packageName}-updater`, `${bundleId}.ShipIt`]) {
      await fsp.rm(path.join(os.homedir(), 'Library/Caches', name), { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    }
  }
  return report.realNativeInstall;
}
testUpdate().then(passed => { if (!passed) process.exit(1); }).catch(error => {
  console.error('独立更新测试启动失败；未执行公开发布。');
  console.error(error instanceof Error ? error.message : 'unknown');
  process.exit(1);
});
