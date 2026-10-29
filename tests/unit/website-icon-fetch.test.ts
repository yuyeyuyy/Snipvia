import { expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { RequestOptions } from 'node:https';
import { declaredWebsiteIcons, fetchWebsiteIcon, publicIconAddress, publicIconUrl, readIconResource } from '../../src/main/quick-target/WebsiteIconFetch';
import { faviconImage } from '../../src/main/quick-target/FaviconImage';
const network = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup: network.lookup }));
vi.mock('node:https', () => ({ request: network.request }));
vi.mock('node:http', () => ({ request: network.request }));

it('pins validated DNS results and sends no cookies, authorization or referrer', async () => {
  network.lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]); network.request.mockClear();
  network.request.mockImplementation((_url, _options, callback: (response: EventEmitter) => void) => Object.assign(new EventEmitter(), {
    setTimeout() {}, end() { queueMicrotask(() => {
      const response = Object.assign(new EventEmitter(), { statusCode: 200, headers: { 'content-type': 'image/png' } });
      callback(response); response.emit('data', Buffer.from('fixture')); response.emit('end');
    }); }
  }));
  expect((await readIconResource('https://example.com/icon.png', new AbortController().signal, 100)).bytes.toString()).toBe('fixture');
  const options = network.request.mock.calls[0][1] as RequestOptions;
  expect(options.agent).toBe(false); expect(options.headers).toEqual({ 'User-Agent': 'Snipvia-Website-Icon', Accept: 'text/html,image/*;q=0.9', 'Accept-Encoding': 'identity' });
  const resolved = vi.fn(); options.lookup!('example.com', {}, resolved); expect(resolved).toHaveBeenCalledWith(null, '8.8.8.8', 4);
  network.lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }]); network.request.mockClear();
  await expect(readIconResource('https://example.com/icon.png', new AbortController().signal, 100)).rejects.toThrow('Non-public');
  expect(network.request).not.toHaveBeenCalled();
  network.lookup.mockResolvedValue([{ address: '198.18.0.10', family: 4 }, { address: '2001:2::8', family: 6 }]);
  expect((await readIconResource('https://example.com/icon.png', new AbortController().signal, 100)).bytes.toString()).toBe('fixture');
  expect(() => publicIconUrl('https://198.18.0.10/icon.png')).toThrow();
});

it('revalidates redirects and rejects oversized response headers before reading a body', async () => {
  network.lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
  for (const headers of [{ location: 'http://169.254.169.254/' }, { 'content-length': '999999' }]) {
    const destroy = vi.fn();
    network.request.mockImplementation((_url, _options, callback: (response: unknown) => void) => Object.assign(new EventEmitter(), {
      setTimeout() {}, end() { queueMicrotask(() => callback({ statusCode: 'location' in headers ? 302 : 200, headers, destroy })); }
    }));
    await expect(readIconResource('https://example.com/icon.png', new AbortController().signal, 100)).rejects.toThrow();
    expect(destroy).toHaveBeenCalledOnce();
  }
});

