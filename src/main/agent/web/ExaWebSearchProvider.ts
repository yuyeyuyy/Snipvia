import { z } from 'zod';
import type { WebSearchProvider, WebSearchRequest, WebSearchResponse } from './WebSearchProvider';
import { PublicHttpClient } from './PublicHttpClient';
import { publicWebUrl } from './NetworkPolicy';
import { ToolError, throwIfAborted } from '../ToolError';

const endpoint = 'https://mcp.exa.ai/mcp?tools=web_search_advanced_exa';
const rpcSchema = z.object({ jsonrpc: z.literal('2.0'), id: z.literal(1), error: z.unknown().optional(), result: z.object({
  isError: z.boolean().optional(), content: z.array(z.object({ type: z.string(), text: z.string().optional() })).max(100)
}).optional() });
const searchSchema = z.object({ results: z.array(z.object({
  url: z.string().max(2048), title: z.string().nullish(), text: z.string().nullish(),
  highlights: z.array(z.string()).max(100).nullish(), publishedDate: z.string().nullish()
})).max(100) });

/** Fixed, read-only hosted MCP call; not a dynamic MCP server or a tool execution bypass. */
export class ExaWebSearchProvider implements WebSearchProvider {
  readonly id = 'exa';
  constructor(private readonly http = new PublicHttpClient(), private readonly getApiKey: () => string | undefined = () => undefined) {}
  async search(request: WebSearchRequest): Promise<WebSearchResponse> {
    throwIfAborted(request.signal);
    const domains: string[] = [];
    const query = request.query.replace(/(?:^|\s)site:([a-zA-Z0-9.-]+(?:\/[a-zA-Z0-9_./%-]*)?)/g, (_match, site: string) => {
      try { const url = publicWebUrl(`https://${site}`); domains.push(url.hostname + (url.pathname === '/' ? '' : url.pathname)); }
      catch { throw new ToolError('URL_BLOCKED', '搜索域名必须为公网域名'); }
      return ' ';
    }).trim() || request.query;
    const key = this.getApiKey();
    const response = await this.http.postJson(endpoint, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: {
      name: 'web_search_advanced_exa', arguments: { query, numResults: request.maxResults, type: 'auto',
        textMaxCharacters: 1000, enableHighlights: true, highlightsMaxCharacters: 800, highlightsQuery: request.query,
        ...(domains.length ? { includeDomains: [...new Set(domains)] } : {}) }
    } }, { signal: request.signal, acceptedTypes: ['application/json', 'text/event-stream'], maxBytes: 512 * 1024,
      ...(key ? { headers: { 'x-api-key': key } } : {}) });
    throwIfAborted(request.signal);
    const body = response.bytes.toString('utf8').trim();
    // Streamable HTTP may return one JSON object or SSE frames (including notifications).
    const payloads = response.contentType === 'text/event-stream'
      ? body.replace(/\r\n/g, '\n').split('\n\n').map((frame) => frame.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n')).filter(Boolean)
      : [body];
    for (const payload of payloads) {
      let value: unknown;
      try { value = JSON.parse(payload); } catch { continue; }
      const rpc = rpcSchema.safeParse(value);
      if (!rpc.success) continue;
      if (rpc.data.error || rpc.data.result?.isError) throw new ToolError('SEARCH_FAILED', 'Exa 搜索暂不可用或已达到服务限额');
      for (const content of rpc.data.result?.content ?? []) {
        if (content.type !== 'text' || !content.text) continue;
        if (content.text.startsWith('No search results found.')) return { results: [] };
        let results: z.infer<typeof searchSchema>;
        try { results = searchSchema.parse(JSON.parse(content.text)); } catch { continue; }
        return { results: results.results.slice(0, request.maxResults).map((item) => ({ url: item.url,
          title: (item.title ?? '').slice(0, 2048), snippet: (item.highlights?.length ? item.highlights.join('\n') : item.text ?? '').slice(0, 20_000),
          ...(item.publishedDate ? { publishedAt: item.publishedDate.slice(0, 100) } : {}) })) };
      }
    }
    throw new ToolError('INVALID_RESULT', 'Exa 搜索响应无法解析');
  }
}
