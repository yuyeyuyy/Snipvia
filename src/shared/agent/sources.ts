/** Stable identity for citations: discard tracking, keep meaningful query parameters. */
export function sourceUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || value.length > 2048) return null;
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) if (/^(utm_.+|fbclid|gclid|msclkid)$/i.test(key)) url.searchParams.delete(key);
    return url.href;
  } catch { return null; }
}

export interface WebSource { url: string; title: string; snippet: string; publishedAt?: string; read: boolean }

export function publicationDate(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const date = value.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  if (!date || !Number.isFinite(Date.parse(date))) return undefined;
  return new Date(date).toISOString().slice(0, 10) === date ? date : undefined;
}
