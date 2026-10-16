import { mkdtempSync, readFileSync, rmSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccountSessionStore, type AccountEncryption } from '../../src/main/storage/account';
import { AccountService, accountOrigin, resolveAccountOrigin } from '../../src/main/account/AccountService';
import { accountCodeRequestSchema, accountSignInSchema } from '../../src/shared/account';
import { createAccountFixture } from '../helpers/account-fixture';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
const origin = 'http://localhost:3100';
const cookie = 'better-auth.session_token=private-session-token.signature';
it('首次启动没有会话时不触发系统密钥库；已有会话仍校验加密可用性', () => {
  const directory = mkdtempSync(join(tmpdir(), 'snipvia-account-keychain-')); cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'session.json'), available = vi.fn(() => false);
  const store = new AccountSessionStore(file, { available, encrypt: () => Buffer.alloc(0), decrypt: () => '' });
  expect(store.load(origin, Date.now())).toBeNull(); expect(available).not.toHaveBeenCalled();
  writeFileSync(file, JSON.stringify({ version: 1, encryptedSession: 'fake' }));
  expect(store.load(origin, Date.now())).toBeNull(); expect(available).toHaveBeenCalledTimes(1);
});
function storage() {
  const directory = mkdtempSync(join(tmpdir(), 'snipvia-account-'));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'session.json');
  const key = randomBytes(32);
  let available = true;
  const encryption: AccountEncryption = {
    available: () => available,
    encrypt: (value) => {
      const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
      return Buffer.concat([iv, cipher.update(value), cipher.final(), cipher.getAuthTag()]);
    },
    decrypt: (value) => {
      const decipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12));
      decipher.setAuthTag(value.subarray(-16));
      return Buffer.concat([decipher.update(value.subarray(12, -16)), decipher.final()]).toString();
    }
  };
  return { directory, file, store: new AccountSessionStore(file, encryption), disable: () => { available = false; } };
}
async function fixture() {
  const s = storage();
  const server = createAccountFixture();
  cleanups.unshift(() => server.app.close());
  const requests: { path: string; cookie: string | null; origin: string | null }[] = [];
  let offline = false;
  let beforeRequest: ((path: string) => Promise<void>) | undefined;
  const fetcher: typeof fetch = async (input, init) => {
    if (offline) throw new Error('network offline');
    const url = new URL(String(input)), headers = new Headers(init?.headers);
    await beforeRequest?.(url.pathname);
    requests.push({ path: url.pathname, cookie: headers.get('cookie'), origin: headers.get('origin') });
    const response = await server.app.inject({
      method: init?.method === 'POST' ? 'POST' : 'GET', url: `${url.pathname}${url.search}`,
      headers: Object.fromEntries(headers), payload: init?.body as string | undefined
    });
    const responseHeaders = new Headers();
    for (const [name, value] of Object.entries(response.headers)) {
      if (Array.isArray(value)) value.forEach(item => responseHeaders.append(name, item));
      else if (value !== undefined) responseHeaders.set(name, String(value));
    }
    return new Response(response.body, { status: response.statusCode, headers: responseHeaders });
  };
  const events: unknown[] = [];
  const service = () => new AccountService({ origin, packaged: false, store: s.store, fetch: fetcher, onChanged: value => events.push(value) });
  const account = service();
  async function login(email = 'client@example.test') {
    const sent = await account.sendCode({ email });
    expect(sent.developmentCode).toMatch(/^\d{6}$/);
    return account.signIn({ email, otp: sent.developmentCode! });
  }
  return { ...s, ...server, credentialStore: s.store, account, service, login, requests, events, offline: () => { offline = true; }, online: () => { offline = false; }, beforeRequest: (callback: (path: string) => Promise<void>) => { beforeRequest = callback; } };
}

