import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSearchService } from '../../src/main/agent/web/WebSearchService';
import { WebPageService } from '../../src/main/agent/web/WebPageService';
import { collectWebSources } from '../../src/main/agent/ui/WebSourceCollector';
import { WebIconService, boundedIcon } from '../../src/main/agent/web/WebIconService';
import { ContextManager } from '../../src/main/agent/ContextManager';
import { ToolError } from '../../src/main/agent/ToolError';
import { extractWebText } from '../../src/main/agent/web/htmlText';
import { sourceUrl } from '../../src/shared/agent/sources';
import { fakeHttp, freshSignal, webResponse } from './helpers/web';

const result = (id: string, domain = 'example.com') => ({ title: `Document ${id}`, url: `https://${domain}/${id}`, snippet: `Description ${id}` });
afterEach(() => vi.useRealTimers());

describe('multi-query research', () => {
  it('fuses complementary queries, strips tracking duplicates and rewards agreement while preserving domain diversity', async () => {
    const provider = { id: 'fixture', search: vi.fn(async ({ query }: { query: string }) => ({ results: query === 'official'
      ? [result('shared'), result('a'), result('b')]
      : [{ ...result('shared'), url: 'https://example.com/shared?utm_source=ad#fragment' }, result('issue', 'github.com'), result('c', 'docs.example.org')] })) };
    const output = await new WebSearchService(provider).searchMany(['official', 'issue', 'official'], 20, freshSignal());
    expect(provider.search).toHaveBeenCalledTimes(2);
    expect(output.results).toHaveLength(5); expect(output.results[0].url).toBe('https://example.com/shared');
    expect(output.results.slice(0, 3).some((item) => item.url.includes('github.com'))).toBe(true);
    expect(output.queries).toEqual([{ query: 'official', count: 3 }, { query: 'issue', count: 3 }]);
  });
  it('keeps 20 useful links within the actual tool feedback budget instead of dropping most long snippets', async () => {
    const provider = { id: 'fixture', search: async ({ query }: { query: string }) => ({ results: Array.from({ length: 12 }, (_, i) => ({ ...result(`${query}-${i}`), snippet: '关键证据'.repeat(80) })) }) };
    const output = await new WebSearchService(provider).searchMany(['a', 'b', 'c'], 20, freshSignal());
    expect(output.results).toHaveLength(20); expect(Buffer.byteLength(JSON.stringify(output))).toBeLessThanOrEqual(7000);
    expect(new ContextManager().toolFeedback({ success: true, output }, 8192).result).toMatchObject({ output: { results: expect.arrayContaining([output.results[19]]) } });
  });
  it('retains successful results when another query fails, without leaking provider errors', async () => {
    const service = new WebSearchService({ id: 'fixture', search: async ({ query }) => {
      if (query === 'bad') throw new Error('SECRET_KEY=hidden');
      return { results: [result(query)] };
    } });
    const output = await service.searchMany(['bad', 'ok'], 8, freshSignal());
    expect(output.partial).toBe(true); expect(output.results).toHaveLength(1);
    expect(output.queries?.[0]).toEqual({ query: 'bad', count: 0, error: 'SEARCH_FAILED' });
    expect(JSON.stringify(output)).not.toContain('hidden');
    await expect(service.searchMany(['bad'], 8, freshSignal())).rejects.toMatchObject({ code: 'SEARCH_FAILED' });
  });
  it('times out one slow batch query without discarding another successful query', async () => {
    let aborted = false;
    const service = new WebSearchService({ id: 'fixture', search: async ({ query, signal }) => {
      if (query === 'ok') return { results: [result('ok')] };
      signal.addEventListener('abort', () => { aborted = true; }); return new Promise(() => {});
    } }, 25);
    const scope = {}; await service.search('ok', 8, freshSignal(), scope);
    vi.useFakeTimers();
    const pending = service.searchMany(['slow', 'ok'], 8, freshSignal(), scope);
    const check = expect(pending).resolves.toMatchObject({ partial: true, results: [result('ok')] });
    await vi.advanceTimersByTimeAsync(30);
    await check; expect(aborted).toBe(true);
  });
  it('limits a batch to three requests and cancels all in-flight queries after user Stop', async () => {
    const signals: AbortSignal[] = [];
    const service = new WebSearchService({ id: 'fixture', search: async ({ signal }) => { signals.push(signal); return new Promise(() => {}); } });
    const controller = new AbortController(); const pending = service.searchMany(['a', 'b', 'c'], 8, controller.signal);
    const check = expect(pending).rejects.toMatchObject({ code: 'ABORTED' });
    await vi.waitFor(() => expect(signals).toHaveLength(3)); controller.abort(); await check;
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });
  it('caches only successful searches within one conversation scope and expires them', async () => {
    const search = vi.fn(async () => ({ results: [result('cached')] })); const service = new WebSearchService({ id: 'fixture', search }); const scope = {};
    const first = await service.search('query', 8, freshSignal(), scope); first.results.length = 0;
    expect((await service.search('query', 8, freshSignal(), scope)).results).toHaveLength(1); expect(search).toHaveBeenCalledTimes(1);
    await service.search('query', 8, freshSignal(), {}); expect(search).toHaveBeenCalledTimes(2);
    const now = Date.now(); const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 121_000);
    await service.search('query', 8, freshSignal(), scope); clock.mockRestore(); expect(search).toHaveBeenCalledTimes(3);
  });
});

