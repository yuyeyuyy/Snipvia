import { gzipSync, brotliCompressSync, deflateSync } from 'node:zlib';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isPublicAddress, NetworkPolicy, publicWebUrl } from '../../src/main/agent/web/NetworkPolicy';
import { pinnedRequestOptions, PublicHttpClient, type WebResponse } from '../../src/main/agent/web/PublicHttpClient';
import { fakeHttp, freshSignal, publicDns, webResponse } from './helpers/web';

afterEach(() => { vi.useRealTimers(); });

describe('SSRF boundary', () => {
  it.each(['127.0.0.1', '127.9.1.2', '0.0.0.0', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1',
    '169.254.169.254', '100.100.100.200', '100.64.0.1', '192.0.0.9', '192.88.99.1', '198.18.0.1', '192.0.2.1', '198.51.100.1', '203.0.113.1',
    '224.0.0.1', '240.0.0.1', '255.255.255.255', '::', '::1', '::ffff:127.0.0.1', '::ffff:8.8.8.8', 'fc00::1', 'fd00::1', 'fe80::1', 'fe80::1%en0',
    'ff00::1', '64:ff9b::a00:1', '2002:7f00:1::', '2001:db8::1', '2001::1', '3fff::1', '4000::1'])('rejects non-public address %s', (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });
  it.each(['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111', '2001:4860:4860::8888'])('accepts native global address %s', (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });
  it.each(['http://localhost', 'http://LOCALHOST.', 'http://x.localhost/', 'http://x.local/', 'http://metadata.google.internal/', 'http://router/',
    'http://router.home.arpa/', 'http://127.1', 'http://2130706433/', 'http://0x7f000001/', 'http://0177.0.0.1/', 'http://[::1]/',
    'http://[::ffff:127.0.0.1]/', 'file:///etc/passwd', 'data:text/html,test', 'ftp://example.com/a', 'gopher://example.com/',
    'https://user:secret@example.com/', 'https://example.com:8443/', ' https://example.com', 'https://example.com\\@localhost/',
    'https://example.com/\n'])('rejects unsafe URL before DNS: %s', async (url) => {
    const dns = vi.fn(publicDns); const policy = new NetworkPolicy(dns);
    await expect(policy.resolve(url, freshSignal())).rejects.toMatchObject({ code: 'URL_BLOCKED' });
    expect(dns).not.toHaveBeenCalled();
  });
  it('normalizes host/fragment and accepts explicit standard ports', () => {
    expect(publicWebUrl('https://EXAMPLE.com:443/path#fragment').href).toBe('https://example.com/path');
  });
  it('rejects DNS with any private A/AAAA result; does not just choose the public one', async () => {
    const policy = new NetworkPolicy(async () => [{ address: '8.8.8.8', family: 4 }, { address: '::1', family: 6 }]);
    await expect(policy.resolve('https://example.com', freshSignal())).rejects.toMatchObject({ code: 'URL_BLOCKED' });
  });
  it.each([{ records: [] }, { records: [{ address: '8.8.8.8', family: 6 }] }, { records: [{ address: 'garbage', family: 4 }] }])('fails closed on invalid DNS records', async ({ records }) => {
    await expect(new NetworkPolicy(async () => records).resolve('https://example.com', freshSignal())).rejects.toHaveProperty('code');
  });
  it('pins DNS output for the socket instead of resolving the host again', async () => {
    const dns = vi.fn(publicDns);
    const target = await new NetworkPolicy(dns).resolve('https://example.com/page', freshSignal());
    const options = pinnedRequestOptions(target);
    const callback = vi.fn(); options.lookup!('example.com', {}, callback);
    expect(callback).toHaveBeenCalledWith(null, '93.184.216.34', 4);
    const all = vi.fn(); options.lookup!('example.com', { all: true }, all);
    expect(all).toHaveBeenCalledWith(null, [{ address: '93.184.216.34', family: 4 }]);
    expect(options).toMatchObject({ autoSelectFamily: false, family: 4, method: 'GET', maxHeaderSize: 32768 });
    expect(dns).toHaveBeenCalledOnce();
    expect(target.url.hostname).toBe('example.com'); // Keep Host and TLS identity.
  });
});

