import { expect, it } from 'vitest';
import { shelfBounds } from '../../src/shared/collection';
it('positions Shelf within negative and positive monitor work areas without applying Retina scale twice', () => {
  for (const area of [{ x: -1920, y: -100, width: 1920, height: 1080 }, { x: 1000, y: 40, width: 1440, height: 860 }, { x: 0, y: 0, width: 160, height: 40 }]) {
    for (const expanded of [false, true]) {
      const bounds = shelfBounds(area, expanded);
      expect(bounds.x).toBeGreaterThanOrEqual(area.x); expect(bounds.y).toBeGreaterThanOrEqual(area.y);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(area.x + area.width); expect(bounds.y + bounds.height).toBeLessThanOrEqual(area.y + area.height);
    }
  }
});
