import { expect, it } from 'vitest';
import { shelfBounds, shelfCardRect, shelfContentTop, shelfShadowGutter, shelfLayout, shelfWindowBounds, shelfPreviewTarget, shelfDockBounds, shelfCardGap, shelfDropIndex } from '../../src/shared/collection';
it('positions Shelf within negative and positive monitor work areas without applying Retina scale twice', () => {
  for (const area of [{ x: -1920, y: -100, width: 1920, height: 1080 }, { x: 1000, y: 40, width: 1440, height: 860 }, { x: 0, y: 0, width: 160, height: 40 }]) {
    {
      const bounds = shelfBounds(area);
      expect(bounds.x).toBeGreaterThanOrEqual(area.x); expect(bounds.y).toBeGreaterThanOrEqual(area.y);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(area.x + area.width); expect(bounds.y + bounds.height).toBeLessThanOrEqual(area.y + area.height);
    }
  }
});

it('fits portrait, landscape and long crops without distorting their proportions', () => {
  for (const image of [{ width: 400, height: 900 }, { width: 3000, height: 300 }, { width: 180, height: 20000 }, { width: 1, height: 32768 }, { width: 32768, height: 1 }]) {
    for (const width of [160, 300, 420, 680]) for (const expanded of [false, true]) {
      for (let index = 0; index < 32; index++) {
        const box = shelfCardRect(image, width, index, 32, expanded);
        expect(box.width).toBeGreaterThan(0); expect(box.height).toBeGreaterThan(0);
        expect(box.width / box.height).toBeCloseTo(image.width / image.height, 5);
        expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width);
      }
    }
  }
});

it('uses compact aspect-ratio rows with stable order instead of fixed empty rows', () => {
  for (const width of [280, 420, 680, 960]) for (const height of [300, 660, 1200]) {
    const images = Array.from({ length: 32 }, (_, i) => i % 2 ? { width: 300, height: 1500 } : { width: 2400, height: 300 });
    const layout = shelfLayout(images, width, true, height);
    let previousBottom = 0;
    layout.cards.forEach((box, index) => {
      expect(box.y).toBeGreaterThanOrEqual(previousBottom);
      expect(box.x + box.width / 2).toBeCloseTo(width / 2);
      expect(box.rotation).toBe(0);
      expect(box.width / box.height).toBeCloseTo(images[index].width / images[index].height);
      previousBottom = box.y + box.height;
    });
    expect(layout.height).toBeGreaterThan(previousBottom);
    const normal = shelfLayout([{ width: 600, height: 380 }, { width: 600, height: 380 }], width, true, height);
    expect(normal.cards[1].y - normal.cards[0].y - normal.cards[0].height).toBeCloseTo(shelfCardGap);
    expect(shelfDropIndex(normal.cards, normal.cards[1].y + normal.cards[1].height / 2)).toBe(1);
  }
});
it('clamps a requested size to its monitor while preserving right and top anchoring', () => {
  const area = { x: -1600, y: -200, width: 1280, height: 720 };
  const small = shelfBounds(area, { width: 300, height: 400 }), large = shelfBounds(area, { width: 960, height: 1600 });
  expect(small.x + small.width).toBe(large.x + large.width);
  expect(large.y + large.height).toBeLessThanOrEqual(area.y + area.height);
  expect(small.y).toBe(-184); expect(large.y).toBe(-200);
});

it('keeps every rotated stack corner inside shadow gutters even at the smallest Shelf size', () => {
  for (const width of [280, 420, 960]) for (const height of [300, 660, 1600]) {
    for (const image of [{ width: 1000, height: 100 }, { width: 100, height: 1000 }, { width: 700, height: 700 }]) {
      for (let index = 0; index < 5; index++) {
        const r = shelfCardRect(image, width, index, 5, false, height), angle = r.rotation * Math.PI / 180;
        const corners = [[0, 0], [r.width, 0], [0, r.height], [r.width, r.height]].map(([x, y]) => ({
          x: r.x + x * Math.cos(angle) - y * Math.sin(angle), y: shelfContentTop + r.y + x * Math.sin(angle) + y * Math.cos(angle)
        }));
        for (const p of corners) {
          expect(p.x).toBeGreaterThanOrEqual(shelfShadowGutter);
          expect(p.x).toBeLessThanOrEqual(width - shelfShadowGutter);
          expect(p.y).toBeGreaterThanOrEqual(shelfContentTop + shelfShadowGutter - .0001);
          expect(p.y).toBeLessThanOrEqual(height - shelfShadowGutter);
        }
      }
    }
  }
});

it('enlarges small source thumbnails, grows native height with contents and centers preview in the work area', () => {
  const area = { x: -1440, y: 30, width: 1440, height: 900 }, size = { width: 420, height: 660 };
  const image = { width: 160, height: 100 }, images = Array.from({ length: 8 }, () => image);
  const stack = shelfWindowBounds(area, size, images, false), expanded = shelfWindowBounds(area, size, images, true);
  expect(shelfLayout([image], 420, false).cards[0].width).toBeGreaterThan(300);
  expect(expanded.height).toBeGreaterThan(stack.height); expect(expanded.height).toBeLessThanOrEqual(area.height);
  expect(shelfWindowBounds(area, size, images, true, true).width).toBeGreaterThan(expanded.width);
  const dock = shelfDockBounds(area, expanded); expect(dock.x + dock.width).toBe(area.x + area.width); expect(dock.width).toBe(22);
  const target = shelfPreviewTarget(image, area);
  expect(target.x + target.width / 2).toBe(area.width / 2); expect(target.y + target.height / 2).toBe(area.height / 2);
  expect(target.width / target.height).toBeCloseTo(image.width / image.height);
});

it('opens a full browsing height with one image and keeps both height modes within the work area', () => {
  const image = { width: 600, height: 380 }, size = { width: 420, height: 740 };
  for (const area of [{ x: -1440, y: 30, width: 1440, height: 900 }, { x: 0, y: 0, width: 1920, height: 1080 }, { x: 80, y: -400, width: 640, height: 400 }]) {
    const screen = shelfWindowBounds(area, size, [image], true, false, 'screen');
    expect(screen.height).toBe(Math.round(area.height * .75));
    const fixed = shelfWindowBounds(area, size, [image], true, false, 'fixed');
    expect(fixed.height).toBe(Math.min(area.height, size.height));
    expect(screen.x + screen.width).toBeLessThanOrEqual(area.x + area.width);
    expect(screen.y + screen.height).toBeLessThanOrEqual(area.y + area.height);
    expect(fixed.y + fixed.height).toBeLessThanOrEqual(area.y + area.height);
    expect(shelfWindowBounds(area, size, [image], false, false, 'screen')).toEqual(shelfWindowBounds(area, size, [image], false, false, 'fixed'));
  }
});
