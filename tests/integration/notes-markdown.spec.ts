import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function notebook(content: string) {
  const directory = await mkdtemp(join(tmpdir(), 'snipvia-markdown-ui-')), root = join(directory, '算法笔记');
  await mkdir(root); await writeFile(join(root, '学习.md'), content);
  const app = await electron.launch({ args: ['.', `--user-data-dir=${join(directory, 'client')}`], env: { ...process.env, SNIPVIA_CONSOLE_ORIGIN: 'http://127.0.0.1:1', SNIPVIA_CAPTURE_WARMUP: '0' } });
  const page = await app.firstWindow();
  await app.evaluate(({ dialog }, root) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] }); }, root);
  await page.getByRole('button', { name: '打开已有笔记本', exact: true }).click();
  await page.getByRole('button', { name: '学习', exact: true }).click();
  return { app, page, root, close: async () => { await app.close(); await rm(directory, { recursive: true, force: true }); } };
}

test('点击实时预览中的文字，输入保留在所点击的行，滚动和折叠侧栏后仍一致', async () => {
  const content = '# 数据结构学习\n\n第一段：记录我的学习思路。\n\n## 二分查找\n\n第二段：循环需要不断缩小区间。\n第三段：检查空数组和重复值。\n\n' + Array.from({ length: 50 }, (_, i) => `第 ${i + 1} 条复习记录。`).join('\n') + '\n\n## 下一章\n\n末尾段落：这是最后的学习记录。\n';
  const f = await notebook(content);
  try {
    const editor = f.page.locator('.cm-content');
    for (const [index, text] of ['第一段：', '第二段：', '第三段：', '末尾段落：'].entries()) {
      await f.page.getByLabel('笔记编辑模式').selectOption('source'); await editor.fill(content);
      await f.page.getByLabel('笔记编辑模式').selectOption('live');
      const line = editor.locator('.cm-line').filter({ hasText: text });
      await line.scrollIntoViewIfNeeded();
      const box = await line.boundingBox(); if (!box) throw new Error('missing line');
      await f.page.mouse.click(box.x + 45, box.y + box.height / 2);
      const marker = `【定位${index}】`; await f.page.keyboard.insertText(marker);
      const expected = content.split('\n').findIndex(line => line.includes(text));
      await expect.poll(async () => (await readFile(join(f.root, '学习.md'), 'utf8')).split('\n').findIndex(line => line.includes(marker))).toBe(expected);
      if (index === 1) await f.page.getByRole('button', { name: '收起文件列表', exact: true }).click();
    }
  } finally { await f.close(); }
});