describe('桌面账号凭据与边界', () => {
  it('框选入口只读本地资格提示，不等待账号队列；AI 仍拒绝已撤销的云端资格', async () => {
    const f = await fixture();
    expect(f.account.screenshotCaptureNotice()).toContain('联系管理员');
    expect(f.requests).toHaveLength(0);
    await f.login();
    const actor = { id: 'test-bootstrap', email: 'bootstrap@example.test' };
    const grant = f.store.issue(f.store.byEmail('client@example.test')!.id, {
      source: 'gift', permanent: true, activation: 'now', reason: '截图本地入口测试', idempotencyKey: randomUUID()
    }, actor);
    await f.account.get();
    let arrived!: () => void, release!: () => void;
    const entered = new Promise<void>(resolve => { arrived = resolve; });
    const waiting = new Promise<void>(resolve => { release = resolve; });
    f.beforeRequest(async path => { if (path === '/api/me') { arrived(); await waiting; } });
    const refresh = f.account.get();
    await entered;
    const count = f.requests.length;
    try {
      expect(f.account.screenshotCaptureNotice()).toBeNull();
      expect(f.requests).toHaveLength(count);
      f.store.changeGrant(grant.id, { action: 'revoke', reason: '框选期间撤销资格' }, actor);
    } finally { release(); await refresh; }
    expect(f.account.screenshotCaptureNotice()).toContain('联系管理员');
    await expect(f.account.requireScreenshotChatAccess()).rejects.toThrow('联系管理员');
  });

  it('资格检查未结束时退出，不允许迟到的有效资格启动新任务', async () => {
    const f = await fixture(); await f.login();
    const actor = { id: 'test-bootstrap', email: 'bootstrap@example.test' };
    f.store.issue(f.store.byEmail('client@example.test')!.id, { source: 'gift', permanent: true, activation: 'now', reason: '合成会员竞态', idempotencyKey: randomUUID() }, actor);
    let arrived!: () => void, release!: () => void;
    const entered = new Promise<void>(resolve => { arrived = resolve; });
    const waiting = new Promise<void>(resolve => { release = resolve; });
    f.beforeRequest(async path => { if (path === '/api/me') { arrived(); await waiting; } });
    const checking = f.account.requireScreenshotChatAccess();
    const rejected = expect(checking).rejects.toThrow('登录状态已变化');
    await entered;
    const signedOut = f.account.signOut(); release();
    await rejected; await signedOut;
    expect((await f.account.get()).user).toBeNull();
  });
  it('截图对话每次核实资格，拒绝未登录、撤销和离线缓存，匿名检查不联网', async () => {
    const f = await fixture();
    await expect(f.account.requireScreenshotChatAccess()).rejects.toThrow('联系管理员');
    expect(f.requests).toHaveLength(0);
    await f.login();
    await expect(f.account.requireScreenshotChatAccess()).rejects.toThrow('联系管理员');
    const user = f.store.byEmail('client@example.test')!;
    const actor = { id: 'test-bootstrap', email: 'bootstrap@example.test' };
    const grant = f.store.issue(user.id, { source: 'gift', permanent: true, activation: 'now', reason: '合成会员测试', idempotencyKey: randomUUID() }, actor);
    await expect(f.account.requireScreenshotChatAccess()).resolves.toBeUndefined();
    f.store.changeGrant(grant.id, { action: 'revoke', reason: '测试撤销会员' }, actor);
    await expect(f.account.requireScreenshotChatAccess()).rejects.toThrow('联系管理员');
    f.store.issue(user.id, { source: 'gift', permanent: true, activation: 'now', reason: '测试离线资格', idempotencyKey: randomUUID() }, actor);
    await f.account.requireScreenshotChatAccess();
    f.offline();
    await expect(f.account.requireScreenshotChatAccess()).rejects.toThrow('验证会员资格');
    expect((await f.account.get()).user?.access.state).toBe('permanent');
  });
  it('只允许固定 HTTPS 服务或开发环境的本机 HTTP，不允许路径、用户信息和任意 HTTP', () => {
    expect(accountOrigin('https://accounts.example.com/', true)).toBe('https://accounts.example.com');
    expect(accountOrigin(origin, false)).toBe(origin);
    for (const input of [origin, 'http://example.com', 'https://user:pass@example.com', 'https://example.com/api', 'https://example.com?query=1', 'file:///etc/passwd']) expect(accountOrigin(input, true)).toBeNull();
    expect(accountOrigin('http://example.com', false)).toBeNull();
  });
  it('默认连接云端，开发联调可指定本机服务，正式应用不接受运行环境覆盖', () => {
    expect(resolveAccountOrigin(false)).toBe('https://console.umbraticus.cn');
    expect(resolveAccountOrigin(true)).toBe('https://console.umbraticus.cn');
    expect(resolveAccountOrigin(false, 'https://console.umbraticus.cn', origin)).toBe(origin);
    expect(resolveAccountOrigin(true, undefined, origin)).toBe('https://console.umbraticus.cn');
    expect(resolveAccountOrigin(true, 'https://other.example.com', 'https://runtime.example.com')).toBe('https://other.example.com');
    expect(resolveAccountOrigin(false, undefined, 'http://unsafe.example.com')).toBeNull();
    expect(resolveAccountOrigin(true, origin)).toBeNull();
  });
  it('输入经过规范化、限制与严格校验，IPC 不能扩展请求字段', () => {
    expect(accountCodeRequestSchema.parse({ email: ' Client@Example.test ' }).email).toBe('client@example.test');
    expect(accountCodeRequestSchema.safeParse({ email: 'a@example.test', url: 'https://evil.test' }).success).toBe(false);
    expect(accountSignInSchema.safeParse({ email: 'a@example.test', otp: 'binding-secret' }).success).toBe(false);
  });
  it('加密保存、限定文件权限、按来源和有效期恢复，不能跨服务器复用', () => {
    const s = storage(), session = { origin, cookie, expiresAt: Date.now() + 60000 };
    expect(s.store.save(session)).toBe(true);
    expect(readFileSync(s.file, 'utf8')).not.toContain('private-session-token');
    expect(statSync(s.file).mode & 0o777).toBe(0o600);
    expect(s.store.load(origin, Date.now())).toEqual(session);
    expect(s.store.load('https://other.example.com', Date.now())).toBeNull();
    expect(existsSync(s.file)).toBe(false);
    s.store.save(session);
    expect(s.store.load(origin, session.expiresAt)).toBeNull();
  });
  it('安全存储不可用时仅保留内存会话，不写明文；损坏文件不阻止启动', () => {
    const s = storage(); s.disable();
    expect(s.store.save({ origin, cookie, expiresAt: Date.now() + 60000 })).toBe(false);
    expect(existsSync(s.file)).toBe(false);
    writeFileSync(s.file, 'broken');
    expect(s.store.load(origin, Date.now())).toBeNull();
  });
});

