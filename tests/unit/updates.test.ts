import { afterEach, describe, expect, it, vi } from 'vitest';
import { isNewerStableVersion, latestReleaseEndpoint, UpdateCheckService } from '../../src/main/updates/UpdateCheckService';
import type { UpdateState } from '../../src/shared/updates';
import type { UpdateInstaller } from '../../src/main/updates/UpdateInstaller';

const release = (tag = 'v0.3.0', extra = {}) => ({ tag_name: tag, draft: false, prerelease: false, published_at: '2026-10-12T00:00:00Z', ...extra });
function fixture(fetcher = vi.fn<typeof fetch>(async () => Response.json(release())), timeoutMs = 8_000) {
  const changed = vi.fn<(state: UpdateState) => void>(), openExternal = vi.fn(async () => undefined);
  const service = new UpdateCheckService({ currentVersion: '0.2.1', fetcher, onChanged: changed, openExternal, timeoutMs, now: () => Date.parse('2026-10-12T00:00:00Z') });
  return { service, changed, fetcher, openExternal };
}
afterEach(() => { vi.useRealTimers(); });

describe('正式版本比较', () => {
  it.each([
    ['v0.2.2', '0.2.1', true], ['v0.10.0', '0.9.0', true], ['1.0.0', '0.99.99', true],
    ['v0.2.1', '0.2.1', false], ['v0.2.0', '0.2.1', false], ['v0.3.0', '0.3.0-beta.1', true],
    ['0.3.0+build.7', '0.3.0+build.6', false]
  ])('%s / %s → %s', (next, installed, expected) => expect(isNewerStableVersion(next, installed)).toBe(expected));
  it.each(['latest', 'v0.4', 'v01.2.3', 'v0.3.0-beta.1', 'v9007199254740992.0.0'])('拒绝无法确认的版本 %s', value => {
    expect(() => isNewerStableVersion(value, '0.2.1')).toThrow();
  });
});

describe('下载与明确重启安装', () => {
  function installerFixture() {
    const installer: UpdateInstaller = { supported: true, unavailableReason: null,
      download: vi.fn(async () => undefined), install: vi.fn(), dispose: vi.fn() };
    const prepareInstall = vi.fn<() => Promise<void>>(async () => undefined), changed = vi.fn();
    const service = new UpdateCheckService({ currentVersion: '0.2.1', installer, prepareInstall,
      fetcher: vi.fn(async () => Response.json(release('v0.3.0', { body: '新版本说明' }))),
      onChanged: changed, openExternal: vi.fn(async () => undefined) });
    return { service, installer, prepareInstall, changed };
  }

  it('未检查、开发或未签名版本不能触发下载和安装', async () => {
    const f = installerFixture(); await expect(f.service.download()).rejects.toThrow('先检查');
    await expect(f.service.restartAndInstall()).rejects.toThrow('先完成');
    const disabled = fixture(); await disabled.service.check();
    await expect(disabled.service.download()).rejects.toThrow('仅支持检查');
    expect(f.installer.install).not.toHaveBeenCalled();
  });

  it('下载单次并显示真实进度，普通查询和下载完成均不触发安装', async () => {
    const f = installerFixture(); await f.service.check();
    expect(f.service.current()).toMatchObject({ downloadSupported: true, downloadUnavailableReason: null });
    let complete!: () => void;
    vi.mocked(f.installer.download).mockImplementation((_version, _tag, progress) => new Promise(resolve => {
      progress(42.8); progress(Number.NaN); complete = resolve;
    }));
    const download = f.service.download(); expect(f.service.download()).toBe(download);
    expect(f.service.current()).toMatchObject({ status: 'downloading', downloadProgress: 42 });
    expect(await f.service.check()).toMatchObject({ status: 'downloading' });
    complete(); expect(await download).toMatchObject({ status: 'downloaded', downloadProgress: 100 });
    expect(f.installer.download).toHaveBeenCalledTimes(1);
    expect(f.installer.download).toHaveBeenCalledWith('0.3.0', 'v0.3.0', expect.any(Function));
    expect(f.installer.install).not.toHaveBeenCalled(); expect(f.prepareInstall).not.toHaveBeenCalled();
    f.service.dispose(); expect(f.installer.install).not.toHaveBeenCalled();
  });

  it('校验失败不能出现重启入口，允许重试且不回显底层错误', async () => {
    const f = installerFixture(); await f.service.check();
    vi.mocked(f.installer.download).mockRejectedValueOnce(new Error('PRIVATE_HASH_ERROR_AND_LOCAL_PATH'));
    expect(await f.service.download()).toMatchObject({ status: 'available', error: expect.stringContaining('校验失败') });
    await expect(f.service.restartAndInstall()).rejects.toThrow();
    expect(JSON.stringify(f.service.current())).not.toContain('PRIVATE');
    expect(await f.service.download()).toMatchObject({ status: 'downloaded', error: null });
  });

  it('仅用户请求重启后确认笔记保存，保存失败保留下载并允许再次尝试', async () => {
    const f = installerFixture(); await f.service.check(); await f.service.download();
    f.prepareInstall.mockRejectedValueOnce(new Error('note conflict'));
    expect(await f.service.restartAndInstall()).toMatchObject({ status: 'downloaded', error: expect.stringContaining('笔记保存') });
    expect(f.installer.install).not.toHaveBeenCalled();
    let flush!: () => void;
    f.prepareInstall.mockImplementationOnce(() => new Promise(resolve => { flush = resolve; }));
    const request = f.service.restartAndInstall(); expect(f.service.restartAndInstall()).toBe(request);
    expect(f.installer.install).not.toHaveBeenCalled();
    flush(); expect(await request).toMatchObject({ status: 'installing', error: null });
    await new Promise(resolve => setImmediate(resolve)); expect(f.installer.install).toHaveBeenCalledTimes(1);
  });

  it('退出时忽略迟到的下载，不安装；原生安装失败需重新启动，不能自动重试', async () => {
    const f = installerFixture(); await f.service.check();
    let finish!: () => void;
    vi.mocked(f.installer.download).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const pending = f.service.download(), previous = f.changed.mock.calls.length;
    f.service.dispose(); finish(); await pending;
    expect(f.changed).toHaveBeenCalledTimes(previous); expect(f.installer.install).not.toHaveBeenCalled();
    const g = installerFixture(); await g.service.check(); await g.service.download();
    vi.mocked(g.installer.install).mockImplementation(() => { throw new Error('native signature failed'); });
    await g.service.restartAndInstall(); await new Promise(resolve => setImmediate(resolve));
    expect(g.service.current()).toMatchObject({ status: 'available', downloadSupported: false, error: expect.stringContaining('安装失败') });
    await expect(g.service.download()).rejects.toThrow('重新打开');
  });
});

