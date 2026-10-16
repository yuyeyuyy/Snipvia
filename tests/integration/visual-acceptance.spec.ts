import { expect, test } from '@playwright/test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchDesktop } from '../helpers/desktop';
import { expectNeutralChrome } from '../helpers/neutral-chrome';
import { tokenColor } from '../helpers/appearance';

test('editor search, selection matches and model loading/error surfaces remain Monochrome', async () => {
  test.setTimeout(90_000);
  const directory = await mkdtemp(join(tmpdir(), 'snipvia-visual-acceptance-'));
  const book = join(directory, '视觉验收'), output = 'docs/ui/ui2-stage6';
  await mkdir(book); await mkdir(output, { recursive: true });
  const content = 'needle\n\n# 视觉验收\n\nneedle — 重复词高亮\n\nneedle — 搜索结果\n\n```python\n# 注释\nvalue = 42\n```\n';
  await writeFile(join(book, '检查.md'), content);
  const app = await launchDesktop({ args: ['.', `--user-data-dir=${join(directory, 'app')}`], env: { ...process.env, SNIPVIA_CAPTURE_BACKEND: 'electron', SNIPVIA_CAPTURE_WARMUP: '0' } });
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, book);
    await page.getByRole('button', { name: '打开已有笔记本', exact: true }).click();
    await page.getByRole('treeitem', { name: '检查.md', exact: true }).locator('.note-tree-item').click();
    await page.getByLabel('笔记编辑模式').selectOption('source');
    const editor = page.getByRole('textbox', { name: '笔记编辑器', exact: true });
    for (const theme of ['light', 'dark'] as const) {
      await page.evaluate(theme => window.snipvia.appearance.set(theme), theme);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await editor.press('ControlOrMeta+Home');
      for (let i = 0; i < 6; i++) await editor.press('Shift+ArrowRight');
      await expect(page.locator('.cm-selectionMatch').first()).toBeVisible();
      await expectNeutralChrome(page);
      await editor.press('ControlOrMeta+f');
      const search = page.locator('.cm-search input[name="search"]');
      await search.fill('needle'); await search.press('Enter');
      await expect(page.locator('.cm-searchMatch-selected')).toBeVisible();
      await expectNeutralChrome(page);
      expect(await page.locator('.cm-button').first().evaluate(element => getComputedStyle(element).backgroundImage)).toBe('none');
      await page.locator('.cm-button[name="next"]').hover(); await expectNeutralChrome(page);
      await search.focus(); await expect(search).toHaveCSS('outline-color', await tokenColor(search, 'focus'));
      for (const width of [1120, 840]) {
        await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows().find(w => !new URL(w.webContents.getURL()).hash)!.setSize(width, 780), width);
        await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width);
        const size = await page.locator('.cm-search').evaluate(element => ({ height: element.getBoundingClientRect().height, overflow: element.scrollWidth > element.clientWidth }));
        expect(size.height).toBeLessThan(190); expect(size.overflow).toBe(false);
        await page.screenshot({ path: `${output}/editor-search-${theme}-${width}.png`, animations: 'disabled' });
      }
      await search.press('Escape');
      await expect(editor).toBeFocused();
    }
    expect(await readFile(join(book, '检查.md'), 'utf8')).toBe(content);
    await page.getByRole('button', { name: '模型与设置', exact: true }).click();
    await app.evaluate(() => {
      globalThis.fetch = async () => { await new Promise(resolve => setTimeout(resolve, 1500)); return Response.json({ error: { message: 'Synthetic unauthorized' } }, { status: 401 }); };
    });
    for (const theme of ['light', 'dark'] as const) {
      await page.evaluate(theme => window.snipvia.appearance.set(theme), theme);
      await page.getByRole('button', { name: '配置…', exact: true }).click();
      await page.getByLabel('API Key', { exact: true }).fill('synthetic-key');
      await page.getByRole('button', { name: '刷新模型列表', exact: true }).click();
      await expect(page.locator('.model-select-status')).toHaveText('正在获取模型列表…');
      await expectNeutralChrome(page);
      await page.screenshot({ path: `${output}/model-loading-${theme}.png`, animations: 'disabled' });
      await expect(page.getByRole('button', { name: '刷新模型列表', exact: true })).toBeEnabled();
      await expect(page.locator('.model-select-status')).not.toBeEmpty();
      await expectNeutralChrome(page);
      await page.screenshot({ path: `${output}/model-error-${theme}.png`, animations: 'disabled' });
      await page.keyboard.press('Escape');
    }
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});
