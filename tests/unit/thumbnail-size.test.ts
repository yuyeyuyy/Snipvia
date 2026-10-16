import { describe, expect, it } from 'vitest';
import { validateScreenThumbnailSize } from '../../src/main/capture/thumbnail-size';
import { cropRectangle } from '../../src/shared/geometry';

describe('Windows screen thumbnail scaling', () => {
  const view = { width: 1536, height: 864 };
  const selection = { x: 384, y: 216, width: 768, height: 432 };

  it('accepts a 125% display frame returned at logical size and still maps the crop', () => {
    const frame = { width: 1536, height: 864 };
    expect(() => validateScreenThumbnailSize(frame, { size: view, scaleFactor: 1.25 }, 'win32')).not.toThrow();
    expect(cropRectangle(selection, view, frame)).toEqual(selection);
  });

  it('accepts a 150% display frame returned below the requested physical size', () => {
    const frame = { width: 1600, height: 900 };
    const dipView = { width: 1280, height: 720 };
    expect(() => validateScreenThumbnailSize(frame, { size: dipView, scaleFactor: 1.5 }, 'win32')).not.toThrow();
    expect(cropRectangle({ x: 320, y: 180, width: 640, height: 360 }, dipView, frame))
      .toEqual({ x: 400, y: 225, width: 800, height: 450 });
  });

  it('rejects a frame with an incompatible aspect ratio', () => {
    expect(() => validateScreenThumbnailSize({ width: 1920, height: 1200 }, { size: view, scaleFactor: 1.25 }, 'win32'))
      .toThrow('屏幕画面比例与显示器不一致');
  });

  it('preserves the macOS full-resolution check', () => {
    expect(() => validateScreenThumbnailSize({ width: 1536, height: 864 }, { size: view, scaleFactor: 1.25 }, 'darwin'))
      .toThrow('屏幕帧未达到原生分辨率');
  });
});
