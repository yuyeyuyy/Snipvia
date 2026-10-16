import { describe, expect, it } from 'vitest';
import { quickChatBounds, quickWorkspaceBounds } from '../../src/main/windows/quick-chat-placement';

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
