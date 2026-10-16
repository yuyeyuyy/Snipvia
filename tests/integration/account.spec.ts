import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { mkdtemp, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createAccountFixture } from '../helpers/account-fixture';

test('desktop email registration, private session restoration, grants and revocation', async () => {
  test.skip(process.platform !== 'darwin' && process.platform !== 'win32', '加密恢复需要系统凭据存储；内存降级由单元测试覆盖');
  const directory = await mkdtemp(join(tmpdir(), 'snipvia-account-smoke-'));
  const clientDirectory = join(directory, 'client');
  const server = createAccountFixture();
  const apiOrigin = await server.app.listen({ port: 0, host: '127.0.0.1' });
  let app: ElectronApplication | null = null;
  const launch = async () => {
    const instance = await electron.launch({ args: ['.', `--user-data-dir=${clientDirectory}`], env: {
      ...process.env, SNIPVIA_CONSOLE_ORIGIN: apiOrigin, SNIPVIA_CAPTURE_BACKEND: 'electron', SNIPVIA_CAPTURE_WARMUP: '0'
    } });
    return instance;
  };
  try {
    app = await launch();
    let page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await expect(page.locator('.titlebar-actions').getByRole('button', { name: '账号与登录' })).toHaveText('登录');
    await page.getByRole('button', { name: '账号与登录' }).click();
    await expect(page.getByText('账号服务已连接', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: '登录 / 注册' })).toBeVisible();
    const screenshotDirectory = join(process.cwd(), 'docs/ui');
    await mkdir(screenshotDirectory, { recursive: true });
    await page.screenshot({ path: join(screenshotDirectory, 'desktop-account-login.png'), animations: 'disabled' });

    await page.getByLabel('邮箱地址').fill('desktop@example.test');
    await page.getByRole('button', { name: '获取验证码' }).click();
    await expect(page.getByText('本机开发验证码：', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: /秒后重发/ })).toBeDisabled();
    const code = await page.locator('.account-development code').textContent();
    await page.getByLabel('邮箱验证码').fill(code!);
    await page.getByRole('button', { name: '登录 / 注册', exact: true }).click();
    await expect(page.getByTestId('account-email')).toHaveText('desktop@example.test');
    await expect(page.locator('.titlebar-actions').getByRole('button', { name: '账号与登录' })).toHaveText('');
    await expect(page.locator('.titlebar-actions').getByRole('button', { name: '账号与登录' }).locator('svg')).toHaveCount(1);
    await expect(page.locator('.app-titlebar')).not.toContainText('desktop@example.test');
    await expect(page.getByText('登录凭据已加密保存，下次启动会自动恢复')).toBeVisible();
    const publicState = await page.evaluate(() => window.snipvia.account.get());
    expect(JSON.stringify(publicState)).not.toMatch(/session_token|"token"|"cookie"/);
    const disk = await readFile(join(clientDirectory, 'account/session.json'), 'utf8');
    expect(disk).not.toMatch(/session_token|desktop@example\.test/);
    await expect.poll(() => app!.windows().some(window => window.url().endsWith('#capture'))).toBe(true);
    const overlay = app.windows().find(window => window.url().endsWith('#capture'))!;
    expect((await overlay.evaluate(() => window.snipvia.account.get())).ok).toBe(false);

    const user = server.store.byEmail('desktop@example.test')!;
    const actor = { id: 'bootstrap', email: 'test-bootstrap' };
    server.store.issue(user.id, { source: 'gift', permanent: true, activation: 'first-login', reason: '桌面联调', idempotencyKey: randomUUID() }, actor);
    await page.getByRole('button', { name: '重新检查' }).click();
    await expect(page.getByText('永久资格', { exact: true })).toBeVisible();
    await page.screenshot({ path: join(screenshotDirectory, 'desktop-account-profile.png'), animations: 'disabled' });
    await page.getByRole('button', { name: '收起菜单栏' }).click();
    await app.close(); app = null;

    app = await launch(); page = await app.firstWindow();
    await expect(page.getByRole('button', { name: '展开菜单栏' })).toHaveAttribute('aria-expanded', 'false');
    await expect.poll(() => page.locator('.sidebar').evaluate((element) => element.getBoundingClientRect().width)).toBe(52);
    await page.getByRole('button', { name: '账号与登录' }).click();
    await page.getByRole('button', { name: '重新检查' }).click();
    await expect(page.getByTestId('account-email')).toHaveText('desktop@example.test');
    await expect(page.locator('.titlebar-actions').getByRole('button', { name: '账号与登录' })).toHaveText('');
    server.store.updateUser(user.id, { status: 'disabled', reason: '停用联调账号' }, actor);
    await page.getByRole('button', { name: '重新检查' }).click();
    await expect(page.getByRole('heading', { name: '登录 / 注册' })).toBeVisible();
    await expect(page.getByText('登录已失效，请重新登录', { exact: true })).toBeVisible();
    await expect(page.locator('.titlebar-actions').getByRole('button', { name: '账号与登录' })).toHaveText('登录');
    await expect(readFile(join(clientDirectory, 'account/session.json'))).rejects.toMatchObject({ code: 'ENOENT' });

    server.store.updateUser(user.id, { status: 'active', reason: '恢复联调账号' }, actor);
    // A fresh instance resets the client-only cooldown; server limits remain unchanged.
    const otherEmail = 'logout@example.test';
    await page.getByLabel('邮箱地址').fill(otherEmail);
    await page.getByRole('button', { name: '获取验证码' }).click();
    await expect(page.locator('.account-development code')).toHaveText(/\d{6}/);
    await page.getByLabel('邮箱验证码').fill((await page.locator('.account-development code').textContent())!);
    await page.getByRole('button', { name: '登录 / 注册', exact: true }).click();
    await expect(page.getByTestId('account-email')).toHaveText(otherEmail);
    await page.getByRole('button', { name: '退出登录' }).click();
    await expect(page.getByRole('heading', { name: '登录 / 注册' })).toBeVisible();
    await expect(page.locator('.titlebar-actions').getByRole('button', { name: '账号与登录' })).toHaveText('登录');
    await expect(readFile(join(clientDirectory, 'account/session.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(({ total: server.store.sessionCount() })).toEqual({ total: 0 });
    expect(errors).toEqual([]);
  } finally {
    await app?.close(); await server.app.close(); await rm(directory, { recursive: true, force: true });
  }
});
