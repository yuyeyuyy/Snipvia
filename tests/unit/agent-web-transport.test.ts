import type { ClientRequest, IncomingMessage, RequestOptions } from 'node:http';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NodeWebTransport, webUserAgent } from '../../src/main/agent/web/PublicHttpClient';

const wire = vi.hoisted(() => ({
  calls: [] as Array<{ url: URL; options: RequestOptions; request: ClientRequest; reply(response: IncomingMessage): void; secure: boolean }>
}));
vi.mock('node:http', async (original) => {
  const actual = await original<typeof import('node:http')>();
  const { EventEmitter } = await import('node:events');
  return { ...actual, request: (url: URL, options: RequestOptions, reply: (response: IncomingMessage) => void) => {
    const request = Object.assign(new EventEmitter(), { end: vi.fn(), destroy: vi.fn() }) as unknown as ClientRequest;
    wire.calls.push({ url, options, request, reply, secure: false }); return request;
  } };
});
vi.mock('node:https', async (original) => {
  const actual = await original<typeof import('node:https')>();
  const { EventEmitter } = await import('node:events');
  return { ...actual, request: (url: URL, options: RequestOptions, reply: (response: IncomingMessage) => void) => {
    const request = Object.assign(new EventEmitter(), { end: vi.fn(), destroy: vi.fn() }) as unknown as ClientRequest;
    wire.calls.push({ url, options, request, reply, secure: true }); return request;
  } };
});
function reply(address = '93.184.216.34') {
  return Object.assign(Readable.from([Buffer.from('text')]), { statusCode: 200, headers: { 'content-type': 'text/plain' }, socket: { remoteAddress: address } }) as unknown as IncomingMessage;
}
afterEach(() => { wire.calls.splice(0); });

describe('Node transport socket contract', () => {
  it('sends trusted JSON via POST while retaining the pinned HTTPS transport', async () => {
    const body = JSON.stringify({ query: 'public query' });
    const pending = new NodeWebTransport().open({ url: new URL('https://example.com'), address: { address: '93.184.216.34', family: 4 } }, new AbortController().signal, {}, body);
    expect(wire.calls[0].options).toMatchObject({ method: 'POST', rejectUnauthorized: true, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } });
    expect(wire.calls[0].request.end).toHaveBeenCalledWith(body);
    wire.calls[0].reply(reply()); (await pending).close();
  });
  it.each(['http:', 'https:'])('uses %s, pinned lookup, original host, explicit UA, AbortSignal and a proxy-free agent', async (protocol) => {
    const signal = new AbortController().signal;
    const url = new URL(`${protocol}//example.com/path`);
    const opening = new NodeWebTransport().open({ url, address: { address: '93.184.216.34', family: 4 } }, signal, { 'User-Agent': 'untrusted override' });
    const request = wire.calls[0];
    expect(request.secure).toBe(protocol === 'https:'); expect(request.url.hostname).toBe('example.com');
    expect(request.options).toMatchObject({ signal, method: 'GET', family: 4, headers: { 'User-Agent': webUserAgent, Connection: 'close', 'Accept-Encoding': 'gzip, deflate, br' } });
    expect(request.options).not.toHaveProperty('rejectUnauthorized', false);
    if (protocol === 'https:') expect(request.options).toHaveProperty('rejectUnauthorized', true);
    expect(request.options.agent).toHaveProperty('options.proxyEnv', {});
    const callback = vi.fn(); request.options.lookup!('example.com', {}, callback);
    expect(callback).toHaveBeenCalledWith(null, '93.184.216.34', 4);
    request.reply(reply()); const response = await opening; response.close();
    expect(request.request.destroy).toHaveBeenCalled();
  });
  it('rejects an unexpected connected peer and destroys the response', async () => {
    const opening = new NodeWebTransport().open({ url: new URL('https://example.com'), address: { address: '93.184.216.34', family: 4 } }, new AbortController().signal, {});
    const check = expect(opening).rejects.toMatchObject({ code: 'URL_BLOCKED' });
    const response = reply('127.0.0.1'); wire.calls[0].reply(response); await check;
    expect(response.destroyed).toBe(true); expect(wire.calls[0].request.destroy).toHaveBeenCalled();
  });
  it('normalizes socket errors without exposing request headers', async () => {
    const opening = new NodeWebTransport().open({ url: new URL('https://example.com'), address: { address: '93.184.216.34', family: 4 } }, new AbortController().signal, {});
    const check = expect(opening).rejects.toMatchObject({ code: 'NETWORK_ERROR', message: '网页连接失败' });
    wire.calls[0].request.emit('error', new Error('synthetic-secret')); await check;
  });
});
