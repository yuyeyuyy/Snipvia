import { z } from 'zod';
import type { WebSearchProvider, WebSearchRequest, WebSearchResponse } from './WebSearchProvider';
import { PublicHttpClient } from './PublicHttpClient';
import { ToolError, throwIfAborted } from '../ToolError';

const braveResponse = z.object({ web: z.object({ results: z.array(z.object({
  title: z.string().max(2048), url: z.string().max(2048), description: z.string().max(20_000).optional(),
  extra_snippets: z.array(z.string().max(4000)).max(5).optional(), page_age: z.string().max(100).optional()
})).max(100) }).optional() });

/** Optional adapter. A dedicated search credential is provided only by trusted Main. */
export class BraveWebSearchProvider implements WebSearchProvider {
  readonly id = 'brave';
  constructor(private readonly getApiKey: () => string | undefined | Promise<string | undefined>, private readonly http = new PublicHttpClient()) {}
  async search(request: WebSearchRequest): Promise<WebSearchResponse> {
    const key = await this.getApiKey();
    throwIfAborted(request.signal);
    if (!key) throw new ToolError('SEARCH_NOT_CONFIGURED', '尚未配置 Brave 搜索密钥');
    const url = new URL('https://api.search.brave.com/res/v1/web/search');
    url.searchParams.set('q', request.query);
    url.searchParams.set('count', String(request.maxResults));
    url.searchParams.set('extra_snippets', 'true');
    const response = await this.http.get(url.href, { signal: request.signal, acceptedTypes: ['application/json'], maxBytes: 512 * 1024,
      maxRedirects: 0, headers: { 'X-Subscription-Token': key } });
    let parsed: z.infer<typeof braveResponse>;
    try { parsed = braveResponse.parse(JSON.parse(response.bytes.toString('utf8'))); }
    catch { throw new ToolError('INVALID_RESULT', 'Brave 搜索响应无法解析'); }
    return { results: (parsed.web?.results ?? []).map((item) => ({ title: item.title, url: item.url,
      snippet: [...new Set([item.description ?? '', ...(item.extra_snippets ?? [])])].join(' ').slice(0, 20_000),
      ...(item.page_age ? { publishedAt: item.page_age } : {}) })) };
  }
}