describe('桌面 HTTP 合成协议夹具', () => {
  it('邮箱验证码自动注册、恢复会话并读取资格；Renderer 结果没有私有凭据', async () => {
    const f = await fixture(), state = await f.login();
    expect(state.user).toMatchObject({ email: 'client@example.test', emailVerified: true, access: { state: 'none' } });
    expect(state.remembered).toBe(true);
    const session = f.credentialStore.load(origin, Date.now())!;
    expect(JSON.stringify(state)).not.toContain(session.cookie.split('=')[1]);
    expect(JSON.stringify(f.events)).not.toContain('session_token');
    expect(f.requests.filter(request => request.path !== '/api/config').every(request => request.origin === 'http://localhost:5174')).toBe(true);
    expect(f.requests.filter(request => request.path === '/api/config').every(request => !request.cookie)).toBe(true);
    const restored = await f.service().get();
    expect(restored.user?.id).toBe(state.user?.id);
    const actor = { id: 'bootstrap', email: 'test-bootstrap' };
    f.store.issue(state.user!.id, { source: 'gift', permanent: true, activation: 'first-login', reason: '永久资格联调', idempotencyKey: randomUUID() }, actor);
    expect((await f.account.get()).user?.access).toEqual({ state: 'permanent', expiresAt: null });
  });
  it('停用账号使会话失效并删除本机凭据', async () => {
    const f = await fixture(), state = await f.login();
    const actor = { id: 'bootstrap', email: 'test-bootstrap' };
    f.store.updateUser(state.user!.id, { status: 'disabled', reason: '联调停用' }, actor);
    const disabled = await f.account.get();
    expect(disabled.user).toBeNull();
    expect(disabled.sessionPresent).toBe(false);
    expect(existsSync(f.file)).toBe(false);
  });
  it('掉线保留凭据，退出仍清除本机会话并明确报告服务器未撤销', async () => {
    const f = await fixture(); await f.login(); f.offline();
    expect((await f.account.get()).connection).toBe('unavailable');
    expect(existsSync(f.file)).toBe(true);
    expect(await f.account.signOut()).toEqual({ remoteSignedOut: false });
    expect(existsSync(f.file)).toBe(false);
    f.online(); expect((await f.service().get()).user).toBeNull();
  });
  it('没有系统安全存储时仍可登录，但重启后必须重新验证邮箱', async () => {
    const f = await fixture(); f.disable();
    const state = await f.login();
    expect(state.user?.email).toBe('client@example.test');
    expect(state.remembered).toBe(false);
    expect(existsSync(f.file)).toBe(false);
    expect((await f.account.get()).user?.id).toBe(state.user?.id);
    expect((await f.service().get()).user).toBeNull();
  });
  it('登录与退出串行，退出后不被未完成登录恢复；服务器会话也撤销', async () => {
    const f = await fixture();
    const sent = await f.account.sendCode({ email: 'client@example.test' });
    const signing = f.account.signIn({ email: 'client@example.test', otp: sent.developmentCode! });
    const leaving = f.account.signOut();
    await signing;
    expect(await leaving).toEqual({ remoteSignedOut: true });
    expect((await f.account.get()).user).toBeNull();
    expect(existsSync(f.file)).toBe(false);
    expect(({ total: f.store.sessionCount() })).toEqual({ total: 0 });
  });
  it('主进程独立执行重发冷却，错误验证码不能创建会话', async () => {
    const f = await fixture();
    const sent = await f.account.sendCode({ email: 'client@example.test' });
    await expect(f.account.sendCode({ email: 'other@example.test' })).rejects.toThrow('一分钟');
    await expect(f.account.signIn({ email: 'client@example.test', otp: sent.developmentCode === '000000' ? '111111' : '000000' })).rejects.toThrow('验证码');
    expect(existsSync(f.file)).toBe(false);
  });
  it('未配置服务时账号功能关闭，其他桌面功能可独立启动', async () => {
    const f = storage();
    const account = new AccountService({ origin: null, packaged: true, store: f.store });
    expect(await account.get()).toMatchObject({ configured: false, connection: 'unconfigured', user: null });
    await expect(account.sendCode({ email: 'client@example.test' })).rejects.toThrow('暂未配置');
  });
});
