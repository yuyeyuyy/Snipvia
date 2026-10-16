import { sourceUrl, publicationDate, type WebSource } from '../../../shared/agent/sources';
import { publicWebUrl } from '../web/NetworkPolicy';

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown, limit: number) => typeof value === 'string' ? [...value].map((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 ? ' ' : char).join('').replace(/\s+/g, ' ').trim().slice(0, limit) : '';

/** Sources come from successful tool results, never from model-invented citation lists. */
export function collectWebSources(previous: WebSource[], tool: string, output: unknown): WebSource[] {
  const data = record(output);
  const candidates = tool === 'web_search' && Array.isArray(data.results) ? data.results : ['fetch_url', 'read_web_chunk'].includes(tool) ? [data] : [];
  const sources = previous.map((item) => ({ ...item }));
  for (const candidate of candidates) {
    const value = record(candidate);
    if (typeof value.url !== 'string') continue;
    let url: string | null;
    try { url = sourceUrl(publicWebUrl(value.url).href); } catch { continue; }
    if (!url) continue;
    const existing = sources.find((item) => item.url === url);
    if (!existing && sources.length >= 60) continue;
    const read = tool !== 'web_search';
    const title = text(value.title, 300);
    const snippet = text(read ? value.text : value.snippet, 800);
    const publishedAt = publicationDate(value.publishedAt);
    if (existing) {
      existing.read ||= read;
      if (title) existing.title = title;
      if (snippet && (!existing.snippet || read)) existing.snippet = snippet;
      if (publishedAt) existing.publishedAt = publishedAt;
    } else sources.push({ url, title: title || new URL(url).hostname, snippet, read, ...(publishedAt ? { publishedAt } : {}) });
  }
  return sources;
}