describe('relevant page reading', () => {
  it('prefers main/article content even when boilerplate before it exhausts the output budget', async () => {
    const output = await extractWebText(`<div>${'irrelevant '.repeat(200)}</div><main><h1>Actual article</h1><p>Fix the error.</p></main>`, true, freshSignal(), 100);
    expect(output.text).toContain('Actual article'); expect(output.text).toContain('Fix the error.'); expect(output.text).not.toContain('irrelevant'); expect(output.truncated).toBe(false);
  });
  it('retains separate article boundaries and falls back to body for non-semantic pages', async () => {
    expect((await extractWebText('<article>one</article><article>two</article>', true, freshSignal())).text).toBe('one\ntwo');
    expect((await extractWebText('<div>useful body</div><main></main>', true, freshSignal())).text).toBe('useful body');
  });
  it('finds late evidence and preserves exact offsets and full-page chunk access', async () => {
    const content = `<title>Technical guide</title><main><p>${'Introduction. '.repeat(600)}</p><p>macOS 27 Steam OS error 0: check the installation files.</p><p>${'Appendix. '.repeat(600)}</p></main>`;
    const { client, open } = fakeHttp([webResponse(content)]); const pages = new WebPageService(client); const scope = {};
    const output = await pages.fetch('https://example.com/guide', scope, freshSignal(), 'macOS 27 Steam OS error 0');
    expect(output.text).toContain('check the installation files'); expect(output.metadata.offset).toBeGreaterThan(0);
    expect(output.metadata.selection).toBe('focused');
    expect(pages.contents.read(scope, output.metadata.contentId, 0).text).toContain('Introduction.');
    const next = pages.contents.read(scope, output.metadata.contentId, output.metadata.nextOffset!);
    expect(next.metadata.offset).toBe(output.metadata.offset + output.text.length); expect(open).toHaveBeenCalledOnce();
  });
});

describe('verified source projection', () => {
  it('deduplicates search/read URLs, promotes read evidence and never invents publication dates', () => {
    const searched = collectWebSources([], 'web_search', { results: [result('guide'), { ...result('guide'), url: 'https://example.com/guide?utm_source=x' }, { ...result('bad'), url: 'http://127.0.0.1' }] });
    expect(searched).toHaveLength(1); expect(searched[0]).toMatchObject({ read: false }); expect(searched[0].publishedAt).toBeUndefined();
    const read = collectWebSources(searched, 'fetch_url', { url: searched[0].url, title: 'Full article', text: 'Read evidence', metadata: { fetchedAt: '2026-09-27' } });
    expect(read[0]).toMatchObject({ read: true, title: 'Full article', snippet: 'Read evidence' }); expect(read[0].publishedAt).toBeUndefined();
    expect(searched[0].read).toBe(false);
    expect(collectWebSources(read, 'made_up_tool', { results: [result('x')] })).toEqual(read);
  });
  it('bounds source count and preserves meaningful URL query parameters', () => {
    expect(sourceUrl('https://example.com/?id=2&utm_campaign=x#section')).toBe('https://example.com/?id=2');
    expect(sourceUrl('javascript:alert(1)')).toBeNull();
    expect(collectWebSources([], 'web_search', { results: Array.from({ length: 100 }, (_, i) => result(String(i))) })).toHaveLength(60);
  });
});

describe('bounded source icons', () => {
  const png = () => { const bytes = Buffer.alloc(24); Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes); bytes.writeUInt32BE(16, 16); bytes.writeUInt32BE(16, 20); return bytes; };
  it('rejects SVG, oversized dimensions, truncated ICO and huge buffers before native decoding', () => {
    expect(boundedIcon(png())).toBe(true);
    const large = png(); large.writeUInt32BE(100000, 16);
    for (const input of [large, Buffer.from('<svg/>'), Buffer.alloc(70_000), Buffer.from([0, 0, 1, 0, 1, 0])]) expect(boundedIcon(input)).toBe(false);
  });
  it('fetches only same-origin favicon, caches success/failure and rejects private URLs', async () => {
    const { client, open } = fakeHttp([webResponse(png(), { 'content-type': 'image/png' })]); const decode = vi.fn(() => 'data:image/png;base64,fixture');
    const service = new WebIconService(decode, client);
    expect(await service.get('https://example.com/private/path?q=secret')).toBe('data:image/png;base64,fixture');
    await service.get('https://example.com/another'); expect(open).toHaveBeenCalledOnce();
    expect(open.mock.calls[0][0].url.href).toBe('https://example.com/favicon.ico');
    expect(() => service.get('http://127.0.0.1')).toThrow(ToolError);
  });
});
