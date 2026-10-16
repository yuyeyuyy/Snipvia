import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtemp, readFile, writeFile, readdir, rm, mkdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('local notebook creation, editing, outlines, wiki links, assets, rename, export and quit flush', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'snipvia-notes-ui-'));
  const storage = join(directory, 'app'); const location = join(directory, 'books'); await mkdir(location);
  const app = await electron.launch({ args: ['.', `--user-data-dir=${storage}`], env: { ...process.env, SNIPVIA_CONSOLE_ORIGIN: 'http://127.0.0.1:1', SNIPVIA_CAPTURE_BACKEND: 'electron', SNIPVIA_CAPTURE_WARMUP: '0' } });
  let closed = false;
  try {
    const page = await app.firstWindow(); const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
    async function expectWorkspaceLayout() {
      const layout = await page.locator('.notes-workspace').evaluate((element) => {
        const files = element.querySelector('.notes-files')!.getBoundingClientRect();
        const center = element.querySelector('.notes-center')!.getBoundingClientRect();
        const outline = element.querySelector('.notes-outline')!.getBoundingClientRect();
        const workspace = element.getBoundingClientRect();
        const panel = element.closest('.notes-panel')!;
        const heading = panel.querySelector('.workspace-heading')!.getBoundingClientRect();
        return { filesRight: files.right, centerLeft: center.left, centerRight: center.right, outlineLeft: outline.left,
          filesOverlay: getComputedStyle(element.querySelector('.notes-files')!).position === 'absolute',
          outlineOverlay: getComputedStyle(element.querySelector('.notes-outline')!).position === 'absolute',
          left: workspace.left, right: workspace.right, outlineRight: outline.right,
          widthRatio: workspace.width / panel.clientWidth, headingWidth: heading.width, workspaceWidth: workspace.width,
          bottomGap: panel.getBoundingClientRect().bottom - workspace.bottom, paddingBottom: parseFloat(getComputedStyle(panel).paddingBottom),
          overflow: element.scrollWidth > element.clientWidth || document.documentElement.scrollWidth > innerWidth };
      });
      if (layout.filesOverlay) expect(layout.filesRight).toBeLessThanOrEqual(layout.right + 1);
      else expect(layout.filesRight).toBeLessThanOrEqual(layout.centerLeft + 1);
      if (layout.outlineOverlay) {
        expect(layout.outlineLeft).toBeGreaterThanOrEqual(layout.left);
        expect(layout.outlineRight).toBeLessThanOrEqual(layout.right + 1);
      } else expect(layout.centerRight).toBeLessThanOrEqual(layout.outlineLeft + 1);
      expect(layout.widthRatio).toBeGreaterThan(0.9);
      expect(Math.abs(layout.headingWidth - layout.workspaceWidth)).toBeLessThan(2);
      expect(Math.abs(layout.bottomGap - layout.paddingBottom)).toBeLessThan(2);
      expect(layout.overflow).toBe(false);
    }
    await expect(page.getByRole('button', { name: 'AI 笔记', exact: true })).toBeVisible();
    await app.evaluate(({ dialog }, paths) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [paths.location] });
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: paths.exportPath });
    }, { location, exportPath: join(directory, '研究笔记.zip') });
    await page.getByRole('button', { name: 'AI 笔记', exact: true }).click();
    await expect(page.getByRole('button', { name: '创建笔记', exact: true })).toBeEnabled();
    await page.screenshot({ path: 'docs/ui/notes-empty.png' });
    await page.getByRole('button', { name: '创建笔记', exact: true }).click();
    await page.getByLabel('笔记本名称', { exact: true }).fill('研究笔记');
    await page.getByRole('button', { name: '创建', exact: true }).click();
    await expect(page.getByRole('button', { name: '切换笔记本' })).toHaveText('研究笔记');
    const root = join(location, '研究笔记'); expect(await readdir(root)).toEqual(['assets']);
    await expectWorkspaceLayout();
    await page.screenshot({ path: 'docs/ui/notes-blank.png' });
    await page.getByRole('button', { name: '新建笔记', exact: true }).click();
    await page.getByRole('textbox', { name: '名称', exact: true }).fill('首页'); await page.getByRole('button', { name: '创建', exact: true }).click();
    const editor = page.getByRole('textbox', { name: '笔记编辑器', exact: true });
    const home = '# 我的研究\n\n一处收集想法，慢慢连接成知识。\n\n## 进行中的研究\n\n[[项目/方案设计|查看方案]]\n\n- [ ] 整理资料\n- [x] 创建笔记本\n\n## 随手记\n\n**保持好奇**，也保持耐心。';
    await editor.fill(home);
    await expect.poll(() => readFile(join(root, '首页.md'), 'utf8')).toBe(home);
    await page.getByLabel('笔记编辑模式').selectOption('source');
    const editingContent = await editor.textContent();
    await page.getByRole('button', { name: '收起菜单栏' }).click();
    await expectWorkspaceLayout();
    expect(await editor.textContent()).toBe(editingContent);
    await page.getByRole('button', { name: '展开菜单栏' }).click();
    await expectWorkspaceLayout();
    expect(await editor.textContent()).toBe(editingContent);
    await page.getByLabel('笔记编辑模式').selectOption('live');
    await page.getByRole('button', { name: '新建文件夹', exact: true }).click();
    await page.getByRole('textbox', { name: '名称', exact: true }).fill('项目'); await page.getByRole('button', { name: '创建', exact: true }).click();
    await page.getByRole('button', { name: '新建笔记', exact: true }).click();
    await page.getByRole('textbox', { name: '名称', exact: true }).fill('方案设计'); await page.getByRole('button', { name: '创建', exact: true }).click();
    const plan = '# 方案设计\n\n[[首页]]\n\n## 设计原则\n\n用本地 Markdown 连接想法。\n\n### 文件与附件\n\n所有附件集中保存在 assets。\n\n## 测试场景\n\n' + Array.from({ length: 12 }, (_, i) => `第 ${i + 1} 项验证：保持清楚、轻量和可移植。\n`).join('\n') + '\n## 下一步\n\n继续完善。';
    await editor.fill(plan); await expect.poll(() => readFile(join(root, '项目', '方案设计.md'), 'utf8')).toBe(plan);
    await page.getByLabel('笔记编辑模式').selectOption('read');
    await page.getByRole('button', { name: '展开标题目录', exact: true }).click();
    await page.getByRole('complementary', { name: '笔记大纲' }).getByRole('button', { name: '下一步', exact: true }).click();
    await expect(page.locator('.note-preview h2').filter({ hasText: '下一步' })).toBeInViewport();
    await page.getByRole('complementary', { name: '笔记大纲' }).getByRole('button', { name: '方案设计', exact: true }).click();
    await page.locator('.note-preview').getByRole('link', { name: '首页', exact: true }).click();
    await expect(page.locator('.note-preview h1')).toHaveText('我的研究');
    await expect(page.locator('.notes-backlinks').getByRole('button', { name: '方案设计' })).toBeVisible();
    await page.locator('.note-preview').getByRole('link', { name: '查看方案' }).click();
    await expect(page.locator('.note-preview h1')).toHaveText('方案设计');
    await page.getByLabel('笔记编辑模式').selectOption('source');
    await editor.fill(plan + '\n![[assets/sample.png]]\n\n![[首页]]\n');
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64');
    await writeFile(join(root, 'assets', 'sample.png'), png);
    await page.getByRole('button', { name: '刷新文件目录' }).click();
    await page.getByLabel('笔记编辑模式').selectOption('read');
    await expect(page.locator('.note-preview img')).toHaveAttribute('src', /^data:image\/png;base64,/);
    await expect(page.locator('.note-embed h1')).toHaveText('我的研究');
    await expect(page.locator('.note-embed h1')).not.toHaveAttribute('id');
    // Exercise native attachment import and image paste, including actual assets/ placement.
    const attachment = join(directory, 'reference.txt'); await writeFile(attachment, 'synthetic attachment');
    await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, attachment);
    await page.getByLabel('笔记编辑模式').selectOption('source');
    await page.getByRole('button', { name: '添加附件', exact: true }).click();
    await expect.poll(() => readdir(join(root, 'assets'))).toEqual(expect.arrayContaining([expect.stringMatching(/reference\.txt$/)]));
    await editor.evaluate((element, values) => {
      const data = new DataTransfer(); data.items.add(new File([new Uint8Array(values)], 'pasted.png', { type: 'image/png' }));
      element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
    }, [...png]);
    await expect.poll(async () => (await readFile(join(root, '项目', '方案设计.md'), 'utf8')).includes('-pasted.png]]')).toBe(true);
    // Rename updates the existing inbound wiki link in another file.
    await page.getByRole('button', { name: '方案设计.md 的操作' }).click(); await page.getByRole('menuitem', { name: '重命名' }).click();
    await page.getByRole('textbox', { name: '名称', exact: true }).fill('方案 v2.md'); await page.getByRole('button', { name: '确定', exact: true }).click();
    await expect.poll(() => readFile(join(root, '首页.md'), 'utf8')).toContain('[[项目/方案 v2|查看方案]]');
    await page.getByLabel('笔记编辑模式').selectOption('live');
    await page.getByRole('button', { name: '刷新文件目录' }).click();
    await expectWorkspaceLayout();
    await page.screenshot({ path: 'docs/ui/notes-workspace.png' });
    const fullscreenWidth = await app.evaluate(({ BrowserWindow, screen }) => {
      const window = BrowserWindow.getAllWindows().find((window) => !window.webContents.getURL().includes('#'))!;
      const width = screen.getDisplayMatching(window.getBounds()).bounds.width;
      window.setFullScreen(true); return width;
    });
    await expect.poll(() => page.evaluate(() => innerWidth)).toBe(fullscreenWidth);
    await expectWorkspaceLayout();
    await expect(page.getByRole('button', { name: '新建笔记', exact: true })).toBeInViewport();
    await expect(page.getByLabel('笔记编辑模式')).toBeInViewport();
    await page.screenshot({ path: 'docs/ui/notes-fullscreen.png' });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => !window.webContents.getURL().includes('#'))?.setFullScreen(false));
    await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThan(fullscreenWidth);
    // External edits are never silently overwritten; the local draft can become a copy.
    await writeFile(join(root, '项目', '方案 v2.md'), '外部修改');
    await editor.fill('我的待保存版本');
    await expect(page.getByText('文件已被其他程序修改', { exact: true })).toBeVisible();
    expect(await readFile(join(root, '项目', '方案 v2.md'), 'utf8')).toBe('外部修改');
    await page.getByRole('button', { name: '我的编辑另存副本' }).click();
    await expect(page.getByText('文件已被其他程序修改', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '打包导出' }).click();
    await expect.poll(async () => (await stat(join(directory, '研究笔记.zip')).catch(() => ({ size: 0 }))).size).toBeGreaterThan(100);
    const previousPath = await page.locator('.notes-document-bar > span').getAttribute('title');
    await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, location);
    await page.getByRole('button', { name: '切换笔记本' }).click();
    await page.getByRole('button', { name: '创建笔记本', exact: true }).click();
    await page.getByLabel('笔记本名称', { exact: true }).fill('生活笔记'); await page.getByRole('button', { name: '创建', exact: true }).click();
    await expect(page.getByRole('button', { name: '切换笔记本' })).toHaveText('生活笔记');
    await page.getByRole('button', { name: '切换笔记本' }).click();
    await page.locator('.notes-book-select').filter({ hasText: '研究笔记' }).click();
    await expect(page.locator('.notes-document-bar > span')).toHaveAttribute('title', previousPath!);
    await expect(editor).toContainText('我的待保存版本');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => !window.webContents.getURL().includes('#'))?.setSize(840, 620));
    await expect(page.getByRole('button', { name: '新建笔记', exact: true })).toBeInViewport();
    await expect(page.getByLabel('笔记编辑模式')).toBeInViewport();
    expect(await page.locator('.notes-workspace').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await expectWorkspaceLayout();
    await page.screenshot({ path: 'docs/ui/notes-compact.png' });
    expect(errors).toEqual([]);
    const currentPath = await page.locator('.notes-document-bar > span').getAttribute('title');
    await editor.fill('退出前最后一笔');
    await app.close(); closed = true;
    expect(await readFile(join(root, currentPath!), 'utf8')).toBe('退出前最后一笔');
    expect(JSON.parse(await readFile(join(storage, 'notebooks.json'), 'utf8')).notebooks).toHaveLength(2);
  } finally { if (!closed) { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); await app.close().catch(() => {}); } await rm(directory, { recursive: true, force: true }); }
});
