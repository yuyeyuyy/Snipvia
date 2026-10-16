import type { CaptureDisplay } from './types';

export function validateScreenThumbnailSize(
  size: { width: number; height: number },
  display: Pick<CaptureDisplay, 'size' | 'scaleFactor'>,
  platform: NodeJS.Platform
): void {
  if (size.width <= 0 || size.height <= 0) {
    throw new Error('屏幕帧尺寸无效，请重新截图');
  }

  if (platform === 'win32') {
    // Electron does not guarantee thumbnailSize. Windows display scaling can
    // return fewer pixels than requested, while cropRectangle maps using the
    // actual frame dimensions. An unexpected aspect ratio is a real mismatch.
    const displayAspect = display.size.width / display.size.height;
    const frameAspect = size.width / size.height;
    if (Math.abs(frameAspect / displayAspect - 1) > 0.02) {
      throw new Error(`屏幕画面比例与显示器不一致（画面 ${size.width}×${size.height}，显示器 ${display.size.width}×${display.size.height}），请反馈给开发者。`);
    }
    return;
  }

  const expectedWidth = Math.round(display.size.width * display.scaleFactor);
  const expectedHeight = Math.round(display.size.height * display.scaleFactor);
  if (size.width < expectedWidth || size.height < expectedHeight) {
    throw new Error('屏幕帧未达到原生分辨率，请检查屏幕录制权限后重试');
  }
}