describe('bounded HTTP requests', () => {
  it('follows a relative redirect and closes every response', async () => {
    const first = webResponse('', { location: '/final' }, 302); const final = webResponse('<p>done</p>');
    const { client, open } = fakeHttp([first, final]);
    const result = await client.get('https://example.com/start', { signal: freshSignal() });
    expect(result).toMatchObject({ url: 'https://example.com/final', redirects: 1, contentType: 'text/html', charset: 'utf-8' });
    expect(result.bytes.toString()).toContain('done'); expect(open).toHaveBeenCalledTimes(2);
    expect(first.close).toHaveBeenCalledOnce(); expect(final.close).toHaveBeenCalledOnce();
  });
  it('revalidates DNS at each hop and blocks rebinding to the same hostname', async () => {
    const dns = vi.fn().mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }]).mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }]);
    const { client, open } = fakeHttp([webResponse('', { location: '/private' }, 302)], 1000, new NetworkPolicy(dns));
    await expect(client.get('https://example.com/start', { signal: freshSignal() })).rejects.toMatchObject({ code: 'URL_BLOCKED' });
    expect(open).toHaveBeenCalledOnce();
  });
  it.each(['http://127.0.0.1/', 'https://[::1]/', 'file:///private', 'https://user:pass@example.com/'])('blocks redirect escape to %s', async (location) => {
    const { client, open } = fakeHttp([webResponse('', { location }, 302)]);
    await expect(client.get('https://example.com/start', { signal: freshSignal() })).rejects.toMatchObject({ code: 'URL_BLOCKED' });
    expect(open).toHaveBeenCalledOnce();
  });
  it('limits redirect count and rejects loops without extra connections', async () => {
    const { client, open } = fakeHttp([webResponse('', { location: '/b' }, 302), webResponse('', { location: '/c' }, 302)]);
    await expect(client.get('https://example.com/a', { signal: freshSignal(), maxRedirects: 1 })).rejects.toMatchObject({ code: 'REDIRECT_LIMIT' });
    expect(open).toHaveBeenCalledTimes(2);
    const loop = fakeHttp([webResponse('', { location: '/a' }, 302)]);
    await expect(loop.client.get('https://example.com/a', { signal: freshSignal() })).rejects.toMatchObject({ code: 'REDIRECT_LIMIT' });
    expect(loop.open).toHaveBeenCalledOnce();
  });
  it('does not forward credentials across origins or replay response cookies', async () => {
    const { client, open } = fakeHttp([webResponse('', { location: 'https://other.example.com/', 'set-cookie': ['session=private'] }, 302), webResponse()]);
    await client.get('https://example.com/', { signal: freshSignal(), headers: { 'X-Subscription-Token': 'synthetic-key' } });
    expect(open.mock.calls[0][2]).toHaveProperty('X-Subscription-Token');
    expect(open.mock.calls[1][2]).not.toHaveProperty('X-Subscription-Token');
    expect(open.mock.calls[1][2]).not.toHaveProperty('Cookie');
  });
  it('rejects MIME and attachments without consuming their body', async () => {
    for (const headers of [{ 'content-type': 'application/pdf' }, { 'content-disposition': 'attachment; filename=file.txt' }, { 'content-type': 'image/png' }]) {
      const response = webResponse('binary', headers); const { client } = fakeHttp([response]);
      await expect(client.get('https://example.com/', { signal: freshSignal() })).rejects.toMatchObject({ code: 'UNSUPPORTED_CONTENT_TYPE' });
      expect(response.close).toHaveBeenCalledOnce();
    }
  });
  it('checks both Content-Length and actual chunked bytes', async () => {
    const declared = fakeHttp([webResponse('', { 'content-length': '999' })]);
    await expect(declared.client.get('https://example.com/', { signal: freshSignal(), maxBytes: 10 })).rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE' });
    const chunks = webResponse(); chunks.body = (async function* () { yield Buffer.alloc(8); yield Buffer.alloc(8); })();
    const actual = fakeHttp([chunks]);
    await expect(actual.client.get('https://example.com/', { signal: freshSignal(), maxBytes: 10 })).rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE' });
    expect(chunks.close).toHaveBeenCalledOnce();
  });
  it.each([['gzip', gzipSync], ['br', brotliCompressSync], ['deflate', deflateSync]] as const)('decodes %s and bounds decompressed output', async (encoding, compress) => {
    const compressed = compress(Buffer.from('<p>你好</p>'));
    const { client } = fakeHttp([webResponse(compressed, { 'content-encoding': encoding })]);
    expect((await client.get('https://example.com/', { signal: freshSignal() })).bytes.toString()).toBe('<p>你好</p>');
    const bomb = fakeHttp([webResponse(compress(Buffer.alloc(100_000, 'x')), { 'content-encoding': encoding })]);
    await expect(bomb.client.get('https://example.com/', { signal: freshSignal(), maxBytes: 1024 })).rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE' });
  });
  it('sanitizes transport errors and HTTP error bodies', async () => {
    const client = new PublicHttpClient(new NetworkPolicy(publicDns), { open: async () => { throw new Error('API_KEY=secret'); } });
    await expect(client.get('https://example.com', { signal: freshSignal() })).rejects.toMatchObject({ code: 'NETWORK_ERROR', message: '网页读取失败或响应数据损坏' });
    const failure = fakeHttp([webResponse('secret error body', {}, 500)]);
    await expect(failure.client.get('https://example.com', { signal: freshSignal() })).rejects.toMatchObject({ code: 'HTTP_ERROR', message: '网页返回 HTTP 500' });
  });
  it('bounds DNS time and allows cancellation even when DNS ignores the signal', async () => {
    vi.useFakeTimers(); const open = vi.fn();
    const client = new PublicHttpClient(new NetworkPolicy(async () => new Promise(() => {})), { open }, 20);
    const pending = client.get('https://example.com', { signal: freshSignal() });
    const check = expect(pending).rejects.toMatchObject({ code: 'TIMEOUT' });
    await vi.advanceTimersByTimeAsync(20); await check; expect(open).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
    const controller = new AbortController(); const cancelled = client.get('https://example.com', { signal: controller.signal });
    const checkCancel = expect(cancelled).rejects.toMatchObject({ code: 'ABORTED' }); controller.abort(); await checkCancel;
  });
  it('closes a stalled body on cancellation', async () => {
    const controller = new AbortController(); const stream = new PassThrough();
    const response: WebResponse = { status: 200, headers: { 'content-type': 'text/plain' }, body: stream, close: vi.fn(() => stream.destroy()) };
    const { client, open } = fakeHttp([response]);
    const pending = client.get('https://example.com', { signal: controller.signal }); const check = expect(pending).rejects.toMatchObject({ code: 'ABORTED' });
    await vi.waitFor(() => expect(open).toHaveBeenCalled()); controller.abort(); await check;
    expect(response.close).toHaveBeenCalled(); expect(stream.destroyed).toBe(true);
  });
  it('honors an already aborted signal before any DNS/network work', async () => {
    const { client, open } = fakeHttp([]); const controller = new AbortController(); controller.abort();
    await expect(client.get('https://example.com', { signal: controller.signal })).rejects.toMatchObject({ code: 'ABORTED' }); expect(open).not.toHaveBeenCalled();
  });
});
