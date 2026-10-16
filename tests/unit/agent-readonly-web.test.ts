import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFileToolSystem } from '../../src/main/agent/createFileToolSystem';
import { registerWebTools } from '../../src/main/agent/registerWebTools';
import { DuckDuckGoWebSearchProvider, parseDuckDuckGoResults } from '../../src/main/agent/web/DuckDuckGoWebSearchProvider';
import { WebSearchService } from '../../src/main/agent/web/WebSearchService';
import { createSystemWebDnsResolver } from '../../src/main/agent/web/SystemWebDnsResolver';
import { NetworkPolicy } from '../../src/main/agent/web/NetworkPolicy';
import { fakeHttp, freshSignal, webResponse } from './helpers/web';

const directories: string[] = [];
afterEach(async () => { for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true }); });
describe('proxy Fake-IP compatibility preserves SSRF boundaries', () => {
  it('re-resolves synthetic DNS only and pins the verified public answer', async () => {
    const fallback = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]);
    const resolver = createSystemWebDnsResolver(async () => [{ address: '198.18.0.6', family: 4 }], fallback);
    const signal = freshSignal(); const target = await new NetworkPolicy(resolver).resolve('https://example.com', signal);
    expect(target.address.address).toBe('93.184.216.34'); expect(fallback).toHaveBeenCalledWith('example.com', signal);
  });
  it('never falls back for private, loopback, mixed or normal public answers', async () => {
    for (const addresses of [[{ address: '127.0.0.1', family: 4 }], [{ address: '10.0.0.1', family: 4 }],
      [{ address: '198.18.0.6', family: 4 }, { address: '192.168.1.2', family: 4 }]]) {
      const fallback = vi.fn(); const resolver = createSystemWebDnsResolver(async () => addresses, fallback);
      await expect(new NetworkPolicy(resolver).resolve('https://example.com', freshSignal())).rejects.toMatchObject({ code: 'URL_BLOCKED' });
      expect(fallback).not.toHaveBeenCalled();
    }
    const fallback = vi.fn(); const normal = createSystemWebDnsResolver(async () => [{ address: '93.184.216.34', family: 4 }], fallback);
    await new NetworkPolicy(normal).resolve('https://example.com', freshSignal()); expect(fallback).not.toHaveBeenCalled();
  });
  it('rejects private fallback answers, private literal IPs and cancellation', async () => {
    const fallback = vi.fn(async () => [{ address: '127.0.0.1', family: 4 }]);
    const resolver = createSystemWebDnsResolver(async () => [{ address: '198.18.0.6', family: 4 }], fallback);
    await expect(new NetworkPolicy(resolver).resolve('https://example.com', freshSignal())).rejects.toMatchObject({ code: 'URL_BLOCKED' });
    fallback.mockClear();
    await expect(new NetworkPolicy(resolver).resolve('https://198.18.0.6', freshSignal())).rejects.toMatchObject({ code: 'URL_BLOCKED' });
    const controller = new AbortController(); controller.abort();
    await expect(new NetworkPolicy(resolver).resolve('https://example.com', controller.signal)).rejects.toMatchObject({ code: 'ABORTED' });
    expect(fallback).not.toHaveBeenCalled();
  });
});
describe('product read-only capability policy', () => {
  it('omits mutation/external schemas and rejects write, edit and undo before approval or filesystem changes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'snipvia-readonly-')); directories.push(directory);
    await writeFile(join(directory, 'file.txt'), 'original');
    const prompt = vi.fn(async () => 'allow_once' as const);
    const system = createFileToolSystem({ readOnly: true, prompt });
    const workspace = await system.workspaces.authorizeWorkspace(directory);
    const names = system.registry.descriptors().map((tool) => tool.name);
    expect(names).toEqual(['read_file', 'list_directory', 'search_files']);
    for (const [name, input] of [['write_file', { path: 'file.txt', content: 'modified' }], ['edit_file', { path: 'file.txt', edits: [{ search: 'original', replace: 'changed' }] }]] as const) {
      expect(await system.executor.execute({ id: name, name, input }, { workspace })).toMatchObject({ success: false, error: { code: 'PERMISSION_DENIED' } });
    }
    expect(await system.executor.undo('any', { workspace })).toMatchObject({ success: false, error: { code: 'PERMISSION_DENIED' } });
    expect(prompt).not.toHaveBeenCalled(); expect(await readFile(join(directory, 'file.txt'), 'utf8')).toBe('original');
    expect(await system.executor.execute({ id: 'read', name: 'read_file', input: { path: 'file.txt' } }, { workspace })).toMatchObject({ success: true });
  });
  it('blocks external tools even if they claim read-only and keeps web tools available without workspace', async () => {
    const system = createFileToolSystem({ readOnly: true }); const execute = vi.fn();
    system.registry.register({ name: 'mcp_readonly', description: 'read-only claim', inputSchema: { type: 'object' }, permission: 'external:execute',
      external: { server: 'server', tool: 'file', fingerprint: 'x' }, parseInput: (input) => input, execute });
    expect(system.registry.descriptors().some((tool) => tool.name === 'mcp_readonly')).toBe(false);
    expect(await system.executor.execute({ id: 'external', name: 'mcp_readonly', input: {} })).toMatchObject({ success: false, error: { code: 'PERMISSION_DENIED' } });
    expect(execute).not.toHaveBeenCalled();
    const search = vi.fn(async () => ({ results: [{ title: 'Docs', url: 'https://example.com/', snippet: 'Example' }] }));
    registerWebTools(system.registry, { searchProvider: { id: 'mock', search } });
    expect(await system.executor.execute({ id: 'search', name: 'web_search', input: { query: 'Docs' } })).toMatchObject({ success: true, output: { results: [{ title: 'Docs' }] } });
    expect(system.registry.descriptors().map((tool) => tool.name)).toEqual(expect.arrayContaining(['web_search', 'fetch_url', 'read_web_chunk']));
  });
});

