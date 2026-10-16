import { launchMemberDesktop } from '../helpers/desktop-account';
import { expect, test } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chatModelId } from '../../src/renderer/src/chat/model-choice';

test('desktop settings, safe IPC, image chat and cancellation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'snipvia-smoke-'));
  let requestBody = '';
  let predictSchedule = false;
  const server = createServer((request, response) => {
    requestBody = '';
    request.on('data', (chunk: Buffer) => { requestBody += chunk.toString(); });
    request.on('end', () => {
      if (requestBody.includes('等待取消')) return;
      response.setHeader('Content-Type', 'application/json');
      if (predictSchedule && requestBody.includes('You are a screenshot classifier')) {
        response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ contentType: 'text', confidence: 0.95, matchedBranchId: 'create-schedule', signals: { hasSchedule: true } }) } }] }));
        return;
      }
      if (requestBody.includes('EVENT_EXTRACTION_SCHEMA')) {
        response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ events: [{
          kind: 'event', title: '产品评审', allDay: false, startAt: '2026-09-18T14:00:00+08:00', endAt: '2026-09-18T15:00:00+08:00',
          startDate: null, endDate: null, dueAt: null, dueDate: null, timezone: 'Asia/Shanghai', location: '3A 会议室', people: ['小王'], notes: '检查原型',
          unresolvedFields: [], warnings: ['结束时间由上下文推断']
        }, {
          kind: 'event', title: '上海出差', allDay: true, startAt: null, endAt: null,
          startDate: '2026-09-04', endDate: '2026-09-09', dueAt: null, dueDate: null, timezone: 'Asia/Shanghai', location: '上海', people: [], notes: '',
          unresolvedFields: [], warnings: []
        }] }) } }] }));
        return;
      }
      response.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '## 图片摘要\n\n- **重点一**\n- 重点二\n\n| 项目 | 内容 |\n| --- | --- |\n| 类型 | 测试图 |\n\n`inline`\n\n```ts\nconst safe = true;\n```\n\n[官方文档](https://example.com/docs)\n\n[危险链接](javascript:alert(1))\n\n![远程图片](https://example.com/tracker.png)\n\n<script>window.markdownInjected = true</script>' } }] }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('mock server unavailable');
  const app = await launchMemberDesktop({ args: ['.', `--user-data-dir=${directory}`], env: { ...process.env, SNIPVIA_CONSOLE_ORIGIN: 'http://127.0.0.1:1', SNIPVIA_CAPTURE_BACKEND: 'electron', SNIPVIA_CAPTURE_WARMUP: '0' } });
  try {
    const page = await app.firstWindow();
    expect(await app.evaluate(({ app }) => process.platform !== 'darwin' || Boolean(app.dock?.isVisible()))).toBe(true);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await expect(page.getByRole('button', { name: 'AI 笔记', exact: true })).toHaveAttribute('aria-current', 'page');
    const titlebar = page.getByRole('banner', { name: '窗口标题栏' });
    const assertWindowLayout = async () => {
      const layout = await page.locator('.app-shell').evaluate((element) => {
        const shell = element.getBoundingClientRect();
        const titlebar = element.querySelector('.app-titlebar')!.getBoundingClientRect();
        const sidebar = element.querySelector('.sidebar')!.getBoundingClientRect();
        const content = element.querySelector('main')!.getBoundingClientRect();
        return {
          titleLeft: titlebar.left - shell.left, titleWidth: titlebar.width - shell.width,
          sidebarLeft: sidebar.left - shell.left, sidebarTop: sidebar.top - titlebar.bottom,
          contentLeft: content.left - sidebar.right, contentTop: content.top - titlebar.bottom,
          contentRight: content.right - shell.right
        };
      });
      for (const offset of Object.values(layout)) expect(Math.abs(offset), JSON.stringify(layout)).toBeLessThan(1);
    };
    await expect(titlebar.locator('.brand-name')).toHaveText('截然');
    await expect(titlebar.getByRole('button', { name: '账号与登录' })).toHaveText('');
    await expect(titlebar.getByRole('button', { name: '模型与设置' })).toHaveText('');
    await expect(titlebar).toHaveCSS('-webkit-app-region', 'drag');
    await expect(titlebar.getByRole('button', { name: '模型与设置' })).toHaveCSS('-webkit-app-region', 'no-drag');
    await expect(page.locator('.sidebar .nav')).toHaveCount(4);
    await expect(page.locator('.sidebar')).not.toContainText(/截取区域|工作空间|截图与笔记保存在本机|登录|模型与设置/);
    const expandedWidth = await page.locator('.sidebar').evaluate((element) => element.getBoundingClientRect().width);
    await assertWindowLayout();
    await page.screenshot({ path: 'docs/ui/navigation-expanded.png' });
    await titlebar.getByRole('button', { name: '收起菜单栏' }).click();
    await expect(titlebar.getByRole('button', { name: '展开菜单栏' })).toHaveAttribute('aria-expanded', 'false');
    await expect.poll(() => page.locator('.sidebar').evaluate((element) => element.getBoundingClientRect().width)).toBe(52);
    await assertWindowLayout();
    for (const label of await page.locator('.sidebar .nav span').all()) await expect(label).toBeHidden();
    await page.screenshot({ path: 'docs/ui/navigation-collapsed.png' });
    await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '历史对话' }).click();
    await expect(page.getByRole('heading', { name: '历史对话' })).toBeVisible();
    const iconOffsets = await page.locator('.sidebar').evaluate((element) => {
      const sidebar = element.getBoundingClientRect();
      return { scroll: element.scrollLeft, offsets: [...element.querySelectorAll('.nav svg')].map((icon) => {
        const rect = icon.getBoundingClientRect(); return Math.abs(rect.left + rect.width / 2 - sidebar.left - sidebar.width / 2);
      }) };
    });
    expect(iconOffsets.scroll).toBe(0); expect(Math.max(...iconOffsets.offsets)).toBeLessThan(2);
    await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: 'AI 笔记' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'AI 笔记', exact: true })).toHaveAttribute('aria-current', 'page');
    await page.reload();
    await expect(titlebar.getByRole('button', { name: '展开菜单栏' })).toHaveAttribute('aria-expanded', 'false');
    await titlebar.getByRole('button', { name: '展开菜单栏' }).click();
    await expect.poll(() => page.locator('.sidebar').evaluate((element) => element.getBoundingClientRect().width)).toBe(expandedWidth);
    await assertWindowLayout();
    const originalBounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => !new URL(window.webContents.getURL()).hash)!.getBounds());
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => !new URL(window.webContents.getURL()).hash)!.setSize(900, 700));
    await expect.poll(() => page.locator('.sidebar').evaluate(element => element.getBoundingClientRect().width)).toBe(52);
    await assertWindowLayout();
    await app.evaluate(({ BrowserWindow }, bounds) => BrowserWindow.getAllWindows().find(window => !new URL(window.webContents.getURL()).hash)!.setBounds(bounds), originalBounds);
    await expect.poll(() => page.locator('.sidebar').evaluate(element => element.getBoundingClientRect().width)).toBe(expandedWidth);
    await expect.poll(() => app.windows().some((window) => window.url().endsWith('#capture'))).toBe(true);
    await expect.poll(() => app.windows().some((window) => window.url().endsWith('#pin'))).toBe(true);
    const overlay = app.windows().find((window) => window.url().endsWith('#capture'))!;
    const pinned = app.windows().find((window) => window.url().endsWith('#pin'))!;
    const reusableWindowVisible = (hash: '#capture' | '#pin') => app.evaluate(({ BrowserWindow }, route) =>
      BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().endsWith(route))?.isVisible() ?? false, hash);
    expect(await page.evaluate(() => typeof (window as unknown as { require?: unknown }).require)).toBe('undefined');
    const denied = await page.evaluate(() => window.snipvia.capture.frame());
    expect(denied.ok).toBe(false);

    await app.evaluate(({ systemPreferences, shell, clipboard }) => {
      systemPreferences.getMediaAccessStatus = () => 'denied';
      shell.openExternal = async (url) => { (globalThis as typeof globalThis & { permissionSettingsUrl?: string }).permissionSettingsUrl = url; };
      shell.showItemInFolder = (path) => { (globalThis as typeof globalThis & { revealedApplication?: string }).revealedApplication = path; };
      clipboard.writeText = async (value) => { (globalThis as typeof globalThis & { copiedApplication?: string }).copiedApplication = value; };
    });
    await page.evaluate(() => window.snipvia.permissions.screen());
    await app.evaluate(({ Menu }) => { const item = Menu.getApplicationMenu()?.items[0].submenu?.items.find(item => item.label === 'AI 截图'); if (!item) throw new Error('AI capture menu missing'); item.click(); });
    await expect(page.getByRole('dialog', { name: '录屏权限设置' })).toBeVisible();
    const permissionCard = page.locator('section[aria-label="录屏权限"]');
    await permissionCard.getByRole('button', { name: '重新检查权限' }).click();
    await expect(permissionCard.locator('.permission-status')).toHaveText('尚未授权');
    await expect(permissionCard).toContainText('再运行 pnpm dev');
    const permission = await page.evaluate(() => window.snipvia.permissions.screen());
    expect(permission.ok && permission.value).toMatchObject({ status: 'denied', applicationName: 'Electron.app', development: true });
    await permissionCard.getByRole('button', { name: '打开录屏设置' }).click();
    expect(await app.evaluate(() => (globalThis as typeof globalThis & { permissionSettingsUrl?: string }).permissionSettingsUrl)).toBe('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
    await permissionCard.getByRole('button', { name: '复制应用路径' }).click();
    const copied = await app.evaluate(() => (globalThis as typeof globalThis & { copiedApplication?: string }).copiedApplication);
    expect(copied).toMatch(/Electron\.app$/);
    await permissionCard.getByRole('button', { name: '在 Finder 中显示' }).click();
    expect(await app.evaluate(() => (globalThis as typeof globalThis & { revealedApplication?: string }).revealedApplication)).toBe(copied);
    await page.getByRole('button', { name: '关闭录屏权限提示' }).click();
    await page.getByRole('button', { name: '关闭错误提示' }).click();
    await page.getByRole('button', { name: '模型与设置' }).click();
    await expect(page.getByRole('checkbox', { name: '开机自启', exact: true })).toBeDisabled();
    await expect(page.getByText('请使用打包后的截然设置开机自启')).toBeVisible();
    await expect(page.locator('.prediction-row strong')).toHaveText(['解释错误', '解释代码', '回答问题', '创建日程草稿']);
    await page.screenshot({ path: 'test-results/settings.png' });
    await assertWindowLayout();
    await page.screenshot({ path: 'docs/ui/settings-layout.png' });
    await page.locator('.prediction-card').screenshot({ path: 'docs/ui/settings-predictions.png' });
    await page.getByRole('button', { name: '查看隐私说明' }).click();
    await expect(page.getByRole('dialog', { name: '截图隐私说明' })).toContainText('你的截图，由你决定');
    await page.getByRole('button', { name: '关闭隐私说明' }).click();
    await page.getByRole('button', { name: '配置…' }).click();
    await expect(page.getByLabel('API 地址')).toHaveValue('https://api.openai.com/v1');
    await expect(page.getByLabel('API 地址')).toHaveAttribute('readonly', '');
    await expect(page.getByRole('combobox', { name: '选择模型' })).toHaveValue('gpt-6.1-sol');
    await page.getByLabel('模型厂商').selectOption('qwen');
    await expect(page.getByRole('combobox', { name: '选择模型' })).toHaveValue('qwen3.8-max');
    await page.getByRole('combobox', { name: '选择模型' }).selectOption('qwen3.8-flash');
    await page.screenshot({ path: 'test-results/model-dialog.png' });
    await page.getByRole('button', { name: '保存并使用' }).click();
    await expect(page.locator('.preference-status[role="status"]')).toHaveText('厂商配置已生效');
    await expect(page.getByLabel('选择厂商')).toContainText('通义千问 · qwen3.8-flash');
    await page.getByRole('button', { name: '设置截图快捷键' }).click();
    await page.getByRole('button', { name: '设置截图快捷键' }).press('Meta+Shift+F9');
    await expect(page.locator('.preference-status[role="status"]')).toHaveText('快捷键已生效');
    await page.getByRole('button', { name: '设置继续对话快捷键' }).click();
    await page.getByRole('button', { name: '设置继续对话快捷键' }).press('Meta+Shift+F10');
    await expect(page.locator('.preference-status[role="status"]')).toHaveText('继续对话快捷键已生效');
    await page.getByLabel('关闭解释代码').click();
    await expect(page.locator('.preference-status[role="status"]')).toHaveText('预测分支已关闭');
    expect(JSON.parse(await readFile(join(directory, 'settings.json'), 'utf8')).settings.predictionBranches.find((branch: { id: string }) => branch.id === 'explain-code').enabled).toBe(false);
    await page.getByRole('button', { name: '编辑解释代码', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '编辑预测分支' })).toBeVisible();
    await page.getByLabel('分支名称').fill('审查代码');
    await page.getByLabel('适用内容').fill('仅 TypeScript 的异步代码，不包括报错截图。');
    await page.getByLabel('执行指令').fill('检查截图中的代码缺陷，并给出修复建议。');
    await page.getByRole('button', { name: '保存修改' }).click();
    await expect(page.locator('.preference-status[role="status"]')).toHaveText('预测分支已更新');
    const editedBranch = JSON.parse(await readFile(join(directory, 'settings.json'), 'utf8')).settings.predictionBranches.find((branch: { id: string }) => branch.id === 'explain-code');
    expect(editedBranch).toMatchObject({ label: '审查代码', applicableContent: '仅 TypeScript 的异步代码，不包括报错截图。', prompt: '检查截图中的代码缺陷，并给出修复建议。', enabled: false, builtin: true, mode: 'ai' });
    await page.getByRole('button', { name: '编辑审查代码', exact: true }).click();
    await expect(page.getByLabel('执行指令')).toHaveValue(editedBranch.prompt);
    await expect(page.getByLabel('适用内容')).toHaveValue(editedBranch.applicableContent);
    await page.getByLabel('适用内容').fill('   ');
    await expect(page.getByRole('button', { name: '保存修改' })).toBeDisabled();
    await page.getByRole('button', { name: '关闭编辑预测分支' }).click();
    await page.getByLabel('开启审查代码').click();
    await expect(page.locator('.preference-status[role="status"]')).toHaveText('预测分支已开启');
    await page.getByRole('button', { name: '编辑创建日程草稿', exact: true }).click();
    await expect(page.getByLabel('执行指令')).toHaveValue('');
    await expect(page.getByRole('button', { name: '保存修改' })).toBeEnabled();
    await page.getByLabel('执行指令').fill('仅提取会议，参会人写入备注。');
    await page.getByRole('button', { name: '保存修改' }).click();
    await expect(page.locator('.preference-status[role="status"]')).toHaveText('预测分支已更新');
    await page.getByRole('button', { name: '新增预测分支' }).click();
    await page.getByLabel('分支名称').fill('生成测试用例');
    await page.getByLabel('适用内容').fill('需要补充测试的代码片段，不包括纯文本需求。');
    await page.getByLabel('执行指令').fill('根据截图中的代码生成必要的单元测试。');
    await page.getByRole('button', { name: '新增分支' }).click();
    await expect(page.getByText('生成测试用例', { exact: true })).toBeVisible();
    expect(JSON.parse(await readFile(join(directory, 'settings.json'), 'utf8')).settings.predictionBranches).toHaveLength(5);
    await page.getByLabel('删除生成测试用例').click();
    await expect(page.getByText('生成测试用例', { exact: true })).toHaveCount(0);
    const preset = JSON.parse(await readFile(join(directory, 'settings.json'), 'utf8')).settings;
    expect(preset.provider).toBe('qwen');
    expect(preset.model).toBe('qwen3.8-flash');
    expect(preset.endpoint).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1');
    expect(preset.shortcut).toBe('CommandOrControl+Shift+F9');
    expect(preset.continueShortcut).toBe('CommandOrControl+Shift+F10');
    expect(preset.scheduleShortcut).toBeUndefined();
    await page.locator('.prediction-card').screenshot({ path: 'test-results/providers.png' });
    await page.getByRole('button', { name: '配置…' }).click();
    await page.getByLabel('模型厂商').selectOption('gemini');
    await expect(page.getByRole('combobox', { name: '选择模型' })).toHaveValue('gemini-3.8-flash');
    await page.getByLabel('模型厂商').selectOption('custom');
    await page.getByLabel('API 地址').fill(`http://127.0.0.1:${address.port}/v1`);
    await page.getByLabel('模型名称').fill('mock-vision');
    await page.getByLabel('API Key').fill('sk-test（不要复制）');
    await page.getByRole('button', { name: '保存并使用' }).click();
    await expect(page.locator('.modal-status')).toContainText('API Key 含有中文符号');
    expect(JSON.parse(await readFile(join(directory, 'settings.json'), 'utf8')).settings.provider).toBe('qwen');
    await page.getByLabel('API Key').fill('');
    await page.getByRole('button', { name: '保存并使用' }).click();
    await expect(page.locator('.preference-status[role="status"]')).toHaveText('厂商配置已生效');
    expect(JSON.parse(await readFile(join(directory, 'settings.json'), 'utf8')).settings.model).toBe('mock-vision');
    await page.getByLabel('选择厂商').selectOption('qwen:https://dashscope.aliyuncs.com/compatible-mode/v1');
    await expect(page.locator('.preference-status[role="status"]')).toContainText('已切换为 通义千问');
    expect(JSON.parse(await readFile(join(directory, 'settings.json'), 'utf8')).settings.provider).toBe('qwen');
    await page.getByLabel('选择厂商').selectOption(`custom:http://127.0.0.1:${address.port}/v1`);
    await expect(page.locator('.preference-status[role="status"]')).toContainText('已切换为 自定义服务');
    expect(JSON.parse(await readFile(join(directory, 'settings.json'), 'utf8')).settings.model).toBe('mock-vision');

    // Stub only the native picker; the renderer -> preload -> main import path stays real.
    const encoded = await app.evaluate(({ nativeImage }) => {
      const image = nativeImage.createFromBuffer(Buffer.alloc(32 * 32 * 4, 255), { width: 32, height: 32 });
      return image.toPNG().toString('base64');
    });
    const fixture = join(directory, 'synthetic.png');
    await writeFile(fixture, Buffer.from(encoded, 'base64'));
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    }, fixture);
    expect((await page.evaluate(() => window.snipvia.capture.import())).ok).toBe(true);
    await page.locator('.ai-workspace .workspace-source-image summary').click();
    await expect(page.getByAltText('对话来源截图')).toBeVisible();
    await expect(page.getByLabel('对话模型')).toHaveValue(chatModelId({ provider: 'custom', endpoint: `http://127.0.0.1:${address.port}/v1`, model: 'mock-vision' }));
    await page.getByLabel('对话模型').selectOption({ label: '通义千问 · qwen3.8-flash' });
    await expect(page.getByLabel('对话模型')).toHaveValue(chatModelId({ provider: 'qwen', endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen3.8-flash' }));
    await page.getByLabel('对话模型').selectOption({ label: '自定义服务 · mock-vision' });
    await page.getByLabel('AI 对话输入').fill('第一行');
    await page.getByLabel('AI 对话输入').press('Shift+Enter');
    await page.getByLabel('AI 对话输入').type('第二行');
    await expect(page.getByLabel('AI 对话输入')).toHaveValue('第一行\n第二行');
    await page.getByLabel('AI 对话输入').fill('解释图片');
    await page.getByLabel('AI 对话输入').press('Enter');
    await expect(page.locator('.workspace-message.assistant h2')).toHaveText('图片摘要');
    await expect(page.locator('.workspace-message.assistant table')).toContainText('测试图');
    await expect(page.locator('.workspace-message.assistant pre code')).toHaveText('const safe = true;');
    await expect(page.getByText('[图片链接已省略：远程图片]')).toBeVisible();
    await expect(page.locator('.workspace-message.assistant script')).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { markdownInjected?: boolean }).markdownInjected)).toBeUndefined();
    await app.evaluate(({ shell }) => {
      (globalThis as typeof globalThis & { openedMarkdownUrl?: string }).openedMarkdownUrl = '';
      shell.openExternal = async (url) => { (globalThis as typeof globalThis & { openedMarkdownUrl?: string }).openedMarkdownUrl = url; };
    });
    await page.getByRole('link', { name: '官方文档' }).click();
    expect(await app.evaluate(() => (globalThis as typeof globalThis & { openedMarkdownUrl?: string }).openedMarkdownUrl)).toBe('https://example.com/docs');
    await expect(page.getByText('危险链接')).not.toHaveAttribute('href');
    expect(JSON.parse(requestBody).messages[1].content[1].image_url.url).toMatch(/^data:image\/jpeg;base64,/);
    await expect(page.locator('.ai-workspace')).toBeVisible();
    await page.screenshot({ path: 'test-results/chat.png' });
    await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '历史对话', exact: true }).click();
    await expect(page.getByRole('heading', { name: '历史对话' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '历史对话' }).locator('b')).toHaveCount(0);
    const savedConversation = page.locator('.history-open').filter({ hasText: '解释图片' });
    await expect(savedConversation).toContainText('自定义服务 · mock-vision');
    await expect(page.locator('.history-content')).toBeVisible();
    await page.screenshot({ path: 'test-results/history.png' });
    expect(JSON.parse(await readFile(join(directory, 'history', 'conversations.json'), 'utf8'))[0].messages).toHaveLength(2);
    await savedConversation.click();
    await expect(page.locator('.history-preview-heading')).toContainText('解释图片');
    await page.getByRole('button', { name: '继续对话', exact: true }).click();
    await expect(page.locator('.workspace-message.assistant h2')).toHaveText('图片摘要');
    await page.getByLabel('AI 对话输入').fill('等待取消');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await page.getByRole('button', { name: '停止生成' }).click();
    await expect(page.locator('.workspace-message.assistant').last()).toContainText('取消');
    await expect(page.getByLabel('AI 对话输入')).toHaveValue('');
    expect(errors).toEqual([]);
    await page.screenshot({ path: 'test-results/desktop.png' });

    // Exercise the actual overlay lifecycle using a synthetic screen, without recording the desktop.
    await app.evaluate(({ desktopCapturer, nativeImage, screen, systemPreferences }) => {
      systemPreferences.getMediaAccessStatus = () => 'granted';
      desktopCapturer.getSources = async (options) => {
        const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
        const size = options.thumbnailSize!;
        const image = nativeImage.createFromBuffer(Buffer.alloc(size.width * size.height * 4, 255), size);
        return [{ id: 'screen:mock', name: 'Synthetic screen', display_id: String(display.id), appIcon: nativeImage.createEmpty(), thumbnail: image }];
      };
    });
    const grantedPermission = await page.evaluate(() => window.snipvia.permissions.screen());
    expect(grantedPermission.ok && grantedPermission.value.status).toBe('granted');
    expect((await page.evaluate(() => window.snipvia.capture.start())).ok).toBe(true);
    await expect(page.getByRole('dialog', { name: '录屏权限设置' })).toHaveCount(0);
    await expect(overlay.locator('.screen-frame')).toBeVisible();
    const firstSession = await overlay.evaluate(() => window.snipvia.capture.frame());
    const consecutiveCapture = await page.evaluate(() => window.snipvia.capture.start());
    expect(consecutiveCapture.ok).toBe(true);
    await expect(overlay.locator('.screen-frame')).toBeVisible();
    const secondSession = await overlay.evaluate(() => window.snipvia.capture.frame());
    expect(firstSession.ok && secondSession.ok && firstSession.value.performanceSessionId).not.toBe(secondSession.ok ? secondSession.value.performanceSessionId : '');
    expect(app.windows().filter((window) => window.url().endsWith('#capture'))).toHaveLength(1);
    await overlay.keyboard.press('Escape');
    await expect.poll(() => reusableWindowVisible('#capture')).toBe(false);
    await page.keyboard.up('Escape');
    expect((await page.evaluate(() => window.snipvia.capture.start())).ok).toBe(true);
    await expect(overlay.locator('.screen-frame')).toBeVisible();
    await overlay.mouse.move(100, 100);
    await overlay.mouse.down();
    await overlay.mouse.move(250, 200);
    await overlay.mouse.up();
    await expect.poll(() => reusableWindowVisible('#capture')).toBe(false);
    await expect(pinned.locator('.pinned-capture')).toBeVisible();
    await expect(pinned.getByAltText('置顶截图')).toBeVisible();
    const initialPerformanceReport = await pinned.evaluate(async () => {
      const state = await window.snipvia.pin.current();
      if (!state.ok) throw new Error(state.error);
      const report = await window.snipvia.performance.report(state.value.performanceSessionId);
      if (!report.ok || !report.value) throw new Error(report.ok ? 'missing performance report' : report.error);
      return report.value;
    });
    expect(initialPerformanceReport.metrics.selectionToScreenshotVisibleMs).toBeGreaterThan(0);
    expect(initialPerformanceReport.metrics.captureStartToOverlayVisibleMs).toBeGreaterThan(0);
    expect(initialPerformanceReport.marks.map((mark) => mark.event)).toEqual(expect.arrayContaining([
      'frame_capture_start', 'capture_overlay_visible', 'selection_end', 'jpeg_encode_start',
      'jpeg_disk_write_start', 'capture_overlay_reuse_visible', 'screenshot_window_reuse_visible', 'screenshot_to_all_visible'
    ]));
    await expect(pinned.getByRole('button', { name: '记入日程' })).toHaveCount(0);
    await expect(pinned.locator('.pinned-actions')).toHaveCount(0);
    await expect(pinned.getByRole('button')).toHaveCount(0);
    const copySize = await pinned.evaluate(async () => {
      const result = await window.snipvia.pin.current();
      if (!result.ok) throw new Error(result.error);
      return { width: result.value.capture.width, height: result.value.capture.height };
    });
    await expect.poll(() => app.windows().some((window) => window.url().endsWith('#quick-chat'))).toBe(true);
    const copyChat = app.windows().find((window) => window.url().endsWith('#quick-chat'))!;
    await expect(copyChat.getByLabel('悬浮对话问题')).toBeFocused();
    await copyChat.getByLabel('悬浮对话问题').press('Control+C').catch((error: unknown) => { if (!copyChat.isClosed()) throw error; });
    await expect.poll(() => copyChat.isClosed()).toBe(true);
    await expect.poll(() => reusableWindowVisible('#pin')).toBe(false);
    // Native clipboards can expose a JPEG write as PNG; verify the actual decoded crop.
    expect(await app.evaluate(async ({ clipboard, nativeImage }) => {
      for (const item of await clipboard.read()) {
        const type = item.types.find((value) => value.startsWith('image/'));
        if (!type) continue;
        const blob = await item.getType(type);
        if (!(blob instanceof Blob)) continue;
        const image = nativeImage.createFromBuffer(Buffer.from(await blob.arrayBuffer()));
        if (!image.isEmpty()) return image.getSize();
      }
      return null;
    })).toEqual(copySize);
    const copyFollowup = await page.evaluate(() => window.snipvia.capture.start());
    expect(copyFollowup.ok).toBe(true);
    await expect(overlay.locator('.screen-frame')).toBeVisible();
    await overlay.mouse.move(100, 100);
    await overlay.mouse.down();
    await overlay.mouse.move(250, 200);
    await overlay.mouse.up();
    await expect.poll(() => reusableWindowVisible('#pin')).toBe(true);
    const cropped = await page.evaluate(() => window.snipvia.capture.current());
    expect(cropped.ok && cropped.value && cropped.value.width).toBeGreaterThanOrEqual(150);
    const mainHandle = await app.browserWindow(page);
    expect(await mainHandle.evaluate((window) => window.isVisible())).toBe(false);
    await expect.poll(() => app.windows().some((window) => window.url().endsWith('#quick-chat'))).toBe(true);
    const quickChat = app.windows().find((window) => window.url().endsWith('#quick-chat'))!;
    await expect(quickChat.locator('.quick-chat')).toBeVisible();
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().includes('#quick-chat'))?.isResizable())).toBe(true);
    await expect(quickChat.getByLabel('截图操作')).toHaveCount(0);
    await expect(quickChat.getByText('按 Enter，开始智能分析')).toBeVisible();
    await expect(quickChat.getByLabel('预测分支')).toHaveCount(0);
    await expect(quickChat.getByLabel('悬浮对话模型')).toHaveValue(`custom:http://127.0.0.1:${address.port}/v1`);
    await expect(quickChat.getByRole('button', { name: '停止执行', exact: true })).toHaveCount(0);
    // QuickChat now always presents Agent. Keep coverage of the ordinary stream bridge
    // and its performance events, which are also consumed by this renderer.
    const ordinaryStream = await quickChat.evaluate(async () => {
      const state = await window.snipvia.chat.state(); if (!state.ok) throw new Error(state.error);
      return window.snipvia.chat.stream({ captureId: state.value.capture.id, question: '悬浮解释', performanceSessionId: state.value.performanceSessionId });
    });
    expect(ordinaryStream.ok).toBe(true);
    await expect(quickChat.locator('.quick-message.assistant h2').last()).toHaveText('图片摘要');
    const readCompletedPerformanceReport = () => quickChat.evaluate(async () => {
      const state = await window.snipvia.chat.state();
      if (!state.ok || !state.value.performanceSessionId) throw new Error(state.ok ? 'missing performance session' : state.error);
      const report = await window.snipvia.performance.report(state.value.performanceSessionId);
      if (!report.ok || !report.value) throw new Error(report.ok ? 'missing performance report' : report.error);
      return report.value;
    });
    await expect.poll(async () => (await readCompletedPerformanceReport()).marks.map((mark) => mark.event)).toEqual(expect.arrayContaining([
      'chat_send_main_received', 'fetch_headers_received',
      'ai_response_complete', 'assistant_message_save_end', 'chat_response_visible'
    ]));
    expect((await readCompletedPerformanceReport()).metrics.aiRequestToCompleteMs).toBeGreaterThan(0);
    await expect(pinned.getByRole('button')).toHaveCount(0);
    await expect(quickChat.getByLabel('返回软件', { exact: true })).toBeVisible();
    const initialChatBounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().includes('#quick-chat'))?.getBounds());
    await app.evaluate(({ BrowserWindow, screen }) => {
      const window = BrowserWindow.getAllWindows().find((item) => item.webContents.getURL().includes('#pin'));
      if (!window) throw new Error('pin window missing');
      const bounds = window.getBounds();
      const workArea = screen.getDisplayMatching(bounds).workArea;
      window.setPosition(Math.min(bounds.x + 30, workArea.x + workArea.width - bounds.width), Math.min(bounds.y + 20, workArea.y + workArea.height - bounds.height));
    });
    await expect.poll(async () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().includes('#quick-chat'))?.getBounds())).not.toEqual(initialChatBounds);
    await app.windows().find(window => window.url().endsWith('#quick-chat') && !window.isClosed())!.getByLabel('返回软件', { exact: true }).click();
    await expect.poll(() => reusableWindowVisible('#pin')).toBe(false);
    await expect.poll(() => quickChat.isClosed()).toBe(true);
    await expect(page.locator('.workspace-message.assistant h2').last()).toHaveText('图片摘要');
    await expect(page.getByLabel('AI 对话输入')).toBeFocused();

    // Prediction automatically routes schedule captures; no manual branch selector remains.
    const mainNavigation = page.getByRole('navigation', { name: '主导航' });
    const scheduleNavigation = mainNavigation.getByRole('button', { name: /截图日程/ });
    await scheduleNavigation.click();
    await expect(page.locator('.schedule-panel .workspace-shortcut-label')).toContainText('⌘ ⇧ F9');
    await mainNavigation.getByRole('button', { name: 'AI 笔记' }).click();
    predictSchedule = true;
    const scheduleStart = await page.evaluate(() => window.snipvia.capture.start());
    expect(scheduleStart.ok).toBe(true);
    await expect(overlay.locator('.capture-hint')).toContainText('拖动选择截图区域');
    expect(await app.evaluate(({ app }) => process.platform !== 'darwin' || Boolean(app.dock?.isVisible()))).toBe(true);
    await overlay.mouse.move(120, 120);
    await overlay.mouse.down();
    await overlay.mouse.move(320, 240);
    await overlay.mouse.up();
    await expect.poll(() => reusableWindowVisible('#capture')).toBe(false);
    await expect(pinned.locator('.pinned-capture')).toBeVisible();
    await expect.poll(() => app.windows().some((window) => window.url().endsWith('#quick-chat') && !window.isClosed())).toBe(true);
    const scheduleChat = app.windows().find((window) => window.url().endsWith('#quick-chat') && !window.isClosed())!;
    await expect(scheduleChat.getByText('按 Enter，开始智能分析')).toBeVisible();
    // Enter also works when the user has focused/moved the pinned screenshot.
    await pinned.locator('.pinned-image-area').click({ position: { x: 20, y: 20 } });
    await pinned.keyboard.press('Enter');
    await expect(scheduleChat.getByLabel('预测分支')).toHaveText('创建日程草稿');
    await expect.poll(async () => {
      const jobs = JSON.parse(await readFile(join(directory, 'schedule', 'jobs.json'), 'utf8'));
      return jobs[0]?.status;
    }).toBe('draft');
    predictSchedule = false;
    await pinned.evaluate(() => window.snipvia.pin.close());
    await expect.poll(() => reusableWindowVisible('#pin')).toBe(false);
    expect(await app.evaluate(({ app }) => process.platform !== 'darwin' || Boolean(app.dock?.isVisible()))).toBe(true);
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((window) => window.isVisible()))).toBe(false);
    await app.evaluate(({ app }) => { app.emit('activate'); });
    await expect(scheduleNavigation.locator('b')).toHaveText('1');
    await expect(scheduleNavigation.locator('b')).toHaveAttribute('aria-label', '1 条未查看日程');
    await scheduleNavigation.click();
    await expect(scheduleNavigation.locator('b')).toHaveCount(0);
    await expect(page.locator('.schedule-day.has-events')).not.toHaveCount(0);
    await page.getByRole('button', { name: /识别记录/ }).click();
    await expect(page.getByRole('dialog', { name: '识别记录' })).toBeVisible();
    await page.locator('.records-list button').first().click();
    await expect(page.getByAltText('日程来源截图')).toBeVisible();
    await page.screenshot({ path: 'test-results/schedule-records.png' });
    await page.getByRole('button', { name: '关闭识别记录' }).click();
    await page.locator('.schedule-day[data-date="2026-09-18"]').click();
    await page.locator('.schedule-detail-event').filter({ hasText: '产品评审' }).click();
    await expect(page.getByLabel('日程标题')).toHaveValue('产品评审');
    await expect(page.getByLabel('地点')).toHaveValue('3A 会议室');
    await expect(page.getByText(/结束时间由上下文推断/)).toBeVisible();
    await expect(page.getByRole('button', { name: '选择 Mac 日历…' })).toBeVisible();
    await page.getByRole('button', { name: '提醒事项' }).click();
    await expect(page.getByRole('button', { name: '选择提醒事项列表…' })).toBeVisible();
    await page.getByRole('button', { name: '日历' }).click();
    await page.getByRole('button', { name: '保存到截然' }).click();
    await expect(page.getByRole('status')).toHaveText('已保存到截然日程');
    expect(JSON.parse(await readFile(join(directory, 'schedule', 'jobs.json'), 'utf8'))[0].events[0].savedLocal).toBe(true);
    await page.getByLabel('记录类型').selectOption('deadline');
    await expect(page.getByLabel('截止时间')).toHaveValue('2026-09-18T15:00');
    await page.getByLabel('只精确到日期').check();
    await page.getByLabel('截止日期').fill('2026-09-30');
    await page.getByLabel('日程标题').fill('完成产品评审方案');
    await page.getByRole('button', { name: '保存到截然' }).click();
    await expect(page.getByRole('status')).toHaveText('已保存到截然日程');
    const savedDeadline = JSON.parse(await readFile(join(directory, 'schedule', 'jobs.json'), 'utf8'))[0].events[0];
    expect(savedDeadline).toMatchObject({ kind: 'deadline', dueAt: null, dueDate: '2026-09-30', startAt: null, endAt: null });
    await page.getByRole('button', { name: '关闭日程编辑' }).click();
    await expect(page.locator('.schedule-calendar-week')).toHaveCount(5);
    await page.locator('.schedule-day[data-date="2026-09-30"]').click();
    await page.locator('.schedule-detail-event').filter({ hasText: '完成产品评审方案' }).click();
    await expect(page.getByRole('dialog', { name: '编辑日程：完成产品评审方案' })).toBeVisible();
    await page.screenshot({ path: 'test-results/schedule-editor.png' });
    await page.getByRole('button', { name: '关闭日程编辑' }).click();
    await page.locator('.schedule-day[data-date="2026-09-04"]').click();
    await expect(page.locator('.schedule-detail-event')).toContainText('上海出差');
    await page.locator('.schedule-day[data-date="2026-09-09"]').click();
    await expect(page.locator('.schedule-detail-event')).toContainText('上海出差');
    await page.screenshot({ path: 'test-results/schedule-calendar.png' });
    await page.screenshot({ path: 'test-results/schedule.png' });
    await app.evaluate(({ Menu }) => {
      const item = Menu.getApplicationMenu()?.items[0]?.submenu?.items.find((entry) => entry.label === '续拍并继续对话');
      item?.click?.(item, undefined, { triggeredByAccelerator: false });
    });
    await expect(overlay.locator('.screen-frame')).toBeVisible();
    await overlay.mouse.move(160, 150);
    await overlay.mouse.down();
    await overlay.mouse.move(380, 290);
    await overlay.mouse.up();
    await expect.poll(() => reusableWindowVisible('#pin')).toBe(true);
    await expect.poll(() => app.windows().some((window) => window.url().endsWith('#quick-chat') && !window.isClosed())).toBe(true);
    const continuedChat = app.windows().find((window) => window.url().endsWith('#quick-chat') && !window.isClosed())!;
    await expect(continuedChat.getByText('新截图已接入上次对话 · 直接继续提问')).toBeVisible();
    await expect(continuedChat.getByLabel('预测分支')).toHaveCount(0);
    await expect(continuedChat.getByLabel('截图操作')).toHaveCount(0);
    const continuedState = await continuedChat.evaluate(() => window.snipvia.chat.state());
    expect(continuedState.ok && continuedState.value.capture.continuesConversation).toBe(true);
    expect(continuedState.ok && continuedState.value.messages.length).toBeGreaterThan(0);
    expect(continuedState.ok && continuedState.value.autoAction).toMatchObject({ state: 'idle', actionId: 'ask-ai' });
    const continuedReport = await continuedChat.evaluate(async () => {
      const state = await window.snipvia.chat.state();
      if (!state.ok || !state.value.performanceSessionId) throw new Error(state.ok ? 'missing performance session' : state.error);
      return window.snipvia.performance.report(state.value.performanceSessionId);
    });
    expect(continuedReport.ok && continuedReport.value?.marks.some((mark) => mark.event === 'auto_analysis_start')).toBe(false);
    await app.windows().find(window => window.url().endsWith('#quick-chat') && !window.isClosed())!.getByLabel('返回软件', { exact: true }).click();
    await expect.poll(() => reusableWindowVisible('#pin')).toBe(false);
    await page.getByRole('button', { name: '模型与设置' }).click();
    await page.getByRole('button', { name: '配置…' }).click();
    await page.getByLabel('API Key').fill('synthetic-key');
    await page.getByRole('button', { name: '保存并使用' }).click();
    const settingsFile = await readFile(join(directory, 'settings.json'), 'utf8');
    expect(settingsFile).not.toContain('synthetic-key');
    expect(Object.values(JSON.parse(settingsFile).encryptedKeys)).toHaveLength(1);
    await page.getByRole('button', { name: /截图日程/ }).click();
    await app.evaluate(({ Menu }) => {
      const item = Menu.getApplicationMenu()?.items[0]?.submenu?.items.find((entry) => entry.label === 'AI 截图');
      item?.click?.(item, undefined, { triggeredByAccelerator: false });
    });
    await expect(overlay.locator('.screen-frame')).toBeVisible();
    await overlay.mouse.move(140, 140);
    await overlay.mouse.down();
    await overlay.mouse.move(340, 260);
    await overlay.mouse.up();
    const supersedingCapture = await page.evaluate(() => window.snipvia.capture.start());
    expect(supersedingCapture.ok).toBe(true);
    await expect.poll(() => reusableWindowVisible('#pin')).toBe(false);
    await expect.poll(() => reusableWindowVisible('#capture')).toBe(true);
    await overlay.keyboard.press('Escape');
    await expect.poll(() => reusableWindowVisible('#capture')).toBe(false);
    await app.evaluate(({ app }) => { app.emit('activate'); });
    await page.getByRole('button', { name: '模型与设置' }).click();
    await page.getByRole('button', { name: '配置…' }).click();
    await page.getByLabel('删除当前服务的密钥').check();
    await page.getByRole('button', { name: '保存并使用' }).click();
    await page.getByRole('button', { name: /历史对话/ }).click();
    // Screenshot and continuation cases above can also create empty conversations.
    const historyCount = JSON.parse(await readFile(join(directory, 'history', 'conversations.json'), 'utf8')).length;
    expect(historyCount).toBeGreaterThanOrEqual(2);
    await expect(page.locator('.history-item')).toHaveCount(historyCount);
    await page.locator('.history-item').first().locator('.history-delete').click();
    await expect(page.getByRole('dialog', { name: '删除历史对话', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '删除对话', exact: true }).click();
    await expect(page.locator('.history-item')).toHaveCount(historyCount - 1);
    expect(JSON.parse(await readFile(join(directory, 'history', 'conversations.json'), 'utf8'))).toHaveLength(historyCount - 1);
    await page.getByRole('button', { name: '清空全部' }).click();
    await page.getByRole('button', { name: '清空全部历史', exact: true }).click();
    await expect(page.getByText('还没有历史对话')).toBeVisible();
    expect(JSON.parse(await readFile(join(directory, 'history', 'conversations.json'), 'utf8'))).toEqual([]);
  } finally {
    await app.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
