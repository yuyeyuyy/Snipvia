import { expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebsiteIconCache } from '../../src/main/quick-target/WebsiteIconCache';

const icon = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jV1sAAAAASUVORK5CYII=';
it('deduplicates origins, persists bounded icons and immediately reuses them while offline', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'snipvia-icon-cache-')), changed = vi.fn(), fetcher = vi.fn<(origin: string, signal: AbortSignal) => Promise<string>>().mockResolvedValue(icon);
  const cache = new WebsiteIconCache(directory, fetcher, changed);
  try {
    expect(cache.current('https://example.com/conversation')).toBeUndefined(); expect(fetcher).not.toHaveBeenCalled();
    cache.configure(['https://example.com/private?token=local', 'https://example.com/another']);
    await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
    expect(fetcher).toHaveBeenCalledTimes(1); expect(fetcher.mock.calls[0][0]).toBe('https://example.com');
    await vi.waitFor(() => expect(readdirSync(directory).filter(name => name.endsWith('.json'))).toHaveLength(1));
    const name = readdirSync(directory).find(name => name.endsWith('.json'))!;
    expect(readFileSync(join(directory, name), 'utf8')).not.toMatch(/conversation|token|example.com/);
    const offline = vi.fn(async () => undefined), restored = new WebsiteIconCache(directory, offline, vi.fn());
    expect(restored.current('https://example.com/anything')).toBe(icon); restored.configure(['https://example.com/']);
    expect(offline).not.toHaveBeenCalled(); restored.dispose();
  } finally { cache.dispose(); rmSync(directory, { recursive: true, force: true }); }
});
it('limits concurrency, cancels removed targets and never publishes their late results', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'snipvia-icon-cancel-'));
  const jobs: { signal: AbortSignal; resolve(value: string | undefined): void }[] = [], changed = vi.fn();
  const fetcher = vi.fn((_origin: string, signal: AbortSignal) => new Promise<string | undefined>(resolve => jobs.push({ signal, resolve })));
  const cache = new WebsiteIconCache(directory, fetcher, changed);
  try {
    cache.configure(['https://one.example.com/', 'https://two.example.com/', 'https://three.example.com/']);
    expect(fetcher).toHaveBeenCalledTimes(2); cache.configure([]); expect(jobs.every(job => job.signal.aborted)).toBe(true);
    jobs.forEach(job => job.resolve(icon)); await new Promise(resolve => setTimeout(resolve, 0));
    expect(changed).not.toHaveBeenCalled(); expect(fetcher).toHaveBeenCalledTimes(2);
  } finally { cache.dispose(); rmSync(directory, { recursive: true, force: true }); }
});
it('backs off failures and retries without blocking local fallback', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'snipvia-icon-retry-')); let now = 1000;
  const fetcher = vi.fn(async () => undefined), cache = new WebsiteIconCache(directory, fetcher, vi.fn(), () => now);
  try {
    cache.configure(['https://example.com/']); await new Promise(resolve => setTimeout(resolve, 0));
    cache.configure(['https://example.com/']); expect(fetcher).toHaveBeenCalledTimes(1);
    now += 60 * 60 * 1000; cache.configure(['https://example.com/']); expect(fetcher).toHaveBeenCalledTimes(2);
  } finally { cache.dispose(); rmSync(directory, { recursive: true, force: true }); }
});
