import { _electron as electron, expect, test } from '@playwright/test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expectNeutralChrome } from '../helpers/neutral-chrome';

test('后台检查与关于页共享状态，手动刷新、失败恢复、亮暗主题和 IPC 隔离', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'snipvia-updates-'));
  const root = resolve('.'), mainPath = join(root, 'out/main/index.js'), bootstrap = join(directory, 'bootstrap.cjs');
  await writeFile(bootstrap, `
    const { app, shell } = require('electron');
    app.setAppPath(${JSON.stringify(root)});
    globalThis.updateProbe = { calls: 0, status: 200, tag: 'v9.0.0', opened: [], blocked: false,
      body: ${JSON.stringify('## 改进\n\n- 启动后在后台检查新版本。\n- 在设置页直接查看版本与更新说明。\n\n## 修复\n\n- 优化截图窗口布局。\n- 改善笔记保存状态提示。')} };
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      if (String(url) !== 'https://api.github.com/repos/yuyeyuyy/Snipvia/releases/latest') return realFetch(url, init);
      const probe = globalThis.updateProbe; probe.calls++;
      if (probe.blocked) await new Promise(resolve => { probe.release = resolve; });
      if (probe.status !== 200) return new Response('PRIVATE_UPSTREAM_BODY', { status: probe.status });
      return Response.json({ tag_name: probe.tag, body: probe.body, draft: false, prerelease: false, published_at: '2026-10-12T00:00:00Z' });
    };
    shell.openExternal = async url => { globalThis.updateProbe.opened.push(url); };
    const Module = require('node:module'), load = Module._extensions['.js'];
    Module._extensions['.js'] = (module, path) => {
      if (path !== ${JSON.stringify(mainPath)}) return load(module, path);
      module._compile(require('node:fs').readFileSync(path, 'utf8') +
        ${JSON.stringify(`
globalThis.scheduleUpdateFixture = () => updates.scheduleStartup(true, 20);
globalThis.enableUpdateDownloadFixture = () => {
  const beforeInstall = updates.options.installer.hooks.beforeInstall;
  const captureWindows = () => require('electron').BrowserWindow.getAllWindows().filter(window => /#(?:pin|capture)$/.test(window.webContents.getURL())).length;
  globalThis.updateDownloadProbe = { installs: 0, complete: null, captureWindowsBefore: captureWindows(), captureWindowsAfter: null };
  updates.options.installer = {
    supported: true, unavailableReason: null,
    download: async (version, tag, progress) => {
      globalThis.updateDownloadProbe.version = version;
      globalThis.updateDownloadProbe.tag = tag;
      progress(42);
      await new Promise(resolve => { globalThis.updateDownloadProbe.complete = resolve; });
    },
    install: () => {
      beforeInstall();
      globalThis.updateDownloadProbe.captureWindowsAfter = captureWindows();
      globalThis.updateDownloadProbe.installs++;
    },
    dispose: () => {}
  };
  updates.publish({ ...updates.current(), downloadSupported: true, downloadUnavailableReason: null });
};`)}, path);
    };
    require(${JSON.stringify(mainPath)});
  `);
  const instance = await electron.launch({ timeout: 10_000, args: [bootstrap, `--user-data-dir=${join(directory, 'data')}`], env: {
    ...process.env, SNIPVIA_CONSOLE_ORIGIN: 'http://127.0.0.1:9', SNIPVIA_CAPTURE_BACKEND: 'electron', SNIPVIA_CAPTURE_WARMUP: '0'
  } });
  type Probe = { calls: number; status: number; tag: string; body: string | null; blocked: boolean; release?: () => void; opened: string[] };
  try {
    const page = await instance.firstWindow();
    await page.getByRole('button', { name: '模型与设置', exact: true }).click();
    const row = page.locator('.update-settings-row');
    await expect(row).toContainText('启动后在后台检查正式版本');
    // The normal unpackaged client does not contact GitHub. Simulate its packaged
    // startup scheduling in this isolated instance; all release responses are synthetic.
    expect(await instance.evaluate(() => (globalThis as typeof globalThis & { updateProbe: Probe }).updateProbe.calls)).toBe(0);
    await instance.evaluate(() => (globalThis as typeof globalThis & { scheduleUpdateFixture: () => void }).scheduleUpdateFixture());
    await expect(row.getByRole('status')).toContainText('发现新版本 v9.0.0');
    const notes = row.getByRole('region', { name: 'v9.0.0 更新说明' });
    await expect(notes.getByRole('heading', { name: '改进', exact: true })).toBeVisible();
    await expect(notes.getByRole('listitem')).toHaveCount(4);
    await expect(notes).toContainText('优化截图窗口布局');
    expect(await instance.evaluate(() => (globalThis as typeof globalThis & { updateProbe: Probe }).updateProbe.calls)).toBe(1);
    await row.getByRole('button', { name: '查看新版本' }).click();
    expect(await instance.evaluate(() => (globalThis as typeof globalThis & { updateProbe: Probe }).updateProbe.opened))
      .toEqual(['https://github.com/yuyeyuyy/Snipvia/releases/tag/v9.0.0']);

    await mkdir('docs/ui', { recursive: true });
    const about = page.locator('section[aria-labelledby="about-settings-title"]');
    for (const theme of ['light', 'dark'] as const) {
      expect((await page.evaluate(theme => window.snipvia.appearance.set(theme), theme)).ok).toBe(true);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await about.scrollIntoViewIfNeeded();
      await expectNeutralChrome(page);
      await about.screenshot({ path: `docs/ui/update-check-${theme}.png`, animations: 'disabled' });
    }

    await expect.poll(() => instance.windows().some(window => window.url().endsWith('#pin'))).toBe(true);
    const pin = instance.windows().find(window => window.url().endsWith('#pin'))!;
    expect((await pin.evaluate(() => window.snipvia.updates.check())).ok).toBe(false);
    expect((await pin.evaluate(() => window.snipvia.updates.openRelease())).ok).toBe(false);
    expect((await pin.evaluate(() => window.snipvia.updates.download())).ok).toBe(false);
    expect((await pin.evaluate(() => window.snipvia.updates.restartAndInstall())).ok).toBe(false);
    expect(await instance.evaluate(() => (globalThis as typeof globalThis & { updateProbe: Probe }).updateProbe.calls)).toBe(1);

    await instance.evaluate(() => {
      (globalThis as typeof globalThis & { updateProbe: Probe }).updateProbe.body =
        '# 长更新说明\n\n' + '- 一个明确的改进。\n'.repeat(60) +
        '\n<script>window.releaseScriptExecuted = true</script>\n\n![外部图片](https://example.invalid/tracker.png)\n\n[不安全链接](javascript:alert(1))';
    });
    await row.getByRole('button', { name: '检查更新' }).click();
    await expect(notes).toContainText('长更新说明');
    await expect(notes.locator('script, img')).toHaveCount(0);
    await expect(notes.locator('.blocked-link')).toContainText('不安全链接');
    expect(await notes.locator('.update-release-notes-body').evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);

    await instance.evaluate(() => { (globalThis as typeof globalThis & { updateProbe: Probe }).updateProbe.body = null; });
    await row.getByRole('button', { name: '检查更新' }).click();
    await expect(notes).toContainText('此版本未提供更新说明');

    await instance.evaluate(() => { const probe = (globalThis as typeof globalThis & { updateProbe: Probe }).updateProbe; probe.status = 500; probe.blocked = true; });
    await row.getByRole('button', { name: '检查更新' }).click();
    await expect(row.getByRole('button', { name: '检查更新' })).toBeDisabled();
    await expect(row.getByRole('status')).toContainText('正在检查');
    const checking = await page.evaluate(() => window.snipvia.updates.current());
    expect(checking.ok && checking.value.status).toBe('checking');
    await instance.evaluate(() => { const probe = (globalThis as typeof globalThis & { updateProbe: Probe }).updateProbe; probe.blocked = false; probe.release!(); });
    await expect(row.getByRole('alert')).toContainText('暂时不可用');
    await expect(notes).toHaveCount(0);
    await expect(row.getByRole('button', { name: '查看新版本' })).toHaveCount(0);
    await expect(row.getByRole('button', { name: '检查更新' })).toBeEnabled();

    await instance.evaluate(() => { const probe = (globalThis as typeof globalThis & { updateProbe: Probe }).updateProbe; probe.status = 200; probe.tag = 'v0.2.1'; });
    await row.getByRole('button', { name: '检查更新' }).click();
    await expect(row.getByRole('status')).toContainText('无需更新');
    await expect(notes).toHaveCount(0);
    await page.getByRole('button', { name: 'AI 笔记', exact: true }).click();
    await page.getByRole('button', { name: '模型与设置', exact: true }).click();
    await expect(row.getByRole('status')).toContainText('无需更新');
    expect(await instance.evaluate(() => (globalThis as typeof globalThis & { updateProbe: Probe }).updateProbe.calls)).toBe(5);

    // Only this isolated test adapter is enabled. The native installer and real
    // download/signature checks are never invoked by the UI regression.
    await instance.evaluate(() => {
      const probe = (globalThis as typeof globalThis & { updateProbe: Probe }).updateProbe;
      probe.tag = 'v9.0.0'; probe.body = '## 改进\n\n- 下载更新并显示进度。\n- 保存笔记后重启更新。';
      (globalThis as typeof globalThis & { enableUpdateDownloadFixture: () => void }).enableUpdateDownloadFixture();
    });
    await row.getByRole('button', { name: '检查更新' }).click();
    await expect(row.getByRole('button', { name: '下载更新' })).toBeEnabled();
    await row.getByRole('button', { name: '下载更新' }).click();
    await expect(row.getByRole('status')).toContainText('42%');
    await expect(row.getByRole('progressbar')).toHaveAttribute('value', '42');
    await expect(row.getByRole('button', { name: '重启并更新' })).toHaveCount(0);
    await row.screenshot({ path: 'docs/ui/update-downloading.png', animations: 'disabled' });
    await instance.evaluate(() => (globalThis as typeof globalThis & { updateDownloadProbe: { complete: () => void } }).updateDownloadProbe.complete());
    await expect(row.getByRole('button', { name: '重启并更新' })).toBeEnabled();
    expect(await instance.evaluate(() => (globalThis as typeof globalThis & { updateDownloadProbe: { installs: number } }).updateDownloadProbe.installs)).toBe(0);
    for (const theme of ['light', 'dark'] as const) {
      expect((await page.evaluate(theme => window.snipvia.appearance.set(theme), theme)).ok).toBe(true);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expectNeutralChrome(page);
      await about.screenshot({ path: `docs/ui/update-downloaded-${theme}.png`, animations: 'disabled' });
    }

    // A real local editor in a temporary notebook is saved before restart.
    await page.getByRole('button', { name: 'AI 笔记', exact: true }).click();
    const bookRoot = join(directory, 'books'); await mkdir(bookRoot);
    await instance.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, bookRoot);
    await page.getByRole('button', { name: '创建笔记', exact: true }).click();
    await page.getByLabel('笔记本名称', { exact: true }).fill('更新前保存');
    await page.getByRole('button', { name: '创建', exact: true }).click();
    await page.getByRole('button', { name: '新建笔记', exact: true }).click();
    await page.getByLabel('名称', { exact: true }).fill('未丢失内容');
    await page.getByRole('button', { name: '创建', exact: true }).click();
    const text = '# 更新前保存\n\n这是用户的笔记内容。';
    await page.getByRole('textbox', { name: '笔记编辑器', exact: true }).fill(text);
    await page.getByRole('button', { name: '模型与设置', exact: true }).click();
    await row.getByRole('button', { name: '重启并更新' }).click();
    await expect.poll(() => instance.evaluate(() => (globalThis as typeof globalThis & { updateDownloadProbe: { installs: number } }).updateDownloadProbe.installs)).toBe(1);
    expect(await instance.evaluate(() => (globalThis as typeof globalThis & { updateDownloadProbe: { captureWindowsBefore: number; captureWindowsAfter: number } }).updateDownloadProbe))
      .toMatchObject({ captureWindowsBefore: 2, captureWindowsAfter: 0 });
    expect(await readFile(join(bookRoot, '更新前保存', '未丢失内容.md'), 'utf8')).toBe(text);
    await expect(row.getByRole('status')).toContainText('准备重启');
  } finally { await instance.close(); await rm(directory, { recursive: true, force: true }); }
});
