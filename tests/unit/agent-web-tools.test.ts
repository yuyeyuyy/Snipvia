import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToolRegistry, defineWebTool } from '../../src/main/agent/ToolRegistry';
import { ToolExecutor } from '../../src/main/agent/ToolExecutor';
import { WorkspaceService } from '../../src/main/agent/WorkspaceService';
import { registerWebTools } from '../../src/main/agent/registerWebTools';
import { WebContentStore, type StoredWebContent, type WebContentOutput } from '../../src/main/agent/web/WebContentStore';
import { WebPageService } from '../../src/main/agent/web/WebPageService';
import { WebSearchService } from '../../src/main/agent/web/WebSearchService';
import { BraveWebSearchProvider } from '../../src/main/agent/web/BraveWebSearchProvider';
import type { WebSearchProvider } from '../../src/main/agent/web/WebSearchProvider';
import { extractWebText } from '../../src/main/agent/web/htmlText';
import { utf8Prefix } from '../../src/main/agent/web/operation';
import { ContextManager } from '../../src/main/agent/ContextManager';
import { AgentLoop } from '../../src/main/agent/AgentLoop';
import type { AgentChatRequest, LLMProvider } from '../../src/main/ai/llm/LLMProvider';
import type { AgentChatResponse } from '../../src/shared/agent/message';
import { z } from 'zod';
import { fakeHttp, freshSignal, webResponse } from './helpers/web';

afterEach(() => { vi.useRealTimers(); });
const stored = (text = 'text'): StoredWebContent => ({ url: 'https://example.com/', title: 'example', text,
  contentType: 'text/html', charset: 'utf-8', downloadedBytes: 100, decodedBytes: 100, extractionTruncated: false });

describe('clean text extraction', () => {
  it('removes scripts/styles/comments/forms/hidden subtrees and decodes HTML entities', async () => {
    const html = `<!doctype html><html><head><title>Title &amp; More</title><script>HEAD_SECRET()</script><style>.x{}</style></head>
      <body><nav>menu</nav><!-- comment --><main><h1>Heading</h1><p>Hello <b>world</b> &amp; &#x4F60;&#x597D;.</p>
      <script>document.write('<p>EVIL</p>')</script><style>STYLE</style><div hidden>HIDDEN</div><div aria-hidden="true">ARIA</div>
      <div style="display: none">INVISIBLE</div><form>FORM</form><template>TEMPLATE</template><iframe src="http://127.0.0.1/">FRAME</iframe>
      <p>Next<br>Line</p></main><footer>Footer</footer></body></html>`;
    const output = await extractWebText(html, true, freshSignal());
    expect(output.title).toBe('Title & More');
    expect(output.text).toContain('Heading'); expect(output.text).toContain('Hello world & 你好.'); expect(output.text).toContain('Next\nLine');
    for (const ignored of ['HEAD_SECRET', 'EVIL', 'STYLE', 'HIDDEN', 'ARIA', 'INVISIBLE', 'FORM', 'TEMPLATE', 'FRAME', 'Footer', '<p>', 'comment', 'menu']) expect(output.text).not.toContain(ignored);
  });
  it('preserves table cell separators, lists and preformatted code', async () => {
    const output = await extractWebText('<ul><li>One</li><li>Two</li></ul><table><tr><td>A</td><td>B</td></tr></table><pre>  const a = 1;\n    return a;</pre>', true, freshSignal());
    expect(output.text).toContain('• One'); expect(output.text).toContain('A\tB'); expect(output.text).toContain('\n    return a;');
  });
  it('does not merge paragraphs in malformed HTML', async () => {
    expect((await extractWebText('<p>First<p>Second<div>Third', true, freshSignal())).text.split(/\n+/)).toEqual(['First', 'Second', 'Third']);
  });
  it('truncates clean UTF-8 text without splitting a code point', async () => {
    const output = await extractWebText(`<p>${'你好😀'.repeat(5000)}</p>`, true, freshSignal(), 127);
    expect(output.truncated).toBe(true); expect(Buffer.byteLength(output.text)).toBeLessThanOrEqual(127); expect(output.text).not.toContain('\ufffd');
    expect(utf8Prefix('你😀好', 6)).toBe('你');
  });
  it('does not misinterpret plain text as markup and strips unsafe control characters', async () => {
    const output = await extractWebText('<script>literal code</script>\r\n\0next', false, freshSignal());
    expect(output.text).toBe('<script>literal code</script>\nnext');
  });
  it('caps pathological nesting and honors cancellation during parsing', async () => {
    await expect(extractWebText('<div>'.repeat(300), true, freshSignal())).rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE' });
    const controller = new AbortController(); const pending = extractWebText('<p>text</p>'.repeat(100_000), true, controller.signal);
    const check = expect(pending).rejects.toMatchObject({ code: 'ABORTED' }); controller.abort(); await check;
  });
});