test('实时预览与阅读模式共用代码高亮、语言复制和 GFM 表格，点击单元格编辑正确位置', async () => {
  test.setTimeout(60_000);
  const code = 'def binary_search(nums, target):\n    left = 0  # 初始化左边界\n    while left < len(nums):\n        return "<script>"\n';
  const content = '# 二分查找\n\n练习：保留循环不变式。\n\n```py\n' + code + '```\n\n| 轮次 | left | right | mid | nums[mid] | 动作 |\n| :--- | ---: | ---: | ---: | :---: | --- |\n| 1 | 0 | 2 | 1 | 3 | `left = mid` |\n| 2 | 1 | 2 | 1 | 3 | **死循环** |\n| 3 | 1 | 2 | 1 | 3 | left \\| mid |\n\n结尾：整理边界测试。\n\n<script>window.markdownPwned = true</script>\n';
  const f = await notebook(content), errors: string[] = []; f.page.on('pageerror', error => errors.push(error.message));
  try {
    const liveCode = f.page.locator('.note-live-code-block');
    await expect(liveCode.locator('.tok-comment')).toContainText('初始化左边界');
    await expect(liveCode.locator('.tok-keyword').first()).toHaveText('def');
    await liveCode.getByRole('button', { name: '复制 Python 代码' }).click();
    await expect(liveCode.getByRole('button', { name: '复制 Python 代码' })).toHaveText('已复制');
    expect(await f.app.evaluate(({ clipboard }) => clipboard.readText())).toBe(code);
    const line = liveCode.locator('.cm-line').filter({ hasText: 'left = 0' });
    const box = await line.boundingBox(); if (!box) throw new Error('missing code line');
    await f.page.mouse.click(box.x + 55, box.y + box.height / 2); await f.page.keyboard.insertText('CODE_MARK');
    await expect.poll(async () => (await readFile(join(f.root, '学习.md'), 'utf8')).split('\n').findIndex(line => line.includes('CODE_MARK'))).toBe(content.split('\n').findIndex(line => line.includes('left = 0')));
    await f.page.keyboard.press('ControlOrMeta+z');
    await expect.poll(() => readFile(join(f.root, '学习.md'), 'utf8')).toBe(content);
    const table = f.page.locator('.note-live-table table');
    await expect(table.locator('th')).toHaveCount(6); await expect(table.locator('tbody tr')).toHaveCount(3);
    await expect(table.locator('strong')).toHaveText('死循环');
    await expect(table.locator('tbody tr').last().locator('td').last()).toHaveText('left | mid');
    await table.locator('tbody tr').first().locator('td').nth(1).click();
    await expect(f.page.locator('.note-live-table')).toHaveCount(0);
    await f.page.keyboard.insertText('CELL_MARK');
    await expect.poll(async () => (await readFile(join(f.root, '学习.md'), 'utf8')).split('\n').find(line => line.startsWith('| 1 |'))?.split('|')[2]).toContain('CELL_MARK');
    const end = f.page.locator('.cm-line').filter({ hasText: '结尾：' }); await end.click();
    await expect(table).toBeVisible();
    // Restore the synthetic fixture before inspecting the exported reading UI.
    await f.page.getByLabel('笔记编辑模式').selectOption('source'); await f.page.locator('.cm-content').fill(content);
    await f.page.getByLabel('笔记编辑模式').selectOption('read');
    const block = f.page.locator('.note-code-block');
    await expect(block.locator('.tok-comment')).toContainText('初始化左边界');
    const presentation = await block.evaluate(element => {
      const button = element.querySelector('button')!, keyword = element.querySelector('.tok-keyword')!, comment = element.querySelector('.tok-comment')!;
      return { background: getComputedStyle(element).backgroundColor, keyword: getComputedStyle(keyword).color, comment: getComputedStyle(comment).color,
        buttonRight: button.getBoundingClientRect().right, right: element.getBoundingClientRect().right };
    });
    expect(presentation.background).not.toBe('rgb(255, 255, 255)'); expect(presentation.comment).not.toBe(presentation.keyword);
    expect(presentation.right - presentation.buttonRight).toBeLessThan(25);
    await block.getByRole('button', { name: '复制 Python 代码' }).click();
    await expect.poll(() => f.app.evaluate(({ clipboard }) => clipboard.readText())).toBe(code);
    await expect(block.getByRole('button', { name: '复制 Python 代码' })).toHaveText('Python');
    await expect(f.page.locator('.note-preview table th')).toHaveCount(6);
    await expect(f.page.locator('.note-preview table tbody tr')).toHaveCount(3);
    expect(await f.page.locator('.note-preview table th').nth(1).evaluate(element => getComputedStyle(element).textAlign)).toBe('right');
    expect(await f.page.evaluate(() => (window as typeof window & { markdownPwned?: boolean }).markdownPwned)).toBeUndefined();
    await f.page.screenshot({ path: 'docs/ui/notes-markdown-reading.png' });
    await f.page.getByLabel('笔记编辑模式').selectOption('live');
    await expect(f.page.locator('.note-live-table table')).toBeVisible();
    await f.page.locator('.cm-line').filter({ hasText: '练习：' }).click();
    await f.page.screenshot({ path: 'docs/ui/notes-markdown-live.png' });
    await f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => !window.webContents.getURL().includes('#'))!.setSize(840, 620));
    await expect.poll(() => f.page.evaluate(() => innerWidth)).toBe(840);
    await expect(f.page.locator('.notes-workspace')).toBeVisible();
    expect(await f.page.locator('.notes-workspace').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(errors).toEqual([]);
  } finally { await f.close(); }
});
