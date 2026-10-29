import { expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('electron', () => ({ clipboard: { read: mocks.read } }));
import { clipboardMatchesQuickTarget, quickTargetClipboardMetadata, quickTargetClipboardType } from '../../src/main/quick-target/clipboard-marker';

it('adds only optional nonce metadata without introducing an extra clipboard item', async () => {
  expect(quickTargetClipboardMetadata()).toEqual({});
  const data = quickTargetClipboardMetadata('opaque-marker');
  expect(Object.keys(data)).toEqual([quickTargetClipboardType]);
  expect(await data[quickTargetClipboardType].text()).toBe('opaque-marker');
});

it('checks only the atomic nonce and never reads image content', async () => {
  const getType = vi.fn(async () => new Blob(['marker']));
  mocks.read.mockResolvedValue([{ types: ['image/png', quickTargetClipboardType], getType }]);
  expect(await clipboardMatchesQuickTarget('marker')).toBe(true);
  expect(getType).toHaveBeenCalledExactlyOnceWith(quickTargetClipboardType);
  expect(await clipboardMatchesQuickTarget('changed')).toBe(false);
});
it('treats overwritten, unavailable and malformed metadata as stale', async () => {
  for (const items of [[], [{ types: ['image/png'], getType: vi.fn() }], [{ types: [quickTargetClipboardType], getType: async () => ({ size: 4, text: async () => 'test' }) }]]) {
    mocks.read.mockResolvedValue(items); expect(await clipboardMatchesQuickTarget('test')).toBe(false);
  }
  mocks.read.mockRejectedValue(new Error('unavailable')); expect(await clipboardMatchesQuickTarget('test')).toBe(false);
});
