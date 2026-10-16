import { tokenColor } from '../helpers/appearance';
import { _electron as electron, expect, test, type Locator } from '@playwright/test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('notebook files and folders drag into directories or root with feedback and protected targets', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'snipvia-notes-drag-')); const book = join(directory, '研究笔记');
  for (const path of ['assets', '归档', '冲突', '资料/子项目']) await mkdir(join(book, path), { recursive: true });
  const content = '# 欢迎\n\n拖动前的内容。';
  await writeFile(join(book, '欢迎.md'), content); await writeFile(join(book, '引用.md'), '[[欢迎]]\n[[资料/子项目/草稿]]');
  await writeFile(join(book, '冲突', '欢迎.md'), '# 保留已有文件');
  await writeFile(join(book, '归档', '读我.md'), '# 归档说明');
  await writeFile(join(book, '资料', '子项目', '草稿.md'), '# 草稿');
  await writeFile(join(book, '说明.txt'), '普通文件内容'); await writeFile(join(book, 'assets', 'hidden.txt'), '保留隐藏附件');
  const app = await electron.launch({ args: ['.', `--user-data-dir=${join(directory, 'app')}`], env: { ...process.env, SNIPVIA_CONSOLE_ORIGIN: 'http://127.0.0.1:1', SNIPVIA_CAPTURE_BACKEND: 'electron', SNIPVIA_CAPTURE_WARMUP: '0' } });
  try {
    const page = await app.firstWindow(); const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
    await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, book);
    await page.getByRole('button', { name: 'AI 笔记', exact: true }).click();
    await page.getByRole('button', { name: '打开已有笔记本', exact: true }).click();
    const row = (path: string) => page.locator(`.note-tree-row[data-note-path=${JSON.stringify(path)}]`);
    const button = (path: string) => row(path).locator('.note-tree-item');
    const tree = page.getByRole('tree', { name: '笔记文件', exact: true });
    const preview = page.getByRole('status', { name: '拖拽移动提示', exact: true });
    const root = page.getByRole('button', { name: '选择笔记本根目录', exact: true });
    await expect(tree.getByRole('treeitem', { name: 'assets', exact: true })).toHaveCount(0);
    await expect(tree).not.toContainText('hidden.txt');
    await button('欢迎.md').click(); await page.getByLabel('笔记编辑模式').selectOption('source');
    const editor = page.getByRole('textbox', { name: '笔记编辑器', exact: true });
    await editor.fill(content + '\n\n移动前最后一笔。');
    async function hoverDrag(source: Locator, target: Locator) {
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => !window.webContents.getURL().includes('#'))?.focus());
      const from = await source.boundingBox(); const to = await target.boundingBox();
      await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
      await page.mouse.down(); await page.mouse.move(from!.x + from!.width / 2 + 8, from!.y + from!.height / 2, { steps: 4 });
      await page.mouse.move(to!.x + to!.width / 2, to!.y + to!.height / 2, { steps: 8 });
    }
    await hoverDrag(button('欢迎.md'), button('归档'));
    await expect(preview).toContainText('移动到「归档」');
    await expect(row('欢迎.md')).toHaveClass(/drag-source/);
    await expect(row('归档').locator('..')).toHaveClass(/drop-target/);
    await expect(row('归档')).toHaveAttribute('aria-expanded', 'true');
    await expect(row('归档/读我.md')).toBeVisible();
    await page.screenshot({ path: 'docs/ui/notes-drag-folder.png' });
    await page.mouse.up();
    await expect(row('归档/欢迎.md')).toBeVisible(); await expect(preview).toHaveCount(0);
    expect(await readFile(join(book, '归档', '欢迎.md'), 'utf8')).toContain('移动前最后一笔。');
    expect(await readFile(join(book, '引用.md'), 'utf8')).toContain('[[归档/欢迎]]');
    await expect(page.locator('.notes-document-bar > span')).toHaveAttribute('title', '归档/欢迎.md');
    await hoverDrag(button('归档/欢迎.md'), root);
    await expect(preview).toContainText('移动到「笔记本根目录」');
    await expect(tree).toHaveClass(/root-drop-target/);
    await expect(button('归档/欢迎.md')).toHaveCSS('color', await tokenColor(button('归档/欢迎.md'), 'text-on-accent'));
    await page.screenshot({ path: 'docs/ui/notes-drag-root.png' }); await page.mouse.up();
    await expect(row('欢迎.md')).toBeVisible(); expect(await readFile(join(book, '引用.md'), 'utf8')).toContain('[[欢迎]]');
    // Move an expanded folder with its descendants, keeping the open note and updating its links.
    await button('资料').click(); await button('资料/子项目').click(); await button('资料/子项目/草稿.md').click();
    await button('资料').dragTo(button('归档'));
    await expect(row('归档/资料/子项目/草稿.md')).toBeVisible();
    await expect(page.locator('.notes-document-bar > span')).toHaveAttribute('title', '归档/资料/子项目/草稿.md');
    expect(await readFile(join(book, '引用.md'), 'utf8')).toContain('[[归档/资料/子项目/草稿]]');
    await button('归档/资料').dragTo(root);
    await expect(row('资料/子项目/草稿.md')).toBeVisible();
    expect(await readFile(join(book, '资料', '子项目', '草稿.md'), 'utf8')).toBe('# 草稿');
    await button('说明.txt').dragTo(button('归档'));
    await expect(row('归档/说明.txt')).toBeVisible(); expect(await readFile(join(book, '归档', '说明.txt'), 'utf8')).toBe('普通文件内容');
    // Synthetic drag events cover disallowed drops that the native cursor refuses to deliver.
    async function rejectedDrop(source: Locator, target: Locator, reason: string) {
      const data = await page.evaluateHandle(() => new DataTransfer());
      await source.dispatchEvent('dragstart', { dataTransfer: data }); await target.dispatchEvent('dragover', { dataTransfer: data });
      await expect(preview).toContainText(reason);
      await target.dispatchEvent('drop', { dataTransfer: data }); await expect(preview).toHaveCount(0); await data.dispose();
    }
    await rejectedDrop(button('欢迎.md'), button('冲突'), '目标目录已有同名文件或文件夹');
    expect(await readFile(join(book, '冲突', '欢迎.md'), 'utf8')).toBe('# 保留已有文件');
    await rejectedDrop(button('资料'), button('资料/子项目'), '不能移入自身或子文件夹');
    expect(await readFile(join(book, '资料', '子项目', '草稿.md'), 'utf8')).toBe('# 草稿');
    const cancelling = await page.evaluateHandle(() => new DataTransfer());
    await button('欢迎.md').dispatchEvent('dragstart', { dataTransfer: cancelling });
    await button('冲突').dispatchEvent('dragover', { dataTransfer: cancelling }); await page.keyboard.press('Escape');
    await expect(preview).toHaveCount(0); await expect(page.locator('.notes-tree .drop-target, .notes-tree .drag-source')).toHaveCount(0);
    await root.dispatchEvent('drop', { dataTransfer: cancelling }); await cancelling.dispose();
    await expect(row('欢迎.md')).toBeVisible();
    // Long lists scroll at the edge while dragging and stop immediately on cancellation.
    await Promise.all(Array.from({ length: 45 }, (_, index) => writeFile(join(book, `条目${String(index).padStart(2, '0')}.md`), '# 条目')));
    await page.getByRole('button', { name: '刷新文件目录' }).click(); await expect(row('条目44.md')).toHaveCount(1);
    await tree.evaluate((element) => { element.scrollTop = 0; });
    const scrolling = await page.evaluateHandle(() => new DataTransfer()); const bounds = await tree.boundingBox();
    await button('欢迎.md').dispatchEvent('dragstart', { dataTransfer: scrolling, clientX: bounds!.x + 40, clientY: bounds!.y + 30 });
    await tree.dispatchEvent('dragover', { dataTransfer: scrolling, clientX: bounds!.x + 40, clientY: bounds!.y + bounds!.height - 3 });
    await expect.poll(() => tree.evaluate((element) => element.scrollTop)).toBeGreaterThan(10);
    await page.keyboard.press('Escape'); await expect(preview).toHaveCount(0);
    const stopped = await tree.evaluate(async (element) => { const before = element.scrollTop; await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); return element.scrollTop - before; });
    expect(stopped).toBe(0); await scrolling.dispose();
    expect(await readFile(join(book, 'assets', 'hidden.txt'), 'utf8')).toBe('保留隐藏附件'); expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); await app.close().catch(() => {}); await rm(directory, { recursive: true, force: true });
  }
});