describe('web page snapshots and chunks', () => {
  it('fetch returns normalized title/text/metadata and never executable HTML', async () => {
    const { client } = fakeHttp([webResponse('<title>你好</title><p>正文</p><script>secret()</script>')]);
    const output = await new WebPageService(client).fetch('https://example.com/a#b', {}, freshSignal());
    expect(output).toMatchObject({ url: 'https://example.com/a', title: '你好', text: '正文', metadata: { truncated: false, nextOffset: null, source: 'untrusted_web' } });
    expect(output.metadata.downloadedBytes).toBeGreaterThan(0);
  });
  it('chunks reconstruct a retained document without duplication, missing Unicode or another network fetch', () => {
    const store = new WebContentStore(); const owner = {}; const original = '段落 "test" 😀\n'.repeat(5000);
    let part = store.put(owner, stored(original)); let combined = part.text; let steps = 1;
    while (part.metadata.nextOffset !== null) {
      const offset = part.metadata.nextOffset; part = store.read(owner, part.metadata.contentId, offset);
      expect(part.metadata.offset).toBe(offset); expect(Buffer.byteLength(JSON.stringify(part))).toBeLessThanOrEqual(7000);
      combined += part.text; steps++;
    }
    expect(steps).toBeGreaterThan(2); expect(combined).toBe(original); expect(part.metadata.truncated).toBe(false);
  });
  it('retains the chunk cursor under ContextManager default result limit including JSON escaping', () => {
    const store = new WebContentStore(); const owner = {};
    const output = store.put(owner, stored('"\\\n\t'.repeat(20_000)));
    const context = new ContextManager();
    const feedback = context.toolFeedback({ success: true, output, metadata: { toolCallId: 'x'.repeat(128), toolName: 'fetch_url', durationMs: 12 } }, 8192);
    expect(feedback.result).toMatchObject({ output: { metadata: { contentId: output.metadata.contentId, nextOffset: output.text.length } } });
    expect(Buffer.byteLength(feedback.content)).toBeLessThan(8192);
  });
  it('does not authorize content by ID alone, rejects forged offsets and expires documents', async () => {
    vi.useFakeTimers(); const store = new WebContentStore(20); const owner = {}; const part = store.put(owner, stored('😀more'));
    expect(() => store.read({}, part.metadata.contentId, 0)).toThrow(expect.objectContaining({ code: 'CONTENT_UNAVAILABLE' }));
    for (const offset of [-1, 1, 99, 0.5]) expect(() => store.read(owner, part.metadata.contentId, offset)).toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }));
    await vi.advanceTimersByTimeAsync(21);
    expect(() => store.read(owner, part.metadata.contentId, 0)).toThrow(expect.objectContaining({ code: 'CONTENT_UNAVAILABLE' }));
  });
  it('bounds cache count, supports clear and marks text omitted beyond the extraction limit', () => {
    const store = new WebContentStore(); const owner = {}; const first = store.put(owner, stored());
    for (let i = 0; i < 16; i++) store.put(owner, stored());
    expect(() => store.read(owner, first.metadata.contentId, 0)).toThrow();
    const trimmed = store.put(owner, { ...stored('prefix'), extractionTruncated: true });
    expect(trimmed.metadata).toMatchObject({ extractionTruncated: true, truncated: true, nextOffset: null });
    store.clear(owner); expect(() => store.read(owner, trimmed.metadata.contentId, 0)).toThrow();
  });
  it('decodes the declared charset and explicitly rejects unsupported encodings', async () => {
    const good = fakeHttp([webResponse(Buffer.from([0x63, 0x61, 0x66, 0xe9]), { 'content-type': 'text/plain; charset=windows-1252' })]);
    expect((await new WebPageService(good.client).fetch('https://example.com', {}, freshSignal())).text).toBe('café');
    const bad = fakeHttp([webResponse('text', { 'content-type': 'text/plain; charset=not-a-charset' })]);
    await expect(new WebPageService(bad.client).fetch('https://example.com', {}, freshSignal())).rejects.toMatchObject({ code: 'UNSUPPORTED_ENCODING' });
  });
});

