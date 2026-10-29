import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

/** Public hostnames on standard HTTP(S) ports; resolved routes are pinned to the socket. */
export function publicIconUrl(input: string, base?: string) {
  const url = new URL(input, base);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port || url.href.length > 4096) throw new Error('Invalid icon URL');
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host.includes('.') && !isIP(host) || /(?:^|\.)(?:localhost|local|internal|home|lan|test|invalid)$/.test(host) || isIP(host) && !publicIconAddress(host)) throw new Error('Non-public icon host');
  url.hash = ''; return url;
}
export function publicIconAddress(address: string) {
  if (isIP(address) === 4) {
    const p = address.split('.').map(Number), [a, b, c] = p;
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 100 && b >= 64 && b <= 127 || a === 169 && b === 254
      || a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0 && (c === 0 || c === 2) || b === 88 && c === 99)
      || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113);
  }
  if (isIP(address) !== 6) return false;
  const [first, second = '0'] = address.toLowerCase().split(':');
  const a = parseInt(first, 16), b = parseInt(second || '0', 16);
  return a >= 0x2000 && a <= 0x3fff && a !== 0x2002 && !(a === 0x2001 && (b <= 0x1ff || b === 0xdb8));
}
function virtualDnsRoute(address: string) {
  // Transparent DNS gateways synthesize benchmark-range routes, not LAN hosts.
  // Accept these only as DNS answers for a validated hostname, never as literal URLs.
  if (isIP(address) === 4) { const [a, b] = address.split('.').map(Number); return a === 198 && (b === 18 || b === 19); }
  if (isIP(address) !== 6) return false;
  const words = address.toLowerCase().split(':');
  return parseInt(words[0], 16) === 0x2001 && parseInt(words[1], 16) === 2 && (!words[2] || parseInt(words[2], 16) === 0);
}
type Resource = { url: string; type: string; bytes: Buffer };
export async function readIconResource(input: string, signal: AbortSignal, maximum: number, redirects = 3): Promise<Resource> {
  const url = publicIconUrl(input), host = url.hostname.replace(/^\[|\]$/g, '');
  signal.throwIfAborted();
  const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await lookup(host, { all: true });
  signal.throwIfAborted();
  if (!addresses.length || addresses.some(item => !publicIconAddress(item.address) && !(!isIP(host) && virtualDnsRoute(item.address)))) throw new Error('Non-public icon address');
  const address = addresses.find(item => item.family === 4) ?? addresses[0];
  return new Promise((resolve, reject) => {
    const req = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
      signal, agent: false, family: address.family,
      lookup: (_hostname, options, callback) => options.all ? callback(null, [address]) : callback(null, address.address, address.family),
      headers: { 'User-Agent': 'Snipvia-Website-Icon', Accept: 'text/html,image/*;q=0.9', 'Accept-Encoding': 'identity' }
    }, response => {
      const status = response.statusCode ?? 0;
      if ([301, 302, 303, 307, 308].includes(status)) {
        response.destroy();
        try {
          if (!redirects || !response.headers.location) throw new Error('Icon redirect limit');
          const next = publicIconUrl(response.headers.location, url.href);
          if (url.protocol === 'https:' && next.protocol !== 'https:') throw new Error('Insecure icon redirect');
          void readIconResource(next.href, signal, maximum, redirects - 1).then(resolve, reject);
        } catch (error) { reject(error); }
        return;
      }
      if (status !== 200 || response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity' || Number(response.headers['content-length']) > maximum) {
        response.destroy(); reject(new Error('Icon response rejected')); return;
      }
      const chunks: Buffer[] = []; let length = 0;
      response.on('data', (chunk: Buffer) => {
        length += chunk.length;
        if (length > maximum) { response.destroy(new Error('Icon response too large')); return; }
        chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => resolve({ url: url.href, type: (response.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase(), bytes: Buffer.concat(chunks) }));
    });
    req.setTimeout(2500, () => req.destroy(new Error('Icon request timeout')));
    req.on('error', reject); req.end();
  });
}
function entity(value: string) {
  return value.replace(/&(?:amp|quot|apos|lt|gt|#\d{1,7}|#x[\da-f]{1,6});/gi, token => {
    const named: Record<string, string> = { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>' };
    if (named[token.toLowerCase()]) return named[token.toLowerCase()];
    const n = token[2].toLowerCase() === 'x' ? parseInt(token.slice(3), 16) : parseInt(token.slice(2), 10);
    return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '';
  });
}
/** Bounded head-only tokenizer: attributes may be quoted, reordered or HTML-escaped. */
export function declaredWebsiteIcons(html: string, page: string) {
  const found: { url: string; score: number }[] = [];
  const lower = html.toLowerCase(); let cursor = 0;
  while (cursor < html.length) {
    const start = html.indexOf('<', cursor); if (start < 0) break;
    if (html.startsWith('<!--', start)) { const end = html.indexOf('-->', start + 4); cursor = end < 0 ? html.length : end + 3; continue; }
    let end = start + 1, quote = '';
    for (; end < html.length && end - start < 4096; end++) {
      const c = html[end];
      if (quote) { if (c === quote) quote = ''; }
      else if (c === '"' || c === "'") quote = c;
      else if (c === '>') break;
    }
    cursor = end + 1; if (html[end] !== '>') continue;
    const tag = html.slice(start + 1, end), name = /^\s*(\/?[\w-]+)/.exec(tag)?.[1]?.toLowerCase();
    if (name === 'body' || name === '/head') break;
    if (name === 'script' || name === 'style') { const close = lower.indexOf('</' + name, cursor); cursor = close < 0 ? html.length : close; continue; }
    if (name !== 'link') continue;
    const attrs = new Map<string, string>();
    for (const match of tag.slice(4).matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>\x60]+)))?/g)) {
      const key = match[1].toLowerCase(); if (!attrs.has(key)) attrs.set(key, entity(match[2] ?? match[3] ?? match[4] ?? ''));
    }
    const rel = (attrs.get('rel') ?? '').toLowerCase().split(/\s+/);
    if (!rel.some(value => ['icon', 'apple-touch-icon', 'apple-touch-icon-precomposed'].includes(value)) || !attrs.get('href')) continue;
    try {
      const url = publicIconUrl(attrs.get('href')!, page);
      if (/\.svg$/i.test(url.pathname) || attrs.get('type')?.toLowerCase().includes('svg')) continue;
      if (new URL(page).protocol === 'https:' && url.protocol !== 'https:') continue;
      found.push({ url: url.href, score: rel.includes('icon') ? 2 : 1 });
    } catch { /* Ignore non-web or private icon references. */ }
  }
  return [...new Set(found.sort((a, b) => b.score - a.score).map(item => item.url))].slice(0, 4);
}
export async function fetchWebsiteIcon(origin: string, signal: AbortSignal, normalize: (bytes: Buffer) => string | undefined,
  reader = readIconResource): Promise<string | undefined> {
  const root = publicIconUrl(new URL(origin).origin + '/');
  const budget = AbortSignal.any([signal, AbortSignal.timeout(8000)]);
  let candidates: string[] = [], final = root.href;
  try {
    const page = await reader(root.href, budget, 192 * 1024);
    final = page.url;
    if (['text/html', 'application/xhtml+xml'].includes(page.type)) candidates = declaredWebsiteIcons(page.bytes.toString('utf8'), final);
  } catch { if (budget.aborted) return; }
  candidates = [...new Set([...candidates, new URL('/favicon.ico', final).href, new URL('/apple-touch-icon.png', final).href])].slice(0, 6);
  for (const url of candidates) {
    if (budget.aborted) return;
    try {
      const icon = await reader(url, budget, 256 * 1024);
      const result = normalize(icon.bytes); if (result) return result;
    } catch { /* Authentication, unsupported formats and offline sites keep the local fallback. */ }
  }
}
