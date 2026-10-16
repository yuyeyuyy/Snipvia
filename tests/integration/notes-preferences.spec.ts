import { expectNeutralChrome } from '../helpers/neutral-chrome';
import { expect, test } from '@playwright/test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchDesktop } from '../helpers/desktop';
import { tokenColor } from '../helpers/appearance';
import { version } from '../../package.json';

test('immersive notes and grouped preferences preserve files, focus, settings and neutral themes', async () => {
  test.setTimeout(120_000);
  const directory = await mkdtemp(join(tmpdir(), 'snipvia-notes-preferences-'));
  const storage = join(directory, 'app'), book = join(directory, '算法学习'), output = 'docs/ui/ui2-stage4';
  await mkdir(join(book, 'assets'), { recursive: true }); await mkdir(output, { recursive: true });
  const code = 'def binary_search(nums, target):\n    left, right = 0, len(nums) - 1\n    # 每轮缩小搜索区间\n    while left <= right:\n        mid = (left + right) // 2\n        if nums[mid] == target:\n            return mid\n        if nums[mid] < target:\n            left = mid + 1\n        else:\n            right = mid - 1\n    return -1\n';
  const content = '# 二分查找\n\n从循环不变量出发，理解边界与终止条件。\n\n> 学习目标：每次循环都排除不可能包含答案的区间。\n\n## 参考实现\n\n```python\n' + code + '```\n\n## 边界测试\n\n| 输入 | 目标 | 预期 |\n| --- | ---: | --- |\n| 空数组 | 4 | -1 |\n| [1, 3, 5] | 3 | 1 |\n| [1, 3, 5] | 4 | -1 |\n\n## 复习计划\n\n- [ ] 比较左右闭合与左闭右开区间\n- [x] 记录循环终止条件\n\n[[栈与括号匹配]]\n';
  await writeFile(join(book, '二分查找.md'), content);
  await writeFile(join(book, '栈与括号匹配.md'), '# 栈与括号匹配\n\n[[二分查找]]');
  await writeFile(join(book, 'assets/fixture.txt'), '合成附件');
  const app = await launchDesktop({ args: ['.', `--user-data-dir=${storage}`], env: { ...process.env, SNIPVIA_CAPTURE_BACKEND: 'electron', SNIPVIA_CAPTURE_WARMUP: '0' } });
  try {
    const page = await app.firstWindow(); const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, book);
    await page.getByRole('button', { name: '打开已有笔记本', exact: true }).click();
    await page.getByRole('treeitem', { name: '二分查找.md', exact: true }).locator('.note-tree-item').click();
    await expect(page.getByRole('button', { name: '展开标题目录', exact: true })).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('treeitem', { name: 'assets', exact: true })).toHaveCount(0);
    await page.getByLabel('笔记编辑模式').selectOption('source');
    const editor = page.getByRole('textbox', { name: '笔记编辑器', exact: true });
    await editor.evaluate(element => element.setAttribute('data-stage4-editor', 'retained'));
    await editor.fill(content + '\n我的复习记录。');
    await page.keyboard.press('ControlOrMeta+s');
    await expect.poll(() => readFile(join(book, '二分查找.md'), 'utf8')).toBe(content + '\n我的复习记录。');
    await page.getByRole('button', { name: '收起文件列表', exact: true }).click();
    await expect.poll(() => page.locator('.notes-files').evaluate(element => element.getBoundingClientRect().width)).toBeLessThan(2);
    await page.getByRole('button', { name: '展开标题目录', exact: true }).click();
    await expect(page.getByRole('complementary', { name: '笔记大纲' })).toBeVisible();
    await page.getByRole('button', { name: '关闭大纲面板', exact: true }).click();
    await page.getByRole('button', { name: '模型与设置', exact: true }).click();
    const categories = page.getByRole('navigation', { name: '设置分类' });
    await expect(categories.getByRole('button')).toHaveText(['通用', '外观', '模型配置', '快捷键', '隐私与数据', '关于']);
    await categories.getByRole('button', { name: '关于', exact: true }).click();
    await expect(page.locator('#about-settings-title')).toBeFocused();
    await expect(page.getByText(`v${version}`, { exact: true })).toBeVisible();
    await categories.getByRole('button', { name: '隐私与数据', exact: true }).click();
    await page.getByRole('button', { name: '隐私说明…', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '截图隐私说明', exact: true })).toContainText('所选图片');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: '隐私说明…', exact: true })).toBeFocused();
    await categories.getByRole('button', { name: '外观', exact: true }).click();
    await page.getByLabel('外观主题').selectOption('dark');
    await page.getByRole('button', { name: 'AI 笔记', exact: true }).click();
    await expect(editor).toHaveAttribute('data-stage4-editor', 'retained');
    await expect(editor).toContainText('我的复习记录。');
    await page.getByRole('button', { name: '展开文件列表', exact: true }).click();
    await page.getByLabel('笔记编辑模式').selectOption('read');
    await expect(page.locator('.note-code-block .tok-comment')).toContainText('缩小搜索区间');
    await expect(page.locator('.note-preview table tbody tr')).toHaveCount(3);

    for (const theme of ['light', 'dark'] as const) {
      expect((await page.evaluate(theme => window.snipvia.appearance.set(theme), theme)).ok).toBe(true);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(page.locator('.notes-center')).toHaveCSS('background-color', await tokenColor(page.locator('.notes-center'), 'bg-panel'));
      await expect(page.locator('.note-tree-row.current')).toHaveCSS('background-color', await tokenColor(page.locator('.note-tree-row.current'), 'bg-selected'));
      await expect(page.locator('.note-code-block .tok-comment')).toHaveCSS('font-style', 'italic');
      expect(Number(await page.locator('.note-code-block .tok-keyword').first().evaluate(element => getComputedStyle(element).fontWeight))).toBeGreaterThanOrEqual(600);
      for (const [width, height] of [[1120, 780], [840, 600], [1600, 1000]]) {
        await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows().find(window => !new URL(window.webContents.getURL()).hash)!.setSize(size[0], size[1]), [width, height]);
        await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width);
        await page.getByRole('button', { name: 'AI 笔记', exact: true }).click();
        const layout = await page.locator('.notes-workspace').evaluate(element => {
          const center = element.querySelector('.notes-center')!.getBoundingClientRect();
          const preview = element.querySelector('.notes-document-body > .note-preview')!.getBoundingClientRect();
          return { overflow: element.scrollWidth > element.clientWidth, writingRatio: center.width / element.clientWidth, readingWidth: preview.width };
        });
        expect(layout.overflow).toBe(false); expect(layout.writingRatio).toBeGreaterThan(.65); expect(layout.readingWidth).toBeLessThanOrEqual(760);
        await page.locator('.notes-document-body').evaluate(element => { element.scrollTop = 0; });
        await expectNeutralChrome(page);
        await page.screenshot({ path: `${output}/notes-${theme}-${width}.png`, animations: 'disabled' });
        await page.getByRole('button', { name: '模型与设置', exact: true }).click();
        await page.locator('.settings-preferences').evaluate(element => { element.scrollTop = 0; });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.querySelector('main')!.scrollWidth <= document.querySelector('main')!.clientWidth)).toBe(true);
        await expectNeutralChrome(page);
        await page.screenshot({ path: `${output}/settings-${theme}-${width}.png`, animations: 'disabled' });
      }
      await page.getByRole('button', { name: '配置…', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: '配置厂商', exact: true });
      await expect(dialog).toBeVisible();
      await expect(page.getByLabel('API Key', { exact: true })).toHaveAttribute('type', 'password');
      await page.getByRole('button', { name: '刷新模型列表', exact: true }).click();
      await expect(page.getByRole('button', { name: '刷新模型列表', exact: true })).toBeEnabled();
      await expect(page.getByLabel('选择模型').locator('option')).not.toHaveCount(2);
      // Native dialog traps focus; cancel cannot alter settings or expose credentials.
      for (let index = 0; index < 12; index++) {
        await page.keyboard.press('Tab');
        expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
      }
      await expectNeutralChrome(page);
      await page.screenshot({ path: `${output}/provider-${theme}.png`, animations: 'disabled' });
      const before = await page.evaluate(() => window.snipvia.settings.get());
      await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
      await expect(page.getByRole('button', { name: '配置…', exact: true })).toBeFocused();
      expect(await page.evaluate(() => window.snipvia.settings.get())).toEqual(before);
      await categories.getByRole('button', { name: '快捷键', exact: true }).click();
      await expectNeutralChrome(page);
      await page.screenshot({ path: `${output}/shortcuts-${theme}.png`, animations: 'disabled' });
      await page.getByRole('button', { name: 'AI 笔记', exact: true }).click();
      await page.getByLabel('笔记编辑模式').selectOption('live');
      await page.locator('.cm-scroller').evaluate(element => { element.scrollTop = 0; });
      await expectNeutralChrome(page);
      await page.screenshot({ path: `${output}/notes-live-${theme}.png`, animations: 'disabled' });
      await page.getByRole('button', { name: '展开标题目录', exact: true }).click();
      await expect(page.getByRole('complementary', { name: '笔记大纲' })).toBeVisible();
      await expectNeutralChrome(page);
      await page.screenshot({ path: `${output}/notes-outline-${theme}.png`, animations: 'disabled' });
      await page.getByRole('button', { name: '关闭大纲面板', exact: true }).click();
      await page.getByLabel('笔记编辑模式').selectOption('read');
    }
    await page.getByRole('button', { name: '展开标题目录', exact: true }).click();
    await page.getByRole('complementary', { name: '笔记大纲' }).getByRole('button', { name: '边界测试', exact: true }).click();
    await expect(page.locator('.note-preview h2').filter({ hasText: '边界测试' })).toBeInViewport();
    await page.getByRole('button', { name: '关闭大纲面板', exact: true }).click();
    await page.locator('.note-code-block').getByRole('button', { name: '复制 Python 代码' }).click();
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(code);
    expect(await readFile(join(book, '二分查找.md'), 'utf8')).toBe(content + '\n我的复习记录。');
    expect(await readFile(join(book, 'assets/fixture.txt'), 'utf8')).toBe('合成附件');
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); await app.close().catch(() => {});
    await rm(directory, { recursive: true, force: true });
  }
});
