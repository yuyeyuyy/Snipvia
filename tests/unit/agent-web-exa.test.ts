import { describe, expect, it } from 'vitest';
import { ExaWebSearchProvider } from '../../src/main/agent/web/ExaWebSearchProvider';
import { WebSearchService } from '../../src/main/agent/web/WebSearchService';
import { defaultSearchProvider } from '../../src/main/agent/web/defaultSearchProvider';
import { fakeHttp, freshSignal, webResponse } from './helpers/web';

const request = () => ({ query: 'Electron screen capture', maxResults: 8, signal: freshSignal() });
const rpc = (results: unknown[]) => ({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: JSON.stringify({ results }) }] } });
const item = { title: 'Electron docs', url: 'https://www.electronjs.org/docs/latest/api/desktop-capturer',
  text: 'Fallback text', highlights: ['Screen capture API', 'Platform notes'], publishedDate: '2026-09-20T00:00:00Z' };

describe('Exa hosted read-only search adapter', () => {
  it('uses Exa by default while preserving explicit Brave and legacy configuration', () => {
    expect(defaultSearchProvider({}).id).toBe('exa');
    expect(defaultSearchProvider({ SNIPVIA_BRAVE_SEARCH_API_KEY: 'synthetic-key' }).id).toBe('brave');
    expect(defaultSearchProvider({ SNIPVIA_WEB_SEARCH_PROVIDER: 'duckduckgo' }).id).toBe('duckduckgo-html');
  });
  it.each(['application/json', 'text/event-stream'])('normalizes %s without passing MCP data or credentials to the model', async (type) => {
    const json = JSON.stringify(rpc([item]));
    const body = type === 'application/json' ? json : `: keepalive\r\n\r\ndata: {"jsonrpc":"2.0","method":"notifications/progress"}\r\n\r\nevent: message\r\ndata: ${json}\r\n\r\n`;
    const { client, open } = fakeHttp([webResponse(body, { 'content-type': type })]);
    const output = await new WebSearchService(new ExaWebSearchProvider(client, () => 'synthetic-key')).search(request().query, 8, freshSignal());
    expect(output.results).toEqual([{ title: item.title, url: item.url, snippet: 'Screen capture API Platform notes', publishedAt: '2026-09-20' }]);
    expect(JSON.stringify(output)).not.toContain('synthetic-key');
    const [target, , headers, jsonBody] = open.mock.calls[0];
    expect(target.url.href).toBe('https://mcp.exa.ai/mcp?tools=web_search_advanced_exa');
    expect(headers['x-api-key']).toBe('synthetic-key');
    expect(JSON.parse(jsonBody!)).toMatchObject({ method: 'tools/call', params: { name: 'web_search_advanced_exa', arguments: { numResults: 8, enableHighlights: true, textMaxCharacters: 1000 } } });
  });
  it('turns site operators into domain filters and works without a key', async () => {
    const { client, open } = fakeHttp([webResponse(JSON.stringify(rpc([])), { 'content-type': 'application/json' })]);
    expect(await new ExaWebSearchProvider(client).search({ ...request(), query: 'site:github.com/ValveSoftware Steam error' })).toEqual({ results: [] });
    expect(JSON.parse(open.mock.calls[0][3]!).params.arguments).toMatchObject({ includeDomains: ['github.com/ValveSoftware'], query: 'Steam error' });
    expect(open.mock.calls[0][2]).not.toHaveProperty('x-api-key');
    await expect(new ExaWebSearchProvider(client).search({ ...request(), query: 'site:localhost secret' })).rejects.toMatchObject({ code: 'URL_BLOCKED' });
    expect(open).toHaveBeenCalledTimes(1);
  });
  it('filters invalid source URLs, bounds snippets and does not invent publication dates', async () => {
    const { client } = fakeHttp([webResponse(JSON.stringify(rpc([{ ...item, url: 'http://127.0.0.1/' },
      { ...item, publishedDate: null, highlights: [], text: 'x'.repeat(30_000) }])), { 'content-type': 'application/json' })]);
    const output = await new WebSearchService(new ExaWebSearchProvider(client)).search('query', 8, freshSignal());
    expect(output.results).toHaveLength(1); expect(output.results[0].snippet.length).toBeLessThanOrEqual(800);
    expect(output.results[0]).not.toHaveProperty('publishedAt');
  });
  it.each([{ jsonrpc: '2.0', id: 1, error: { message: 'secret' } },
    { jsonrpc: '2.0', id: 1, result: { isError: true, content: [{ type: 'text', text: 'secret' }] } }])('reports protocol and service errors without raw response details', async (body) => {
    const { client } = fakeHttp([webResponse(JSON.stringify(body), { 'content-type': 'application/json' })]);
    await expect(new ExaWebSearchProvider(client).search(request())).rejects.toMatchObject({ code: 'SEARCH_FAILED', message: 'Exa 搜索暂不可用或已达到服务限额' });
  });
  it('rejects malformed/foreign responses instead of reporting a false empty success', async () => {
    for (const body of ['invalid', JSON.stringify({ ...rpc([item]), id: 2 })]) {
      const { client } = fakeHttp([webResponse(body, { 'content-type': 'application/json' })]);
      await expect(new ExaWebSearchProvider(client).search(request())).rejects.toMatchObject({ code: 'INVALID_RESULT' });
    }
  });
  it('keeps POST payloads bounded and never follows a redirect or ignores cancellation', async () => {
    const { client, open } = fakeHttp([webResponse('', { location: 'https://other.example.com' }, 307)]);
    await expect(new ExaWebSearchProvider(client, () => 'synthetic-key').search(request())).rejects.toMatchObject({ code: 'REDIRECT_LIMIT' });
    expect(open).toHaveBeenCalledTimes(1);
    await expect(client.postJson('https://example.com', { text: 'x'.repeat(70_000) }, { signal: freshSignal() })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(new ExaWebSearchProvider(client).search({ ...request(), signal: AbortSignal.abort() })).rejects.toMatchObject({ code: 'ABORTED' });
    expect(open).toHaveBeenCalledTimes(1);
  });
});
