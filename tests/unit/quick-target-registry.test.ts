import { expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { QuickTargetRegistry } from '../../src/main/quick-target/QuickTargetRegistry';
import { QuickTargetPlatform } from '../../src/main/quick-target/QuickTargetPlatform';
import { QuickTargetPreferencesStore } from '../../src/main/storage/QuickTargetPreferencesStore';

async function fixture(run: (registry: QuickTargetRegistry, file: string, load: ReturnType<typeof vi.fn<(path: string) => Promise<string>>>) => Promise<void>) {
  const directory = mkdtempSync(join(tmpdir(), 'snipvia-target-artwork-')), file = join(directory, 'preferences.json');
  const load = vi.fn<(path: string) => Promise<string>>().mockResolvedValue('data:image/png;base64,fixture');
  const registry = new QuickTargetRegistry(new QuickTargetPreferencesStore(file), new QuickTargetPlatform('', 'win32'), load);
  try { await run(registry, file, load); } finally { rmSync(directory, { recursive: true, force: true }); }
}
const application = () => ({ id: randomUUID(), kind: 'application' as const, label: 'Fixture', path: '/Applications/Fixture.app', bundleId: 'com.snipvia.test.fixture' });
it('uses the selected browser and matching protocol handler without fetching on a settings read', async () => fixture(async (base, _file, load) => {
  for (const url of ['https://example.com/', 'http://example.com/', 'https://chatgpt.com/']) base.addWebsite({ label: 'Site', url });
  base.store.configureBrowser({ id: base.store.current().targets[2].id, mode: 'existing-tab', match: 'origin', focusInput: false });
  const browser = vi.fn(async (mode: string) => mode + '-png'), website = vi.fn(() => 'cached-site-png');
  const registry = new QuickTargetRegistry(base.store, base.platform, load, { browser, website });
  expect((await registry.settings()).targets.map(target => target.browserIcon)).toEqual(['default-png', 'http-png', 'chrome-png']);
  expect(browser).toHaveBeenCalledTimes(3); await registry.settings(); expect(browser).toHaveBeenCalledTimes(3);
}));

it('shares application artwork across concurrent views and evicts removed targets', async () => fixture(async (registry, _file, load) => {
  const target = application(); registry.store.add(target);
  const [a, b] = await Promise.all([registry.settings(), registry.settings()]);
  expect(load).toHaveBeenCalledTimes(1);
  expect(a.targets[0].icon).toBe('data:image/png;base64,fixture'); expect(b).toEqual(a);
  registry.store.remove(target.id); await registry.settings(); registry.store.add(target); await registry.settings();
  expect(load).toHaveBeenCalledTimes(2);
}));

it('allows retry after a transient icon read failure without altering preferences', async () => fixture(async (registry, file, load) => {
  registry.store.add(application()); const bytes = readFileSync(file, 'utf8');
  load.mockRejectedValueOnce(new Error('Synthetic unavailable icon'));
  expect((await registry.settings()).targets[0].icon).toBeUndefined();
  expect((await registry.settings()).targets[0].icon).toBe('data:image/png;base64,fixture');
  expect(load).toHaveBeenCalledTimes(2); expect(readFileSync(file, 'utf8')).toBe(bytes);
}));

it('selects bundled website artwork by exact hostname rather than a user label or URL fragment', async () => fixture(async (registry, file, load) => {
  const hosts = ['chatgpt.com', 'chat.openai.com', 'chat.deepseek.com', 'deepseek.com', 'chatgpt.com.evil.test', 'unrelated.test'];
  hosts.forEach(host => registry.addWebsite({ label: 'ChatGPT', url: 'https://' + host + '/?next=chat.deepseek.com' }));
  const bytes = readFileSync(file, 'utf8'), state = await registry.settings();
  expect(state.targets.map(target => target.websiteIcon)).toEqual(['chatgpt', 'chatgpt', 'deepseek', 'deepseek', undefined, undefined]);
  expect(load).not.toHaveBeenCalled(); expect(readFileSync(file, 'utf8')).toBe(bytes);
  expect(state.targets.every(target => target.icon === undefined)).toBe(true);
  expect(state.targets.every(target => target.browser?.mode === 'open')).toBe(true);
}));
