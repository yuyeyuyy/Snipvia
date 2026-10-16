import { PublicHttpClient } from './PublicHttpClient';
import { publicWebUrl } from './NetworkPolicy';

/** Bound decoded dimensions before sending tiny raster favicons to Electron's decoder. */
export function boundedIcon(bytes: Buffer): boolean {
  const png = (data: Buffer) => data.length >= 24 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    && data.readUInt32BE(16) > 0 && data.readUInt32BE(16) <= 256 && data.readUInt32BE(20) > 0 && data.readUInt32BE(20) <= 256;
  if (bytes.length > 64 * 1024) return false;
  if (png(bytes)) return true;
  if (bytes.length < 22 || bytes.readUInt32LE(0) !== 0x00010000) return false;
  const count = bytes.readUInt16LE(4);
  if (!count || count > 16 || bytes.length < 6 + count * 16) return false;
  for (let i = 0; i < count; i++) {
    const entry = 6 + i * 16; const size = bytes.readUInt32LE(entry + 8); const start = bytes.readUInt32LE(entry + 12);
    if (start < 6 + count * 16 || size < 16 || start + size > bytes.length) return false;
    const data = bytes.subarray(start, start + size);
    if (png(data)) continue;
    // Only the bounded BITMAPINFOHEADER variant; skip exotic/compressed DIB encodings.
    if (data.length < 40 || data.readUInt32LE(0) !== 40 || data.readInt32LE(4) < 1 || data.readInt32LE(4) > 256 ||
        data.readInt32LE(8) < 2 || data.readInt32LE(8) > 512 || data.readUInt32LE(16) !== 0) return false;
  }
  return true;
}

/** Best-effort, same-origin icons. No external favicon service, cookies, SVG or remote renderer images. */
export class WebIconService {
  private readonly cache = new Map<string, string | null>();
  private readonly pending = new Map<string, Promise<string | null>>();
  private readonly queue: Array<() => void> = [];
  private active = 0;
  constructor(private readonly decode: (bytes: Buffer) => string | null, private readonly http = new PublicHttpClient(undefined, undefined, 2500)) {}
  get(pageUrl: string): Promise<string | null> {
    const origin = publicWebUrl(pageUrl).origin;
    if (this.cache.has(origin)) return Promise.resolve(this.cache.get(origin)!);
    const previous = this.pending.get(origin); if (previous) return previous;
    const result = new Promise<string | null>((resolve) => {
      this.queue.push(() => {
        this.active++;
        void this.http.get(`${origin}/favicon.ico`, { signal: AbortSignal.timeout(2500), maxBytes: 64 * 1024, maxRedirects: 0,
          acceptedTypes: ['image/png', 'image/x-icon', 'image/vnd.microsoft.icon'] })
          .then((response) => boundedIcon(response.bytes) ? this.decode(response.bytes) : null).catch(() => null)
          .then((icon) => {
            if (this.cache.size >= 100) this.cache.delete(this.cache.keys().next().value!);
            this.cache.set(origin, icon); resolve(icon);
          }).finally(() => { this.active--; this.pending.delete(origin); this.drain(); });
      });
    });
    this.pending.set(origin, result); this.drain(); return result;
  }
  private drain() { while (this.active < 4 && this.queue.length) this.queue.shift()!(); }
}
