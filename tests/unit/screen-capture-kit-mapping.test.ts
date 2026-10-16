import { describe, expect, it } from 'vitest';
import { mapScreenCaptureKitDisplay, matchesPendingResponse, type HelperDisplay } from '../../src/main/capture/screen-capture-kit-backend';
import type { CaptureDisplay } from '../../src/main/capture/types';

const display = (id: string, width: number, height: number, scaleFactor: number): CaptureDisplay => ({
  id,
  bounds: { x: 0, y: 0, width, height },
  size: { width, height },
  scaleFactor
});

describe('ScreenCaptureKit response isolation', () => {
  it('requires both request id and capture session id', () => {
    const pending = { requestId: 'request-b', captureSessionId: 'capture-b' };
    expect(matchesPendingResponse(pending, { requestId: 'request-b', captureSessionId: 'capture-b' })).toBe(true);
    expect(matchesPendingResponse(pending, { requestId: 'request-a', captureSessionId: 'capture-b' })).toBe(false);
    expect(matchesPendingResponse(pending, { requestId: 'request-b', captureSessionId: 'capture-a' })).toBe(false);
  });
});

const helperDisplay = (id: string, width: number, height: number, scaleFactor: number): HelperDisplay => ({
  id,
  x: 0,
  y: 0,
  width,
  height,
  pixelWidth: width * scaleFactor,
  pixelHeight: height * scaleFactor,
  scaleFactor
});

describe('ScreenCaptureKit display mapping', () => {
  it('prefers an exact CoreGraphics display id across two displays', () => {
    const displays = [helperDisplay('1', 1728, 1117, 2), helperDisplay('2', 1920, 1080, 1)];
    expect(mapScreenCaptureKitDisplay(displays, display('2', 1920, 1080, 1))?.id).toBe('2');
  });

  it('uses unique verified pixel geometry when Electron and CoreGraphics ids differ', () => {
    const displays = [helperDisplay('41', 1728, 1117, 2), helperDisplay('42', 1920, 1080, 1)];
    expect(mapScreenCaptureKitDisplay(displays, display('99', 1728, 1117, 2))?.id).toBe('41');
  });

  it('rejects ambiguous geometry instead of capturing the wrong display', () => {
    const displays = [helperDisplay('41', 1920, 1080, 1), helperDisplay('42', 1920, 1080, 1)];
    expect(mapScreenCaptureKitDisplay(displays, display('99', 1920, 1080, 1))).toBeNull();
  });

  it('does not match the same DIP geometry at a different scale factor', () => {
    const displays = [helperDisplay('41', 1728, 1117, 1)];
    expect(mapScreenCaptureKitDisplay(displays, display('99', 1728, 1117, 2))).toBeNull();
  });
});
