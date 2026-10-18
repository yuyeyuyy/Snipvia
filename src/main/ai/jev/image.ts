import { nativeImage } from 'electron';
import { PredictionError } from '../../analysis/PredictionError';

export interface JevImage { type: 'image'; format: 'png'; data_base64: string }
export function jevImageBounds(width: number, height: number) {
  const scale = Math.min(1, 1568 / Math.max(width, height));
  const scaledWidth = Math.max(1, Math.round(width * scale)), scaledHeight = Math.max(1, Math.round(height * scale));
  return { scaledWidth, scaledHeight, width: Math.max(280, scaledWidth), height: Math.max(280, scaledHeight) };
}
/** Only re-encode the selected crop; white padding satisfies TypeSafe's minimum dimensions. */
export function prepareJevImage(dataUrl: string): JevImage {
  if (dataUrl.length > 64 * 1024 * 1024 || !/^data:image\/(?:png|jpeg);base64,/.test(dataUrl)) throw new PredictionError({ stage: 'branch', reason: 'request' });
  const source = nativeImage.createFromDataURL(dataUrl);
  if (source.isEmpty()) throw new PredictionError({ stage: 'branch', reason: 'request' });
  const size = source.getSize();
  const bounds = jevImageBounds(size.width, size.height);
  const resized = source.resize({ width: bounds.scaledWidth, height: bounds.scaledHeight, quality: 'best' });
  const pixels = resized.toBitmap(), canvas = Buffer.alloc(bounds.width * bounds.height * 4, 255);
  const left = Math.floor((bounds.width - bounds.scaledWidth) / 2), top = Math.floor((bounds.height - bounds.scaledHeight) / 2);
  for (let row = 0; row < bounds.scaledHeight; row++) pixels.copy(canvas, ((row + top) * bounds.width + left) * 4, row * bounds.scaledWidth * 4, (row + 1) * bounds.scaledWidth * 4);
  const bytes = nativeImage.createFromBitmap(canvas, { width: bounds.width, height: bounds.height, scaleFactor: 1 }).toPNG();
  return { type: 'image', format: 'png', data_base64: bytes.toString('base64') };
}