it('blocks private, local, special-use and disguised IP destinations', () => {
  for (const value of ['http://localhost/', 'http://service.local/', 'http://127.1/', 'http://2130706433/', 'http://0x7f000001/', 'http://10.0.0.2/', 'http://[::1]/', 'http://[::ffff:8.8.8.8]/', 'https://example.com:8443/', 'file:///private/icon', 'https://user:secret@example.com/']) expect(() => publicIconUrl(value), value).toThrow();
  for (const ip of ['0.0.0.0', '100.64.0.1', '169.254.169.254', '172.16.1.1', '192.168.1.1', '192.0.2.1', '198.18.0.1', '203.0.113.1', '224.0.0.1', 'fc00::1', 'fe80::1', '2001:db8::1', '2002:7f00:1::']) expect(publicIconAddress(ip), ip).toBe(false);
  for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '2001:4860:4860::8888']) expect(publicIconAddress(ip), ip).toBe(true);
  expect(publicIconUrl('/icon.png#x', 'https://example.com/').href).toBe('https://example.com/icon.png');
});
it('parses declared icons without scripts, comments, body markup or unsafe references', () => {
  const html = `<!doctype html><head><!-- <link rel=icon href=/wrong.png> -->
    <script>const s='<link rel=icon href=/script.png>';</script>
    <link HREF='/favicon.png?x=1&amp;y=2' sizes='64x64' REL='shortcut ICON'>
    <link rel=apple-touch-icon href='//cdn.example.com/apple.png'>
    <link rel=icon href=http://127.0.0.1/icon><link rel=icon href='data:image/png;base64,abc'>
    <link rel=icon type=image/svg+xml href=/icon.svg><link rel=icon href='http://example.com/downgrade.png'>
    </head><body><link rel=icon href=/body.png>`;
  expect(declaredWebsiteIcons(html, 'https://example.com/')).toEqual(['https://example.com/favicon.png?x=1&y=2', 'https://cdn.example.com/apple.png']);
});
it('requests only the public origin and falls back to favicon.ico after a rejected/unsupported icon', async () => {
  const read = vi.fn(async (url: string) => ({ url, type: url.endsWith('/') ? 'text/html' : 'image/png', bytes: Buffer.from(url.endsWith('/') ? '<link rel=icon href=/bad.png>' : url) }));
  const normalize = vi.fn((bytes: Buffer) => bytes.toString().endsWith('/favicon.ico') ? 'local-png' : undefined);
  expect(await fetchWebsiteIcon('https://example.com/private/conversation?secret=local#fragment', new AbortController().signal, normalize, read)).toBe('local-png');
  expect(read.mock.calls.map(call => call[0])).toEqual(['https://example.com/', 'https://example.com/bad.png', 'https://example.com/favicon.ico']);
});
it('keeps offline errors and cancellations outside the screenshot path', async () => {
  const read = vi.fn(async () => { throw new Error('Synthetic offline'); });
  expect(await fetchWebsiteIcon('https://example.com/', new AbortController().signal, () => undefined, read)).toBeUndefined();
  expect(read).toHaveBeenCalledTimes(3);
  const controller = new AbortController(); controller.abort(); read.mockClear();
  expect(await fetchWebsiteIcon('https://example.com/', controller.signal, () => undefined, read)).toBeUndefined();
  expect(read).toHaveBeenCalledTimes(1);
});
it('extracts ICO PNG or bounded 32-bit DIB pixels and rejects malformed or oversized data', () => {
  const icon = Buffer.alloc(22 + 40 + 16 + 8);
  icon.writeUInt16LE(1, 2); icon.writeUInt16LE(1, 4); icon[6] = 2; icon[7] = 2;
  icon.writeUInt32LE(icon.length - 22, 14); icon.writeUInt32LE(22, 18);
  icon.writeUInt32LE(40, 22); icon.writeInt32LE(2, 26); icon.writeInt32LE(4, 30); icon.writeUInt16LE(1, 34); icon.writeUInt16LE(32, 36);
  for (let i = 62; i < 78; i += 4) { icon[i] = 40; icon[i + 1] = 80; icon[i + 2] = 120; } // Legacy zero alpha; AND mask controls opacity.
  icon[82] = 0x80;
  const decoded = faviconImage(icon); expect(decoded?.kind).toBe('bitmap');
  if (decoded?.kind !== 'bitmap') throw Error('Missing bitmap');
  expect([decoded.width, decoded.height]).toEqual([2, 2]); expect([...decoded.bytes.subarray(0, 8)]).toEqual([40, 80, 120, 0, 40, 80, 120, 255]);
  for (const input of [Buffer.from('<svg onload="alert(1)"/>'), Buffer.alloc(256 * 1024 + 1), icon.subarray(0, 70)]) expect(faviconImage(input)).toBeUndefined();
  const huge = Buffer.alloc(33); Buffer.from('89504e470d0a1a0a', 'hex').copy(huge); huge.write('IHDR', 12); huge.writeUInt32BE(100000, 16); huge.writeUInt32BE(2, 20);
  expect(faviconImage(huge)).toBeUndefined();
});
