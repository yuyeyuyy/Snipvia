import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
test.use({ trace: 'off', screenshot: 'off', video: 'off' });

test('settings categories preserve drafts, save safely and remain usable at minimum size in both themes', async () => {
  test.setTimeout(60_000);
  const root = resolve('.'), directory = await mkdtemp(join(tmpdir(), 'snipvia-settings-menu-'));
  const mainPath = join(root, 'out/main/index.js');
  const source = (await readFile(mainPath, 'utf8')).replace('show: !launchedAtLogin()', 'show: false').replace('const webPreferences = {', 'const webPreferences = { offscreen: true,');
  const bootstrap = join(directory, 'bootstrap.cjs');
  await writeFile(bootstrap, [
    "const{app,BrowserWindow,globalShortcut,systemPreferences}=require('electron');",
    "if(process.platform==='darwin'){app.setActivationPolicy('prohibited');app.setActivationPolicy=()=>{};if(app.dock){app.dock.show=async()=>{};app.dock.setIcon=()=>{};}}",
    "BrowserWindow.prototype.show=()=>{};BrowserWindow.prototype.showInactive=()=>{};BrowserWindow.prototype.focus=()=>{};",
    "globalShortcut.register=key=>!key.includes('F12');globalShortcut.unregister=()=>{};globalShortcut.unregisterAll=()=>{};systemPreferences.getMediaAccessStatus=()=> 'granted';",
    'app.setAppPath(' + JSON.stringify(root) + ');',
    'require("node:module")._extensions[".js"]=((original)=>(module,path)=>path===' + JSON.stringify(mainPath) + '?module._compile(' + JSON.stringify(source + '\nglobalThis.disableSettingsIconNetwork=()=>{websiteIcons.configure=()=>{};};') + ',path):original(module,path))(require("node:module")._extensions[".js"]);',
    'require(' + JSON.stringify(mainPath) + ');'
  ].join('\n'));
  const app = await electron.launch({ args: [bootstrap, '--user-data-dir=' + join(directory, 'data')], env: { ...process.env, ELECTRON_RENDERER_URL: '', SNIPVIA_CAPTURE_BACKEND: 'electron', SNIPVIA_CAPTURE_WARMUP: '0' } });
  try {
    const page = await app.firstWindow();
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await expect(page.locator('.v2-preferences')).toBeAttached();
    await app.evaluate(() => (globalThis as typeof globalThis & { disableSettingsIconNetwork(): void }).disableSettingsIconNetwork());
    const navigation = page.getByRole('navigation', { name: '设置分类' });
    const labels = ['通用', '快捷键', '截图', '快速切换', '收纳区', '存储', '关于'];
    const select = async (label: string) => {
      await navigation.getByRole('button', { name: label, exact: true }).click();
      await expect(page.locator('#settings-page-heading')).toHaveText(label);
      await expect(navigation.locator('[aria-current="page"]')).toHaveText(label);
      await expect(page.locator('.settings-page:not([hidden])')).toHaveCount(1);
    };
    await expect(navigation.getByRole('button')).toHaveCount(7);
    await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '快速截图', exact: true })).toHaveCount(0);
    await navigation.getByRole('button', { name: '通用', exact: true }).focus();
    await page.keyboard.press('ArrowDown');
    await expect(navigation.getByRole('button', { name: '快捷键', exact: true })).toBeFocused();
    await expect(page.locator('#settings-page-heading')).toHaveText('快捷键');
    await page.keyboard.press('End'); await expect(page.locator('#settings-page-heading')).toHaveText('关于');
    await page.keyboard.press('Home'); await expect(page.locator('#settings-page-heading')).toHaveText('通用');
    await select('快速切换');
    await page.getByRole('button', { name: '添加网页', exact: true }).click();
    await page.getByRole('textbox', { name: '网页目标名称' }).fill('未保存的目标');
    await page.getByRole('textbox', { name: '网页目标网址' }).fill('https://example.invalid/draft');
    await select('通用'); await select('收纳区'); await select('快速切换');
    await expect(page.getByRole('textbox', { name: '网页目标名称' })).toHaveValue('未保存的目标');
    await expect(page.getByRole('textbox', { name: '网页目标网址' })).toHaveValue('https://example.invalid/draft');
    await page.getByRole('textbox', { name: '网页目标名称' }).fill('ChatGPT');
    await page.getByRole('textbox', { name: '网页目标网址' }).fill('https://chatgpt.com/');
    await page.getByRole('button', { name: '添加', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '网页目标名称' })).toHaveCount(0);
    if (process.platform === 'darwin') await page.getByRole('combobox', { name: 'ChatGPT 切换方式' }).selectOption('existing-tab');
    await select('收纳区');
    const width = page.getByRole('spinbutton', { name: '收纳区宽度', exact: true });
    await width.fill('500'); await width.blur();
    await expect.poll(async () => JSON.parse(await readFile(join(directory, 'data/shelf-preferences.json'), 'utf8')).width).toBe(500);
    await width.fill('200'); await width.blur();
    await expect(width).toHaveValue('500'); await expect(page.getByRole('status')).toContainText('280–960');
    expect(JSON.parse(await readFile(join(directory, 'data/shelf-preferences.json'), 'utf8')).width).toBe(500);
    await select('快捷键');
    const shortcut = page.getByRole('button', { name: '设置截图快捷键', exact: true });
    await shortcut.click(); await shortcut.press('ControlOrMeta+Alt+F10');
    await expect(page.locator('.settings-content > .preference-status')).toHaveText('快捷键已生效');
    const before = await page.evaluate(() => window.snipvia.settings.get()); if (!before.ok) throw Error(before.error);
    expect(before.value.shortcut).toBe('CommandOrControl+Alt+F10');
    await shortcut.click(); await shortcut.press('ControlOrMeta+Alt+F12');
    await expect(page.locator('.settings-content > .preference-status')).toContainText('注册失败');
    const after = await page.evaluate(() => window.snipvia.settings.get()); if (!after.ok) throw Error(after.error);
    expect(after.value).toEqual(before.value);
    await shortcut.click(); await shortcut.press('Escape'); await expect(shortcut).toHaveAttribute('aria-pressed', 'false');
    await select('通用');
    await expect(page.locator('.settings-content > .preference-status')).toHaveCount(0);
    await select('快捷键');
    await expect(page.locator('.settings-content > .preference-status')).toContainText('注册失败');
    await select('通用');
    const feedback = page.getByRole('button', { name: '反馈', exact: true });
    await feedback.click(); await expect(page.getByRole('dialog', { name: '意见反馈' })).toBeVisible();
    await page.keyboard.press('Escape'); await expect(feedback).toBeFocused();
    await mkdir('test-results/settings-menu', { recursive: true });
    for (const theme of ['light', 'dark'] as const) {
      await select('通用'); await page.getByLabel('外观主题').selectOption(theme);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      for (const size of [[700, 560], [920, 760], [1440, 900]]) {
        await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows().find(w => !new URL(w.webContents.getURL()).hash)!.setSize(size[0], size[1]), size);
        await expect.poll(() => page.evaluate(() => innerWidth)).toBe(size[0]);
        for (const label of labels) {
          await select(label);
          expect(await page.evaluate(() => {
            const content = document.querySelector<HTMLElement>('.settings-page:not([hidden])')!;
            const r = content.getBoundingClientRect();
            const controls = [...content.querySelectorAll<HTMLElement>('button, input, select')].filter(node => node.getClientRects().length);
            return document.documentElement.scrollWidth <= innerWidth && content.scrollWidth <= content.clientWidth && controls.every(node => { const b = node.getBoundingClientRect(); return b.left >= r.left - 1 && b.right <= r.right + 1; });
          }), theme + ' ' + label + ' ' + size.join('x')).toBe(true);
        }
        if (size[0] === 920) {
          for (const label of ['通用', '快速切换', '收纳区'] as const) {
            await select(label);
            await page.screenshot({ path: 'test-results/settings-menu/' + theme + '-' + ({ 通用: 'general', 快速切换: 'targets', 收纳区: 'shelf' }[label]) + '.png', animations: 'disabled' });
          }
        }
      }
    }
    expect(errors).toEqual([]);
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every(w => !w.isVisible()))).toBe(true);
  } finally {
    await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) if (w.webContents.isOffscreen()) w.webContents.stopPainting(); }).catch(() => {});
    await app.close(); await rm(directory, { recursive: true, force: true });
  }
});
