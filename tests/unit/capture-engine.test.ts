import { describe, expect, it, vi } from 'vitest';
import { CaptureEngine } from '../../src/main/capture/capture-engine';
import type { CaptureBackend, CaptureBackendRequest, CapturedFrame } from '../../src/main/capture/types';

const request = {
  display: { id: '1', bounds: { x: 0, y: 0, width: 100, height: 80 }, size: { width: 100, height: 80 }, scaleFactor: 2 },
  performanceSessionId: 'capture_1000000000000_1234abcd',
  mainWindowWasVisible: true
} satisfies CaptureBackendRequest;

const frame = (displayId: string): CapturedFrame => ({
  width: 200,
  height: 160,
  scaleFactor: 2,
  displayId,
  capturedAt: 1,
  buffer: Buffer.alloc(0),
  format: 'bgra',
  image: {} as CapturedFrame['image']
});

function backend(name: CaptureBackend['name'], options: { available?: boolean; error?: Error } = {}): CaptureBackend {
  return {
    name,
    initialize: vi.fn(async () => {}),
    isAvailable: vi.fn(async () => options.available ?? true),
    captureDisplay: vi.fn(async ({ display }) => {
      if (options.error) throw options.error;
      return frame(display.id);
    }),
    invalidateDisplays: vi.fn(async () => {}),
    dispose: vi.fn(async () => {})
  };
}

describe('CaptureEngine', () => {
  it('uses ScreenCaptureKit when it is healthy', async () => {
    const primary = backend('screen-capture-kit');
    const fallback = backend('electron');
    const engine = new CaptureEngine({ primary, fallback, primaryEnabled: () => true });
    const result = await engine.captureDisplay(request);
    expect(result).toMatchObject({ backend: 'screen-capture-kit', fallbackUsed: false });
    expect(primary.captureDisplay).toHaveBeenCalledOnce();
    expect(fallback.captureDisplay).not.toHaveBeenCalled();
  });

  it('falls back to Electron after a native capture error', async () => {
    const primary = backend('screen-capture-kit', { error: new Error('native failed') });
    const fallback = backend('electron');
    const onFallback = vi.fn();
    const engine = new CaptureEngine({ primary, fallback, primaryEnabled: () => true, onFallback });
    const result = await engine.captureDisplay(request);
    expect(result).toMatchObject({ backend: 'electron', fallbackUsed: true, fallbackReason: 'native failed' });
    expect(fallback.captureDisplay).toHaveBeenCalledOnce();
    expect(onFallback).toHaveBeenCalledWith(request.performanceSessionId, 'native failed');
  });

  it('does not count an explicitly disabled native backend as fallback', async () => {
    const primary = backend('screen-capture-kit');
    primary.shouldAttemptCapture = vi.fn(() => false);
    const fallback = backend('electron');
    const engine = new CaptureEngine({ primary, fallback, primaryEnabled: () => false });
    const result = await engine.captureDisplay(request);
    expect(result).toMatchObject({ backend: 'electron', fallbackUsed: false });
    expect(primary.captureDisplay).not.toHaveBeenCalled();
    expect(primary.initialize).not.toHaveBeenCalled();
    expect(primary.isAvailable).not.toHaveBeenCalled();
    expect(primary.shouldAttemptCapture).not.toHaveBeenCalled();
  });

  it('does not capture or initialize after cancellation', async () => {
    const primary = backend('screen-capture-kit');
    const fallback = backend('electron');
    const engine = new CaptureEngine({ primary, fallback, primaryEnabled: () => false });
    const controller = new AbortController();
    controller.abort(new Error('cancelled by user'));
    await expect(engine.captureDisplay({ ...request, signal: controller.signal })).rejects.toThrow('cancelled by user');
    expect(fallback.captureDisplay).not.toHaveBeenCalled();
    expect(fallback.initialize).not.toHaveBeenCalled();
  });

  it('does not start the Electron fallback after an explicit capture abort', async () => {
    const controller = new AbortController();
    const primary = backend('screen-capture-kit');
    primary.captureDisplay = vi.fn(async () => {
      controller.abort(new Error('cancelled by user'));
      throw new Error('native request cancelled');
    });
    const fallback = backend('electron');
    const engine = new CaptureEngine({ primary, fallback, primaryEnabled: () => true });
    await expect(engine.captureDisplay({ ...request, signal: controller.signal })).rejects.toThrow('cancelled by user');
    expect(fallback.captureDisplay).not.toHaveBeenCalled();
  });
});
