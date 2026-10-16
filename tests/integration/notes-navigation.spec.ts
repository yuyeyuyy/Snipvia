import { launchMemberDesktop } from '../helpers/desktop-account';
import { expect, test, type Locator } from '@playwright/test';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function collapseContinuously(button: Locator, selector: string, targetWidth: number) {
  const result = await button.evaluate(async (element, selector) => {
    const pane = document.querySelector(selector)!;
    const before = pane.getBoundingClientRect().width;
    const samples: number[] = []; const start = performance.now();
    (element as HTMLButtonElement).click();
    do {
      await new Promise(requestAnimationFrame);
      samples.push(pane.getBoundingClientRect().width);
    } while (performance.now() - start < 360);
    return { before, samples };
  }, selector);
  expect(result.samples.at(-1)).toBeCloseTo(targetWidth, 0);
  const intermediate = result.samples.filter((width) => width > targetWidth + 1 && width < result.before - 1);
  expect(new Set(intermediate.map((width) => Math.round(width))).size).toBeGreaterThan(2);
}

test('notes panes animate independently, keep the editor, and unlinking preserves the notebook', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'snipvia-notes-navigation-'));
  const storage = join(directory, 'app'); const book = join(directory, '工作笔记');
  await mkdir(join(book, 'assets'), { recursive: true }); await mkdir(join(book, '项目'));
  const content = '# 工作计划\n\n## 待办事项\n\n保留编辑内容与目录状态。';
  await writeFile(join(book, '首页.md'), content); await writeFile(join(book, '项目', '计划.md'), '# 项目');
  await writeFile(join(book, 'assets', 'attachment.txt'), '保留附件');
  const app = await launchMemberDesktop({ args: ['.', `--user-data-dir=${storage}`], env: { ...process.env, SNIPVIA_CONSOLE_ORIGIN: 'http://127.0.0.1:1', SNIPVIA_CAPTURE_BACKEND: 'electron', SNIPVIA_CAPTURE_WARMUP: '0' } });
  try {
    const page = await app.firstWindow(); const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
    await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, book);
    await page.getByRole('button', { name: 'AI 笔记', exact: true }).click();
    await page.getByRole('button', { name: '打开已有笔记本', exact: true }).click();
    await expect(page.getByRole('button', { name: '切换笔记本' })).toHaveText('工作笔记');
    const titleOffset = await page.locator('.notes-book-title').evaluate((element) => {
      const label = element.querySelector('span')!.getBoundingClientRect(); const icon = element.querySelector('svg')!.getBoundingClientRect();
      return Math.abs(label.top + label.height / 2 - icon.top - icon.height / 2);
    });
    expect(titleOffset).toBeLessThan(1);
    const folder = page.getByRole('treeitem', { name: '项目', exact: true });
    const arrow = folder.locator('.note-tree-chevron'); const before = await arrow.boundingBox();
    await folder.locator('.note-tree-item').click();
    await expect(folder).toHaveAttribute('aria-expanded', 'true');
    await expect.poll(() => arrow.evaluate((element) => getComputedStyle(element).transform)).toBe('matrix(0, 1, -1, 0, 0, 0)');
    const after = await arrow.boundingBox();
    expect(after!.x + after!.width / 2).toBeCloseTo(before!.x + before!.width / 2, 1);
    expect(after!.y + after!.height / 2).toBeCloseTo(before!.y + before!.height / 2, 1);
    await page.getByRole('treeitem', { name: '首页.md', exact: true }).locator('.note-tree-item').click();
    await page.getByLabel('笔记编辑模式').selectOption('source');
    const editor = page.getByRole('textbox', { name: '笔记编辑器', exact: true });
    const editingText = await editor.textContent();
    await editor.evaluate((element) => element.setAttribute('data-editor-preserved', 'true'));
    await page.getByRole('button', { name: '展开标题目录', exact: true }).click();
    await collapseContinuously(page.getByRole('button', { name: '收起文件列表' }), '.notes-files', 0);
    await expect(page.locator('.notes-files')).toHaveAttribute('inert', '');
    await collapseContinuously(page.getByRole('button', { name: '收起标题目录' }), '.notes-outline', 0);
    await expect(page.locator('.notes-outline')).toHaveAttribute('inert', '');
    await collapseContinuously(page.getByRole('button', { name: '收起菜单栏' }), '.sidebar', 52);
    await expect(editor).toHaveAttribute('data-editor-preserved', 'true');
    expect(await editor.textContent()).toBe(editingText);
    const remainingGap = await page.locator('.notes-workspace').evaluate((element) => element.clientWidth - element.querySelector('.notes-center')!.getBoundingClientRect().width);
    expect(remainingGap).toBeLessThan(3);
    await page.screenshot({ path: 'docs/ui/notes-panes-collapsed.png' });
    await page.getByRole('button', { name: '展开文件列表' }).click();
    await page.getByRole('button', { name: '展开标题目录' }).click();
    await page.getByRole('button', { name: '展开菜单栏' }).click();
    await expect.poll(() => page.locator('.notes-files').evaluate((element) => Math.round(element.getBoundingClientRect().width))).toBe(184);
    await expect(folder).toHaveAttribute('aria-expanded', 'true');
    await expect(editor).toHaveAttribute('data-editor-preserved', 'true');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByRole('button', { name: '收起标题目录' }).click();
    expect(await page.locator('.notes-outline').evaluate((element) => element.getBoundingClientRect().width)).toBe(0);
    await page.getByRole('button', { name: '展开标题目录' }).click();
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const state = await page.evaluate(() => window.snipvia.notes.state()); if (!state.ok) throw new Error(state.error);
    const notebookId = state.value.activeId!;
    expect((await page.evaluate(() => window.snipvia.notes.unlink('../../arbitrary'))).ok).toBe(false);
    // A conflicting draft must remain linked and editable until the user resolves it.
    await writeFile(join(book, '首页.md'), '磁盘上的外部修改');
    await editor.fill('不能丢失的编辑');
    await page.getByRole('button', { name: '切换笔记本' }).click();
    await page.getByRole('button', { name: '移除「工作笔记」的链接' }).click();
    await page.getByRole('dialog', { name: '移除笔记本链接', exact: true }).getByRole('button', { name: '移除链接', exact: true }).click();
    await expect(page.getByText('文件已被其他程序修改', { exact: true })).toBeVisible();
    await expect(editor).toHaveText('不能丢失的编辑');
    const retained = await page.evaluate(() => window.snipvia.notes.state());
    expect(retained.ok && retained.value.activeId).toBe(notebookId);
    expect(await readFile(join(book, '首页.md'), 'utf8')).toBe('磁盘上的外部修改');
    await page.getByRole('button', { name: '载入磁盘版本', exact: true }).click();
    await editor.fill(content + '\n\n移除之前的修改。');
    await page.getByRole('button', { name: '切换笔记本' }).click();
    await page.getByRole('button', { name: '移除「工作笔记」的链接' }).click();
    const confirmation = page.getByRole('dialog', { name: '移除笔记本链接', exact: true });
    await expect(confirmation.getByRole('button', { name: '取消', exact: true })).toBeFocused();
    await page.screenshot({ path: 'docs/ui/notes-unlink-confirmation.png' });
    await confirmation.getByRole('button', { name: '取消', exact: true }).click();
    expect((await page.evaluate(() => window.snipvia.notes.state())).ok).toBe(true);
    await expect(editor).toContainText('移除之前的修改。');
    await page.getByRole('button', { name: '切换笔记本' }).click();
    await page.getByRole('button', { name: '移除「工作笔记」的链接' }).click();
    await confirmation.getByRole('button', { name: '移除链接', exact: true }).click();
    await expect(page.getByRole('button', { name: '创建笔记', exact: true })).toBeVisible();
    expect(await readFile(join(book, '首页.md'), 'utf8')).toContain('移除之前的修改。');
    expect(await readFile(join(book, 'assets', 'attachment.txt'), 'utf8')).toBe('保留附件');
    expect((await readdir(book)).sort()).toEqual(['assets', '首页.md', '项目'].sort());
    expect(JSON.parse(await readFile(join(storage, 'notebooks.json'), 'utf8'))).toEqual({ notebooks: [], activeId: null });
    expect((await page.evaluate((id) => window.snipvia.notes.read(id, '首页.md'), notebookId)).ok).toBe(false);
    await page.getByRole('button', { name: '打开已有笔记本', exact: true }).click();
    await page.getByRole('treeitem', { name: '首页.md', exact: true }).locator('.note-tree-item').click();
    await expect(editor).toContainText('移除之前的修改。');
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); await app.close().catch(() => {});
    await rm(directory, { recursive: true, force: true });
  }
});
