import { z } from 'zod';
import type { WebSearchProvider, WebSearchResponse, WebSearchResult } from './WebSearchProvider';
import { publicWebUrl } from './NetworkPolicy';
import { sourceUrl, publicationDate } from '../../../shared/agent/sources';
import { extractWebText } from './htmlText';
import { utf8Prefix, webOperation } from './operation';
import { ToolError, throwIfAborted } from '../ToolError';

const responseSchema = z.object({ results: z.array(z.object({ title: z.string().max(2048), url: z.string().max(2048), snippet: z.string().max(20_000), publishedAt: z.string().max(100).optional() })).max(100) });

/** Keep useful links before discarding whole results to meet the tool context budget. */
function bounded(response: WebSearchResponse): WebSearchResponse {
  const output = structuredClone(response);
  for (const limit of [600, 400, 240, 120, 0]) {
    if (Buffer.byteLength(JSON.stringify(output)) <= 7000) break;
    output.results = output.results.map((item) => ({ ...item, snippet: utf8Prefix(item.snippet, limit) }));
  }
  while (Buffer.byteLength(JSON.stringify(output)) > 7000 && output.results.length) output.results.pop();
  return output;
}

/** Reciprocal rank fusion rewards agreement without treating engine position as truth. */
function mergeResults(responses: WebSearchResponse[], maximum: number): WebSearchResult[] {
  const matches = new Map<string, { result: WebSearchResult; score: number; order: number }>();
  for (const response of responses) response.results.forEach((result, index) => {
    const previous = matches.get(result.url);
    if (previous) {
      previous.score += 1 / (60 + index + 1);
      if (result.snippet.length > previous.result.snippet.length) previous.result = result;
    } else matches.set(result.url, { result, score: 1 / (60 + index + 1), order: matches.size });
  });
  const candidates = [...matches.values()]; const domains = new Map<string, number>(); const selected: WebSearchResult[] = [];
  while (selected.length < maximum && candidates.length) {
    const score = (item: typeof candidates[number]) => item.score / (1 + (domains.get(new URL(item.result.url).hostname) ?? 0) * 0.3);
    candidates.sort((a, b) => score(b) - score(a) || a.order - b.order);
    const item = candidates.shift()!; const host = new URL(item.result.url).hostname;
    selected.push(item.result); domains.set(host, (domains.get(host) ?? 0) + 1);
  }
  return selected;
}

export class WebSearchService {
  private readonly cache = new WeakMap<object, Map<string, { expires: number; value: WebSearchResponse }>>();
  constructor(private readonly provider?: WebSearchProvider, private readonly timeoutMs = 10_000) {}
  async search(query: string, maxResults: number, signal: AbortSignal, scope?: object): Promise<WebSearchResponse> {
    throwIfAborted(signal);
    if (!this.provider) throw new ToolError('SEARCH_NOT_CONFIGURED', '尚未配置网页搜索服务');
    const key = JSON.stringify([query.trim(), maxResults]);
    const saved = scope ? this.cache.get(scope)?.get(key) : undefined;
    if (saved && saved.expires > Date.now()) return structuredClone(saved.value);
    const value = await webOperation(signal, this.timeoutMs, async (activeSignal) => {
      try {
        const response = responseSchema.safeParse(await this.provider!.search({ query, maxResults, signal: activeSignal }));
        throwIfAborted(activeSignal);
        if (!response.success) throw new ToolError('INVALID_RESULT', '搜索服务返回格式无效');
        const output: WebSearchResponse = { results: [] };
        const seen = new Set<string>();
        for (const result of response.data.results) {
          if (output.results.length >= maxResults) break;
          let url: string | null;
          try { url = sourceUrl(publicWebUrl(result.url).href); } catch { continue; }
          if (!url || seen.has(url)) continue;
          const title = await extractWebText(result.title, true, activeSignal, 256);
          const snippet = await extractWebText(result.snippet, true, activeSignal, 800);
          const publishedAt = publicationDate(result.publishedAt);
          seen.add(url); output.results.push({ title: title.text || title.title || new URL(url).hostname, url, snippet: snippet.text,
            ...(publishedAt ? { publishedAt } : {}) });
        }
        throwIfAborted(activeSignal);
        return bounded(output);
      } catch (error) {
        throwIfAborted(activeSignal);
        if (error instanceof ToolError) throw error;
        throw new ToolError('SEARCH_FAILED', '搜索服务请求失败');
      }
    });
    if (scope && value.results.length) {
      const cache = this.cache.get(scope) ?? new Map(); this.cache.set(scope, cache);
      for (const [id, entry] of cache) if (entry.expires <= Date.now()) cache.delete(id);
      if (cache.size >= 32) cache.delete(cache.keys().next().value!);
      cache.set(key, { expires: Date.now() + 120_000, value: structuredClone(value) });
    }
    return value;
  }
  async searchMany(queries: string[], maxResults: number, signal: AbortSignal, scope?: object): Promise<WebSearchResponse> {
    const unique = [...new Set(queries.map((query) => query.trim()))];
    if (!unique.length || unique.length > 3 || unique.some((query) => !query || query.length > 200) || maxResults < 1 || maxResults > 20) throw new ToolError('INVALID_INPUT', '批量搜索参数无效');
    const responses: WebSearchResponse[] = [];
    const statuses: NonNullable<WebSearchResponse['queries']> = [];
    // At most three queries share the executor's 10s budget, leaving time for normalization.
    for (let offset = 0; offset < unique.length; offset += 3) {
      throwIfAborted(signal);
      const batch = unique.slice(offset, offset + 3);
      const settled = await Promise.allSettled(batch.map((query) => webOperation(signal, Math.min(8000, this.timeoutMs),
        (active) => this.search(query, Math.min(12, Math.max(8, maxResults)), active, scope))));
      throwIfAborted(signal);
      settled.forEach((result, index) => {
        if (result.status === 'fulfilled') { responses.push(result.value); statuses.push({ query: batch[index], count: result.value.results.length }); }
        else statuses.push({ query: batch[index], count: 0, error: result.reason instanceof ToolError ? result.reason.code : 'SEARCH_FAILED' });
      });
    }
    if (!responses.length) throw new ToolError('SEARCH_FAILED', `所有搜索查询均失败（${[...new Set(statuses.map((item) => item.error))].join(' / ')}），请稍后重试或改用其他关键词`);
    return bounded({ results: mergeResults(responses, maxResults), queries: statuses, partial: responses.length !== unique.length });
  }
}
