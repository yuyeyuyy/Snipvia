import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { mkdir, writeFile, rename, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { publicIconUrl } from './WebsiteIconFetch';

type Entry = { at: number; icon?: string; failed?: boolean };
const lifetime = 7 * 24 * 60 * 60 * 1000, retry = 60 * 60 * 1000;
export function cachedWebsiteIcon(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 44000 || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  const bytes = Buffer.from(value.slice('data:image/png;base64,'.length), 'base64');
  return bytes.length >= 33 && bytes.length <= 32768 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
    && bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(16) <= 68 && bytes.readUInt32BE(20) > 0 && bytes.readUInt32BE(20) <= 68;
}
/** Best-effort derived cache. Neither settings reads nor screenshot output await the network. */
export class WebsiteIconCache {
  private entries = new Map<string, Entry>();
  private active = new Set<string>();
  private pending = new Map<string, AbortController>();
  private queue: string[] = [];
  private disposed = false;
  constructor(private readonly directory: string, private readonly fetcher: (origin: string, signal: AbortSignal) => Promise<string | undefined>,
    private readonly changed: () => void, private readonly now = Date.now) {}
  private key(origin: string) { return createHash('sha256').update(origin).digest('hex') + '.json'; }
  private origin(url: string) { return publicIconUrl(new URL(url).origin).origin; }
  current(url: string) {
    try {
      const origin = this.origin(url);
      if (!this.entries.has(origin)) {
        let entry: Entry = { at: 0 };
        try {
          const path = join(this.directory, this.key(origin)), stat = lstatSync(path);
          if (stat.isFile() && stat.size <= 45000) {
            const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
            if (value && typeof value === 'object' && 'at' in value && typeof value.at === 'number' && Number.isFinite(value.at)
              && value.at <= this.now() && 'icon' in value && cachedWebsiteIcon(value.icon)) entry = { at: value.at, icon: value.icon };
          }
        } catch { /* Missing/corrupt derived cache never affects user preferences. */ }
        this.entries.set(origin, entry);
      }
      return this.entries.get(origin)?.icon;
    } catch { return undefined; }
  }
  configure(urls: string[]) {
    if (this.disposed) return;
    this.active = new Set(urls.slice(0, 8).flatMap(url => { try { return [this.origin(url)]; } catch { return []; } }));
    for (const [origin, controller] of this.pending) if (!this.active.has(origin)) controller.abort();
    for (const origin of this.entries.keys()) if (!this.active.has(origin)) this.entries.delete(origin);
    this.queue = [];
    for (const origin of this.active) {
      this.current(origin);
      const entry = this.entries.get(origin)!;
      if (!this.pending.has(origin) && (!entry.at || this.now() - entry.at >= (entry.icon && !entry.failed ? lifetime : retry))) this.queue.push(origin);
    }
    void this.prune(); this.pump();
  }
  dispose() { this.disposed = true; this.active.clear(); this.queue = []; for (const controller of this.pending.values()) controller.abort(); }
  private pump() {
    while (!this.disposed && this.pending.size < 2 && this.queue.length) {
      const origin = this.queue.shift()!; if (!this.active.has(origin)) continue;
      const controller = new AbortController(); this.pending.set(origin, controller);
      void this.fetcher(origin, controller.signal).then(async icon => {
        if (controller.signal.aborted || this.disposed || !this.active.has(origin)) return;
        const old = this.entries.get(origin)?.icon, next = cachedWebsiteIcon(icon) ? icon : old;
        this.entries.set(origin, { at: this.now(), ...(next ? { icon: next } : {}), ...(!cachedWebsiteIcon(icon) ? { failed: true } : {}) });
        if (next !== old) this.changed();
        if (cachedWebsiteIcon(icon)) await this.save(origin, this.entries.get(origin)!);
      }).catch(() => {
        if (!controller.signal.aborted && this.active.has(origin)) this.entries.set(origin, { ...this.entries.get(origin), at: this.now(), failed: true });
      }).finally(() => {
        if (this.pending.get(origin) === controller) this.pending.delete(origin);
        if (!this.disposed && controller.signal.aborted && this.active.has(origin) && !this.queue.includes(origin)) this.queue.push(origin);
        this.pump();
      });
    }
  }
  private async save(origin: string, entry: Entry) {
    const path = join(this.directory, this.key(origin)), temporary = path + '.' + randomUUID() + '.tmp';
    try {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      await writeFile(temporary, JSON.stringify(entry), { mode: 0o600, flag: 'wx' });
      if (!this.disposed && this.active.has(origin)) await rename(temporary, path);
    } catch { /* Cache failures leave the in-memory icon available. */ }
    finally { await unlink(temporary).catch(() => {}); }
  }
  private async prune() {
    if (!this.active.size) return; // Turning the feature off should keep the last offline artwork.
    try {
      const names = await readdir(this.directory);
      const retained = new Set([...this.active].map(origin => this.key(origin)));
      await Promise.all(names.filter(name => /^[a-f0-9]{64}\.json$/.test(name) && !retained.has(name)).map(name => unlink(join(this.directory, name)).catch(() => {})));
    } catch { /* No cache directory is a normal first-run state. */ }
  }
}
