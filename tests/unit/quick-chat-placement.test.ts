import { describe, expect, it } from 'vitest';
import { quickChatBounds, quickWorkspaceBounds, resizedQuickChatBounds } from '../../src/main/windows/quick-chat-placement';

describe('quickChatBounds', () => {
  const workArea = { x: 0, y: 0, width: 1536, height: 864 };
  const userSize = { width: 390, height: 520 };

  it('keeps the user-selected size while the screenshot moves left and up', () => {
    const initial = quickChatBounds({ x: 700, y: 250, width: 400, height: 250 }, workArea, userSize);
    const moved = quickChatBounds({ x: 500, y: 80, width: 400, height: 250 }, workArea, userSize);
    expect(initial).toMatchObject(userSize);
    expect(moved).toMatchObject(userSize);
    expect(moved.x).toBeLessThan(initial.x);
    expect(moved.y).toBeLessThan(initial.y);
  });

  it('uses the saved user size rather than a Windows DPI-inflated window size', () => {
    const pinned = { x: 450, y: 100, width: 500, height: 300 };
    const first = quickChatBounds(pinned, workArea, userSize);
    const actualAfterMove = { ...first, width: first.width + 3, height: first.height + 2 };
    const next = quickChatBounds({ ...pinned, x: 440, y: 90 }, workArea, userSize);
    expect(actualAfterMove.width).toBeGreaterThan(next.width);
    expect(next.width).toBe(first.width);
    expect(next.height).toBe(first.height);
  });
});

describe('expanded screenshot workspace', () => {
  it('centers on a secondary monitor with a negative origin', () => {
    expect(quickWorkspaceBounds({ x: -1440, y: 24, width: 1440, height: 876 }, { width: 1000, height: 680 }))
      .toEqual({ x: -1220, y: 122, width: 1000, height: 680 });
  });
  it('clamps to a small work area without applying Retina scaling twice', () => {
    expect(quickWorkspaceBounds({ x: 0, y: 24, width: 800, height: 576 }, { width: 1000, height: 680 }))
      .toEqual({ x: 0, y: 24, width: 800, height: 576 });
  });
});

describe('floating chat manual resizing', () => {
  const area = { x: -1440, y: 24, width: 1440, height: 876 };
  it('keeps the top-left when possible, clamps the minimum and fits large sizes to a negative-origin display', () => {
    const current = { x: -1000, y: 100, width: 440, height: 400 };
    expect(resizedQuickChatBounds(current, area, { width: 500, height: 550 })).toEqual({ ...current, width: 500, height: 550 });
    expect(resizedQuickChatBounds(current, area, { width: 1, height: 1 })).toMatchObject({ width: 340, height: 360 });
    expect(resizedQuickChatBounds(current, area, { width: 9000, height: 9000 })).toEqual(area);
  });
  it('repositions near display edges and retains DIP sizes without applying a scaling factor', () => {
    expect(resizedQuickChatBounds({ x: -450, y: 700, width: 440, height: 400 }, area, { width: 600, height: 500 })).toEqual({ x: -600, y: 400, width: 600, height: 500 });
  });
});
