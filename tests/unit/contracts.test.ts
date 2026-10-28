import { describe, expect, it } from 'vitest';
import { captureFinishSchema, selectionSchema } from '../../src/shared/contracts';

describe('capture IPC input validation', () => {
  it('accepts finite nonnegative coordinates and a nonempty crop', () => {
    expect(selectionSchema.parse({ x: 0, y: 12.5, width: 30, height: 40 })).toEqual({ x: 0, y: 12.5, width: 30, height: 40 });
  });
  it('rejects invalid geometry before privileged capture', () => {
    for (const invalid of [{ x: -1 }, { y: NaN }, { width: Infinity }, { width: 2 }, { height: 0 }]) {
      expect(selectionSchema.safeParse({ x: 0, y: 0, width: 30, height: 40, ...invalid }).success).toBe(false);
    }
  });
  it('requires a valid session ID alongside crop coordinates', () => {
    const selection = { x: 0, y: 0, width: 30, height: 40 };
    expect(captureFinishSchema.safeParse({ selection }).success).toBe(false);
    expect(captureFinishSchema.safeParse({ selection, sessionId: '../settings.json' }).success).toBe(false);
    expect(captureFinishSchema.safeParse({ selection, sessionId: 'capture_123456_abcdef12' }).success).toBe(true);
  });
});
