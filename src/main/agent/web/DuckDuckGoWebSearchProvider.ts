import { Parser } from 'htmlparser2';
import { setImmediate } from 'node:timers/promises';
import type { WebSearchProvider, WebSearchRequest, WebSearchResponse, WebSearchResult } from './WebSearchProvider';
import { PublicHttpClient } from './PublicHttpClient';
import { publicWebUrl } from './NetworkPolicy';
import { utf8Prefix } from './operation';
import { ToolError, throwIfAborted } from '../ToolError';

const endpoint = 'https://html.duckduckgo.com/html/';
const hiddenTags = new Set(['script', 'style', 'noscript', 'template', 'iframe', 'svg']);

/** Public HTML search, not an authenticated API. Challenges/layout changes are explicit failures. */
export class DuckDuckGoWebSearchProvider implements WebSearchProvider {
  readonly id = 'duckduckgo-html';
  constructor(private readonly http = new PublicHttpClient()) {}
  async search(request: WebSearchRequest): Promise<WebSearchResponse> {
    throwIfAborted(request.signal);
    const url = new URL(endpoint); url.searchParams.set('q', request.query);
    const response = await this.http.get(url.href, { signal: request.signal, acceptedTypes: ['text/html'], maxBytes: 512 * 1024, maxRedirects: 0 });
    if (response.status !== 200) throw new ToolError('SEARCH_FAILED', '搜索服务暂不可用或要求验证，请稍后重试或配置专用搜索服务');
    return parseDuckDuckGoResults(response.bytes.toString('utf8'), request.maxResults, request.signal);
  }
}

export async function parseDuckDuckGoResults(html: string, maxResults: number, signal: AbortSignal): Promise<WebSearchResponse> {
  throwIfAborted(signal);
  if (Buffer.byteLength(html) > 512 * 1024) throw new ToolError('RESPONSE_TOO_LARGE', '搜索页面超过大小上限');
  const results: WebSearchResult[] = []; const seen = new Set<string>();
  const stack: Array<{ hidden: boolean; entry?: WebSearchResult; part?: 'title' | 'snippet'; root?: boolean }> = [];
  let noResults = false; let challenge = false;
  const parser = new Parser({
    onopentag(name, attributes) {
      if (stack.length >= 128) throw new ToolError('RESPONSE_TOO_LARGE', '搜索页面嵌套过深');
      const classes = new Set((attributes.class ?? '').split(/\s+/)); const parent = stack.at(-1);
      if (classes.has('no-results')) noResults = true;
      if (/anomaly|challenge|captcha/i.test(`${attributes.id ?? ''} ${attributes.class ?? ''}`)) challenge = true;
      const hidden = Boolean(parent?.hidden || hiddenTags.has(name) || classes.has('result--ad') || 'hidden' in attributes || attributes['aria-hidden'] === 'true');
      const root = !hidden && classes.has('result');
      const entry = root ? { title: '', url: '', snippet: '' } : parent?.entry;
      const part = classes.has('result__a') ? 'title' : classes.has('result__snippet') ? 'snippet' : parent?.part;
      if (!hidden && entry && classes.has('result__a') && attributes.href) {
        try {
          const link = new URL(attributes.href, endpoint);
          entry.url = publicWebUrl(link.hostname === 'duckduckgo.com' && link.pathname === '/l/'
            ? link.searchParams.get('uddg') ?? '' : link.href).href;
        } catch { /* Invalid/private result links are omitted, never followed. */ }
      }
      stack.push({ hidden, entry, part, root });
    },
    ontext(text) {
      const current = stack.at(-1);
      if (!current?.hidden && current?.entry && current.part) {
        const part = current.part;
        current.entry[part] = utf8Prefix(current.entry[part] + text, part === 'title' ? 2048 : 20_000);
      }
    },
    onclosetag() {
      const current = stack.pop(); const entry = current?.entry;
      if (current?.root && entry?.url && entry.title.trim() && results.length < maxResults && !seen.has(entry.url)) {
        seen.add(entry.url); results.push({ ...entry, title: entry.title.replace(/\s+/g, ' ').trim(), snippet: entry.snippet.replace(/\s+/g, ' ').trim() });
      }
    }
  }, { decodeEntities: true });
  for (let offset = 0; offset < html.length; offset += 16 * 1024) {
    throwIfAborted(signal); parser.write(html.slice(offset, offset + 16 * 1024));
    await setImmediate(undefined, { signal }).catch(() => { throwIfAborted(signal); });
  }
  parser.end(); throwIfAborted(signal);
  if (challenge) throw new ToolError('SEARCH_FAILED', '搜索服务要求验证，请稍后重试或配置专用搜索服务');
  if (!results.length && !noResults) throw new ToolError('SEARCH_FAILED', '无法读取搜索结果，服务可能限流或页面格式已变化');
  return { results };
}
