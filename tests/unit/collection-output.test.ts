import { describe, expect, it } from 'vitest';
import { mergeLayout, orderedOutputIds } from '../../src/shared/collection-output';
describe('collection output layout', () => {
  it('preserves natural small widths, scales large images and vertically orders with explicit gaps', () => {
    expect(mergeLayout([{ width: 1600, height: 800 }, { width: 400, height: 300 }], { width: 800, gap: 12 })).toEqual({
      width: 800, height: 712, placements: [{ width: 800, height: 400, x: 0, y: 0 }, { width: 400, height: 300, x: 200, y: 412 }]
    });
  });
  it('rejects empty, pathological height, decoded memory excess and invalid sizes before bitmap allocation', () => {
    expect(() => mergeLayout([], { width: 800, gap: 0 })).toThrow();
    expect(() => mergeLayout([{ width: 1, height: 32768 }, { width: 1, height: 1 }], { width: 800, gap: 0 })).toThrow('过大');
    expect(() => mergeLayout([{ width: 4096, height: 10000 }], { width: 4096, gap: 0 })).toThrow('过大');
    expect(() => mergeLayout([{ width: 0, height: 10 }], { width: 800, gap: 0 })).toThrow();
  });
  it('uses collection order for selected exports and refuses stale or duplicated IDs', () => {
    expect(orderedOutputIds(['a', 'b', 'c'], ['c', 'a'])).toEqual(['a', 'c']);
    expect(() => orderedOutputIds(['a'], ['b'])).toThrow();
    expect(() => orderedOutputIds(['a'], ['a', 'a'])).toThrow();
    expect(() => orderedOutputIds(['a'], [])).toThrow();
  });
});