describe('provider-independent web search', () => {
  it('standardizes results, cleans fragments, removes duplicates and rejects unsafe result URLs', async () => {
    const search = vi.fn(async () => ({ results: [
      { title: '<b>Title</b>', url: 'https://example.com/a#b', snippet: 'An &amp; <b>example</b><script>evil</script>' },
      { title: 'duplicate', url: 'https://example.com/a', snippet: 'same' },
      { title: 'private', url: 'http://127.0.0.1', snippet: 'bad' },
      { title: 'script', url: 'javascript:alert(1)', snippet: 'bad' },
      { title: 'second', url: 'https://example.org', snippet: 'two' }
    ] }));
    const output = await new WebSearchService({ id: 'custom', search }).search('query', 2, freshSignal());
    expect(output).toEqual({ results: [
      { title: 'Title', url: 'https://example.com/a', snippet: 'An & example' },
      { title: 'second', url: 'https://example.org/', snippet: 'two' }
    ] });
    expect(search).toHaveBeenCalledWith(expect.objectContaining({ query: 'query', maxResults: 2, signal: expect.any(AbortSignal) }));
  });
  it('caps result payload including escaped snippets and long URLs', async () => {
    const service = new WebSearchService({ id: 'large', search: async () => ({ results: Array.from({ length: 10 }, (_, i) => ({
      title: '标题'.repeat(100), url: `https://example.com/${i}?q=${'a'.repeat(1800)}`, snippet: '"\\\n'.repeat(5000)
    })) }) });
    const output = await service.search('query', 10, freshSignal());
    expect(output.results.length).toBeGreaterThan(0); expect(Buffer.byteLength(JSON.stringify(output))).toBeLessThanOrEqual(7000);
  });
  it('reports missing configuration, invalid provider data and sanitized provider failures', async () => {
    await expect(new WebSearchService().search('query', 5, freshSignal())).rejects.toMatchObject({ code: 'SEARCH_NOT_CONFIGURED' });
    const invalid: WebSearchProvider = { id: 'invalid', search: async () => ({ results: [{ url: 'bad' }] } as never) };
    await expect(new WebSearchService(invalid).search('query', 5, freshSignal())).rejects.toMatchObject({ code: 'INVALID_RESULT' });
    const fail: WebSearchProvider = { id: 'failed', search: async () => { throw new Error('API_KEY=secret'); } };
    await expect(new WebSearchService(fail).search('query', 5, freshSignal())).rejects.toMatchObject({ code: 'SEARCH_FAILED', message: '搜索服务请求失败' });
  });
  it('times out and aborts a provider, ignoring results after cancellation', async () => {
    vi.useFakeTimers(); let providerSignal: AbortSignal | undefined;
    const service = new WebSearchService({ id: 'hang', search: async (request) => { providerSignal = request.signal; return new Promise(() => {}); } }, 20);
    const pending = service.search('query', 5, freshSignal()); const check = expect(pending).rejects.toMatchObject({ code: 'TIMEOUT' });
    await vi.advanceTimersByTimeAsync(20); await check; expect(providerSignal?.aborted).toBe(true); expect(vi.getTimerCount()).toBe(0);
  });
  it('Brave adapter keeps credentials out of URL/output and disallows all redirects', async () => {
    const { client, open } = fakeHttp([webResponse(JSON.stringify({ web: { results: [{ title: 'Result', url: 'https://example.com', description: 'snippet' }] } }), { 'content-type': 'application/json' })]);
    const provider = new BraveWebSearchProvider(() => 'synthetic-key', client);
    expect(await provider.search({ query: '你好 test', maxResults: 2, signal: freshSignal() })).toEqual({ results: [{ title: 'Result', url: 'https://example.com', snippet: 'snippet' }] });
    expect(open.mock.calls[0][0].url.searchParams.get('q')).toBe('你好 test');
    expect(open.mock.calls[0][0].url.href).not.toContain('synthetic-key'); expect(open.mock.calls[0][2]['X-Subscription-Token']).toBe('synthetic-key');
    const redirected = fakeHttp([webResponse('', { location: 'https://other.example.com' }, 302)]);
    await expect(new BraveWebSearchProvider(() => 'synthetic-key', redirected.client).search({ query: 'q', maxResults: 1, signal: freshSignal() })).rejects.toMatchObject({ code: 'REDIRECT_LIMIT' });
    expect(redirected.open).toHaveBeenCalledOnce();
  });
});

