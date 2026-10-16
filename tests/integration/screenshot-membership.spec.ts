import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createDesktopAccount } from '../helpers/desktop-account';

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'snipvia-screenshot-access-'));
  const account = await createDesktopAccount();
  const app = await electron.launch({ args: ['.', `--user-data-dir=${directory}`], env: { ...process.env,
    SNIPVIA_CONSOLE_ORIGIN: account.origin, SNIPVIA_CAPTURE_BACKEND: 'electron', SNIPVIA_CAPTURE_WARMUP: '0' } });
  const page = await app.firstWindow();
  await expect(page.getByRole('navigation', { name: '主导航' }).getByRole('button')).toHaveText(['AI 对话', 'AI 笔记', '截图日程', '历史对话']);
  await expect(page.getByRole('button', { name: 'AI 笔记', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect.poll(() => app.windows().some(window => window.url().endsWith('#pin'))).toBe(true);
  const overlay = app.windows().find(window => window.url().endsWith('#capture'))!;
  const pinned = app.windows().find(window => window.url().endsWith('#pin'))!;
  await app.evaluate(({ desktopCapturer, nativeImage, screen, systemPreferences }) => {
    systemPreferences.getMediaAccessStatus = () => 'granted';
    desktopCapturer.getSources = async options => {
      const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()), size = options.thumbnailSize!;
      return [{ id: 'screen:synthetic', name: 'Synthetic screen', display_id: String(display.id), appIcon: nativeImage.createEmpty(),
        thumbnail: nativeImage.createFromBuffer(Buffer.alloc(size.width * size.height * 4, 255), size) }];
    };
  });
  const visible = (hash: string) => app.evaluate(({ BrowserWindow }, route) => BrowserWindow.getAllWindows().some(window => window.webContents.getURL().endsWith(route) && window.isVisible()), hash);
  const start = async () => {
    const result = await page.evaluate(() => window.snipvia.capture.start()); expect(result.ok).toBe(true);
    await expect(overlay.locator('.screen-frame')).toBeVisible();
    await overlay.mouse.move(100, 100); await overlay.mouse.down(); await overlay.mouse.move(400, 300); await overlay.mouse.up();
  };
  return { app, page, overlay, pinned, account, visible, start,
    async close() { await app.close(); await account.close(); await rm(directory, { recursive: true, force: true }); } };
}

test('anonymous AI capture becomes basic capture, with no conversation or model work', async () => {
  const f = await fixture();
  try {
    await f.start();
    await expect(f.overlay.getByRole('status')).toContainText('联系管理员');
    await expect(f.overlay.getByRole('toolbar', { name: '截图标注工具栏' })).toBeVisible();
    await f.overlay.screenshot({ path: 'test-results/non-member-basic-capture.png' });
    expect(await f.visible('#quick-chat')).toBe(false);
    expect((await f.page.evaluate(() => window.snipvia.capture.import())).ok).toBe(false);
    await f.overlay.getByRole('button', { name: '定住截图', exact: true }).click();
    await expect(f.pinned.getByAltText('置顶截图')).toBeVisible();
    await expect(f.pinned.getByRole('button')).toHaveCount(0);
    const denied = await f.pinned.evaluate(() => window.snipvia.pin.startChat());
    expect(!denied.ok && denied.error).toContain('联系管理员');
    const history = await f.page.evaluate(() => window.snipvia.history.list());
    expect(history.ok && history.value).toEqual([]);
    expect(await f.visible('#quick-chat')).toBe(false);
    await f.pinned.evaluate(() => window.snipvia.pin.close());
    expect((await f.page.evaluate(() => window.snipvia.capture.start('standard'))).ok).toBe(true);
    await expect(f.overlay.getByRole('status')).toHaveCount(0);
    await f.overlay.mouse.move(100, 100); await f.overlay.mouse.down(); await f.overlay.mouse.move(200, 180); await f.overlay.mouse.up();
    await f.overlay.getByRole('button', { name: '复制并关闭', exact: true }).click();
    await expect.poll(() => f.visible('#capture')).toBe(false);
  } finally { await f.close(); }
});

test('members get a visible focused chat even without a post-paint acknowledgement; revocation blocks sending', async () => {
  const f = await fixture();
  try {
    const id = await f.account.signIn(f.page, false);
    const grant = f.account.store.issue(id, { source: 'gift', permanent: true, activation: 'now', reason: '会员显示测试', idempotencyKey: randomUUID() }, f.account.actor);
    await f.page.evaluate(() => window.snipvia.account.get());
    // Simulate the missing animation-frame acknowledgement that formerly kept
    // presentAiCapture waiting forever after the pin had already been shown.
    await f.pinned.evaluate(() => { window.requestAnimationFrame = () => 0; });
    await f.start();
    await expect.poll(() => f.visible('#quick-chat')).toBe(true);
    const quick = f.app.windows().find(window => window.url().endsWith('#quick-chat'))!;
    await expect(quick.getByText('按 Enter，开始智能分析')).toBeVisible();
    await expect(quick.getByLabel('悬浮对话问题')).toBeFocused();
    await quick.screenshot({ path: 'test-results/member-screenshot-chat.png' });
    f.account.store.changeGrant(grant.id, { action: 'revoke', reason: '验证撤销即时生效' }, f.account.actor);
    await quick.getByLabel('悬浮对话问题').fill('解释二分查找的边界条件');
    await quick.getByLabel('悬浮对话问题').press('Enter');
    await expect(quick.getByRole('alert')).toContainText('联系管理员');
    const state = await quick.evaluate(async () => {
      const current = await window.snipvia.chat.state(); if (!current.ok) throw new Error(current.error);
      return window.snipvia.agent.state(current.value.capture.id);
    });
    expect(state.ok && state.value.runs).toEqual([]);
    await f.pinned.evaluate(() => window.snipvia.pin.close());
    await f.start();
    await expect(f.overlay.getByRole('toolbar', { name: '截图标注工具栏' })).toBeVisible();
    await expect(f.overlay.getByRole('status')).toContainText('联系管理员');
  } finally { await f.close(); }
});

test('a logged-in account without a grant cannot bypass the AI action from the editor', async () => {
  const f = await fixture();
  try {
    await f.account.signIn(f.page, false);
    await f.start();
    await f.overlay.getByRole('button', { name: '问 AI', exact: true }).click();
    await expect(f.overlay.getByRole('alert')).toContainText('联系管理员');
    await expect(f.overlay.getByRole('toolbar', { name: '截图标注工具栏' })).toBeVisible();
    const history = await f.page.evaluate(() => window.snipvia.history.list()); expect(history.ok && history.value).toEqual([]);
    expect(await f.visible('#quick-chat')).toBe(false);
  } finally { await f.close(); }
});
