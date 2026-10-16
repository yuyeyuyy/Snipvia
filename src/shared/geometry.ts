import type { Selection } from './contracts';

export function cropRectangle(rect: Selection, view: { width: number; height: number }, frame: { width: number; height: number }): Selection {
  if (view.width <= 0 || view.height <= 0 || frame.width <= 0 || frame.height <= 0) throw new Error('无效的屏幕尺寸');
  const x = Math.max(0, Math.floor(rect.x * frame.width / view.width));
  const y = Math.max(0, Math.floor(rect.y * frame.height / view.height));
  const right = Math.min(frame.width, Math.ceil((rect.x + rect.width) * frame.width / view.width));
  const bottom = Math.min(frame.height, Math.ceil((rect.y + rect.height) * frame.height / view.height));
  if (right <= x || bottom <= y) throw new Error('选区超出屏幕');
  return { x, y, width: right - x, height: bottom - y };
}