describe('web tools through Registry / Executor / AgentLoop', () => {
  it('registers narrow schemas, applies defaults, and does not require filesystem authorization', async () => {
    const registry = new ToolRegistry(); const search = vi.fn(async () => ({ results: [] }));
    const http = fakeHttp([webResponse('<p>hello</p>')]); registerWebTools(registry, { http: http.client, searchProvider: { id: 'custom', search } });
    const executor = new ToolExecutor(registry, new WorkspaceService());
    expect(registry.descriptors().map((tool) => tool.name)).toEqual(['web_search', 'fetch_url', 'read_web_chunk']);
    expect(await executor.execute({ id: 'search', name: 'web_search', input: { query: ' hello ' } })).toMatchObject({ success: true, output: { results: [] } });
    expect(search.mock.calls[0]).toEqual([expect.objectContaining({ query: 'hello', maxResults: 8 })]);
    expect(await executor.execute({ id: 'fetch', name: 'fetch_url', input: { url: 'https://example.com' } })).toMatchObject({ success: true, output: { text: 'hello' } });
    for (const input of [{ query: '' }, { query: 'a', maxResults: 0 }, { query: 'a', maxResults: 21 }, { query: 'a', apiKey: 'injected' }]) {
      expect(await executor.execute({ id: 'invalid', name: 'web_search', input })).toMatchObject({ error: { code: 'INVALID_INPUT' } });
    }
    expect(await executor.execute({ id: 'headers', name: 'fetch_url', input: { url: 'https://example.com', headers: { Cookie: 'secret' } } })).toMatchObject({ error: { code: 'INVALID_INPUT' } });
  });
  it('never passes workspace fs access to a network tool', async () => {
    const registry = new ToolRegistry(); let leaked = false;
    registry.register(defineWebTool({ name: 'fetch_url', description: 'context check', schema: z.strictObject({}), execute: async (_input, context) => {
      leaked = 'workspace' in context; return { success: true, output: true };
    } }));
    expect(await new ToolExecutor(registry, new WorkspaceService()).execute({ id: 'check', name: 'fetch_url', input: {} })).toMatchObject({ success: true });
    expect(leaked).toBe(false);
  });
  it('continues chunks in one permission session, rejects another session and cancellation', async () => {
    const registry = new ToolRegistry(); const http = fakeHttp([webResponse(`<p>${'content '.repeat(2000)}</p>`)]);
    registerWebTools(registry, { http: http.client }); const executor = new ToolExecutor(registry, new WorkspaceService()); const session = executor.createPermissionSession();
    const fetched = await executor.execute({ id: 'fetch', name: 'fetch_url', input: { url: 'https://example.com' } }, { session });
    const output = fetched.output as WebContentOutput;
    const call = { id: 'chunk', name: 'read_web_chunk', input: { contentId: output.metadata.contentId, offset: output.metadata.nextOffset } };
    expect(await executor.execute(call, { session })).toMatchObject({ success: true });
    expect(await executor.execute(call, { session: executor.createPermissionSession() })).toMatchObject({ error: { code: 'CONTENT_UNAVAILABLE' } });
    executor.endPermissionSession(session);
    expect(await executor.execute(call, { session })).toMatchObject({ error: { code: 'ABORTED' } });
    expect(http.open).toHaveBeenCalledOnce();
  });
  it('AgentLoop can fetch then read another chunk without knowing the search supplier', async () => {
    const registry = new ToolRegistry(); const http = fakeHttp([webResponse(`<p>${'content '.repeat(3000)}</p>`)]); registerWebTools(registry, { http: http.client });
    const executor = new ToolExecutor(registry, new WorkspaceService()); let step = 0;
    const llm: LLMProvider = { id: 'test', chat: async (request: AgentChatRequest): Promise<AgentChatResponse> => {
      step++;
      if (step === 1) return { content: '', finishReason: 'tool_calls', toolCalls: [{ id: 'fetch', name: 'fetch_url', arguments: '{"url":"https://example.com"}' }] };
      if (step === 2) {
        const previous = request.messages.at(-1)!;
        if (previous.role !== 'tool') throw new Error('expected tool');
        const result = JSON.parse(previous.content) as { output: WebContentOutput };
        return { content: '', finishReason: 'tool_calls', toolCalls: [{ id: 'chunk', name: 'read_web_chunk', arguments: JSON.stringify({ contentId: result.output.metadata.contentId, offset: result.output.metadata.nextOffset }) }] };
      }
      return { content: '已读取两段，后续仍有内容。', finishReason: 'stop' };
    } };
    const result = await new AgentLoop({ provider: llm, registry, executor }).run({ message: '阅读网页' });
    expect(result).toMatchObject({ status: 'completed', toolCalls: 2 }); expect(http.open).toHaveBeenCalledOnce();
    expect(result.messages.filter((message) => message.role === 'tool').every((message) => JSON.parse(message.content).success)).toBe(true);
  });
});