const result = (url: string, title = 'Example &amp; docs', snippet = 'Useful <b>text</b>') => `<div class="result results_links"><h2><a class="result__a" href="${url}">${title}</a></h2><a class="result__snippet">${snippet}</a></div>`;
describe('public HTML search adapter', () => {
  it('extracts standard results, unwraps links, bounds counts, omits ads, scripts and duplicates', async () => {
    const html = result('//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fdocs&amp;rut=abc') + result('https://example.com/docs', 'Duplicate') +
      '<div class="result result--ad"><a class="result__a" href="https://ads.example.com/">Advertisement</a></div>' +
      result('https://example.org', 'Second', 'Description<script>PRIVATE</script>') + result('https://example.net', 'Third');
    const response = await parseDuckDuckGoResults(html, 2, freshSignal());
    expect(response.results).toEqual([{ title: 'Example & docs', url: 'https://example.com/docs', snippet: 'Useful text' }, { title: 'Second', url: 'https://example.org/', snippet: 'Description' }]);
  });
  it('omits private, localhost and script links, including wrapped targets', async () => {
    const html = ['http://127.0.0.1/', 'http://192.168.1.2/', 'http://localhost/', 'javascript:alert(1)', '//duckduckgo.com/l/?uddg=http%3A%2F%2F10.0.0.1'].map((url) => result(url)).join('') + result('https://example.com');
    expect((await parseDuckDuckGoResults(html, 10, freshSignal())).results).toHaveLength(1);
  });
  it('distinguishes no results from a challenge or unrecognized page', async () => {
    expect(await parseDuckDuckGoResults('<div class="no-results">No results found</div>', 5, freshSignal())).toEqual({ results: [] });
    for (const html of ['<form id="challenge-form"></form>', '<div class="anomaly-modal">Verify</div>', '<h1>Unrecognized page</h1>']) {
      await expect(parseDuckDuckGoResults(html, 5, freshSignal())).rejects.toMatchObject({ code: 'SEARCH_FAILED' });
    }
  });
  it('uses fixed HTTPS URL, escaped query, response and redirect limits, and normalizes through existing service', async () => {
    const { client, open } = fakeHttp([webResponse(result('https://example.com/'))]);
    const provider = new DuckDuckGoWebSearchProvider(client);
    const response = await new WebSearchService(provider).search('a & b? 中文', 3, freshSignal());
    expect(response.results).toHaveLength(1);
    const url = open.mock.calls[0][0].url;
    expect(url.origin).toBe('https://html.duckduckgo.com'); expect(url.searchParams.get('q')).toBe('a & b? 中文');
    const redirect = fakeHttp([webResponse('', { location: 'http://127.0.0.1/' }, 302)]);
    await expect(new DuckDuckGoWebSearchProvider(redirect.client).search({ query: 'q', maxResults: 5, signal: freshSignal() })).rejects.toMatchObject({ code: 'REDIRECT_LIMIT' });
    expect(redirect.open).toHaveBeenCalledTimes(1);
  });
  it('caps payload and nesting, rejects HTTP challenge, and honors cancellation', async () => {
    await expect(parseDuckDuckGoResults('x'.repeat(512 * 1024 + 1), 5, freshSignal())).rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE' });
    await expect(parseDuckDuckGoResults('<div>'.repeat(130), 5, freshSignal())).rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE' });
    const { client } = fakeHttp([webResponse('captcha', {}, 202)]);
    await expect(new DuckDuckGoWebSearchProvider(client).search({ query: 'q', maxResults: 5, signal: freshSignal() })).rejects.toMatchObject({ code: 'SEARCH_FAILED' });
    const controller = new AbortController(); controller.abort();
    await expect(parseDuckDuckGoResults(result('https://example.com'), 5, controller.signal)).rejects.toMatchObject({ code: 'ABORTED' });
  });
});
