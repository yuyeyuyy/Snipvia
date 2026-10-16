import { describe, expect, it } from 'vitest';
import { cropRectangle } from '../../src/shared/geometry';

describe('display-local crop mapping', () => {
  it.each([1, 1.25, 1.5, 1.75, 2])('maps an entire display at scale %s without adding its desktop offset', (scale) => {
    const view = { width: 1280, height: 720 };
    const frame = { width: Math.round(view.width * scale), height: Math.round(view.height * scale) };
    expect(cropRectangle({ x: 0, y: 0, ...view }, view, frame)).toEqual({ x: 0, y: 0, ...frame });
    expect(cropRectangle({ x: 320, y: 180, width: 640, height: 360 }, view, frame))
      .toEqual({ x: 320 * scale, y: 180 * scale, width: 640 * scale, height: 360 * scale });
  });
  it('maps Retina DIP coordinates to actual frame pixels', () => {
    expect(cropRectangle({ x: 12, y: 20, width: 100, height: 60 }, { width: 1440, height: 900 }, { width: 2880, height: 1800 }))
      .toEqual({ x: 24, y: 40, width: 200, height: 120 });
  });
  it('uses actual frame ratios and rounds outward at fractional scale', () => {
    expect(cropRectangle({ x: 1, y: 1, width: 2, height: 2 }, { width: 100, height: 100 }, { width: 150, height: 125 }))
      .toEqual({ x: 1, y: 1, width: 4, height: 3 });
  });
  it('clamps screen-edge selections', () => {
    expect(cropRectangle({ x: 95, y: 90, width: 20, height: 20 }, { width: 100, height: 100 }, { width: 200, height: 200 }))
      .toEqual({ x: 190, y: 180, width: 10, height: 20 });
  });
  it('rejects selections outside the captured display', () => {
    expect(() => cropRectangle({ x: 110, y: 0, width: 10, height: 10 }, { width: 100, height: 100 }, { width: 200, height: 200 })).toThrow();
  });
});