describe('主进程更新检查', () => {
  it('新版本返回其 Markdown 更新说明，失败或重新检查时不沿用旧说明', async () => {
    const notes = '## 改进\n\n- 更快打开截图窗口。\n- `Markdown` 笔记体验。';
    const f = fixture(vi.fn(async () => Response.json(release('v0.3.0', { body: notes }))));
    expect(await f.service.check()).toMatchObject({ status: 'available', releaseNotes: notes });
    expect(f.changed.mock.calls[0][0].releaseNotes).toBeNull();
    f.fetcher.mockResolvedValueOnce(new Response('', { status: 500 }));
    expect(await f.service.check()).toMatchObject({ status: 'error', releaseNotes: null });
    expect(f.changed.mock.calls[2][0].releaseNotes).toBeNull();
  });

  it.each([undefined, null, '   \n  '])('缺失或空说明 %s 不影响版本检查', async body => {
    const f = fixture(vi.fn(async () => Response.json(release('v0.3.0', { body }))));
    expect(await f.service.check()).toMatchObject({ status: 'available', releaseNotes: null });
  });

  it('无需更新时不展示旧版说明，损坏的说明字段保留错误状态', async () => {
    const f = fixture(vi.fn(async () => Response.json(release('v0.2.1', { body: '旧版说明' }))));
    expect(await f.service.check()).toMatchObject({ status: 'up-to-date', releaseNotes: null });
    f.fetcher.mockResolvedValueOnce(Response.json(release('v0.3.0', { body: { invalid: true } })));
    expect(await f.service.check()).toMatchObject({ status: 'error', releaseNotes: null });
  });
  it('仅请求固定公开接口，不发送账号或 Key；版本链接由固定仓库生成', async () => {
    const f = fixture(vi.fn(async () => Response.json(release('v0.3.0', { html_url: 'https://evil.example/run' }))));
    expect(f.service.current().status).toBe('idle');
    await expect(f.service.openRelease()).rejects.toThrow();
    const state = await f.service.check();
    expect(state).toMatchObject({ status: 'available', currentVersion: '0.2.1', latestVersion: '0.3.0', releaseUrl: 'https://github.com/yuyeyuyy/Snipvia/releases/tag/v0.3.0', checkedAt: '2026-10-12T00:00:00.000Z' });
    expect(f.fetcher).toHaveBeenCalledWith(latestReleaseEndpoint, expect.objectContaining({ redirect: 'error', credentials: 'omit' }));
    const init = f.fetcher.mock.calls[0][1]!;
    expect(new Headers(init.headers).has('authorization')).toBe(false);
    expect(init.body).toBeUndefined();
    expect(f.changed.mock.calls.map(([value]) => value.status)).toEqual(['checking', 'available']);
    await f.service.openRelease(); expect(f.openExternal).toHaveBeenCalledWith(state.releaseUrl);
  });

  it.each(['v0.2.1', 'v0.1.0'])('相同或较旧版本 %s 不提示更新，不降级', async tag => {
    const f = fixture(vi.fn(async () => Response.json(release(tag))));
    expect(await f.service.check()).toMatchObject({ status: 'up-to-date', releaseUrl: null });
    await expect(f.service.openRelease()).rejects.toThrow();
  });

  it.each([
    [404, '公开'], [403, '限制请求'], [429, '限制请求'], [500, '不可用']
  ])('HTTP %s 不是已经最新', async (code, message) => {
    const f = fixture(vi.fn(async () => new Response('PRIVATE_UPSTREAM_BODY', { status: code })));
    expect(await f.service.check()).toMatchObject({ status: 'error', releaseUrl: null, latestVersion: null, error: expect.stringContaining(message) });
    expect(JSON.stringify(f.service.current())).not.toContain('PRIVATE_UPSTREAM_BODY');
  });

  it.each([
    release('v0.3.0-beta.1'), release('v0.3.0', { draft: true }), release('v0.3.0', { prerelease: true }),
    release('v0.3.0', { published_at: null }), { tag_name: 'v0.3.0' }
  ])('拒绝草稿、预览和损坏信息', async payload => {
    const f = fixture(vi.fn(async () => Response.json(payload)));
    expect((await f.service.check()).status).toBe('error');
  });

  it('限制响应体大小和跳转；网络错误不泄露原文', async () => {
    const f = fixture(vi.fn(async () => new Response(' '.repeat(256 * 1024 + 1))));
    expect((await f.service.check()).error).toContain('过大');
    f.fetcher.mockRejectedValueOnce(new Error('PRIVATE_NETWORK_DETAILS'));
    expect((await f.service.check()).error).toBe('无法检查更新，请检查网络后重试');
  });

  it('同一时刻只请求一次，结束后允许手动刷新，失败不沿用可更新结果', async () => {
    let resolve!: (value: Response) => void;
    const f = fixture(vi.fn(() => new Promise<Response>(done => { resolve = done; })));
    const first = f.service.check(), second = f.service.check();
    expect(first).toBe(second); expect(f.fetcher).toHaveBeenCalledTimes(1);
    resolve(Response.json(release())); await first;
    f.fetcher.mockResolvedValueOnce(new Response('', { status: 500 }));
    expect((await f.service.check()).status).toBe('error');
    expect(f.fetcher).toHaveBeenCalledTimes(2);
    await expect(f.service.openRelease()).rejects.toThrow();
  });

  it('超时有明确错误，退出时取消请求和通知', async () => {
    vi.useFakeTimers();
    const f = fixture(vi.fn((_input, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })), 50);
    const pending = f.service.check(); await vi.advanceTimersByTimeAsync(50);
    expect((await pending).error).toContain('超时');
    const next = f.service.check(); f.service.dispose(); await next;
    expect(f.changed).toHaveBeenCalledTimes(3); // checking, timeout, checking; no notification after disposal.
  });

  it('启动检查延后执行，手动检查不重复，开发模式不自动联网', async () => {
    vi.useFakeTimers();
    const f = fixture(); f.service.scheduleStartup(false, 10);
    await vi.advanceTimersByTimeAsync(10); expect(f.fetcher).not.toHaveBeenCalled();
    f.service.scheduleStartup(true, 10); expect(f.fetcher).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10); expect(f.fetcher).toHaveBeenCalledTimes(1);
    const g = fixture(); g.service.scheduleStartup(true, 10); await g.service.check();
    await vi.advanceTimersByTimeAsync(10); expect(g.fetcher).toHaveBeenCalledTimes(1);
    const stopped = fixture(); stopped.service.scheduleStartup(true, 10); stopped.service.dispose();
    await vi.advanceTimersByTimeAsync(10); expect(stopped.fetcher).not.toHaveBeenCalled();
  });
});
