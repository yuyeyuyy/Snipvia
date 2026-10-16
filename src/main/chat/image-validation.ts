import { nativeImage } from 'electron';
import { chatImageLimits } from '../../shared/chat-images';

/** Inspect dimensions before native decoding. No SVG, URL or filename-based format detection. */
export function imageDimensions(bytes: Buffer): { width: number; height: number } {
  if (!bytes.length || bytes.length > chatImageLimits.sourceBytes) throw new Error('图片需小于 10 MiB');
  let width = 0, height = 0;
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && bytes.subarray(12, 16).toString() === 'IHDR') {
    width = bytes.readUInt32BE(16); height = bytes.readUInt32BE(20);
  } else if (bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2;
    while (offset + 3 < bytes.length) {
      if (bytes[offset++] !== 255) break;
      while (offset < bytes.length && bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 217 || marker === 218) break;
      if (marker === 216 || marker === 1 || marker >= 208 && marker <= 215) continue;
      if (offset + 2 > bytes.length) break;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker) && length >= 8) { height = bytes.readUInt16BE(offset + 3); width = bytes.readUInt16BE(offset + 5); break; }
      offset += length;
    }
  }
  if (!width || !height) throw new Error('仅支持有效的 PNG / JPEG 图片');
  if (width > 16384 || height > 16384 || width * height > chatImageLimits.pixels) throw new Error('图片尺寸过大，请缩小至 2000 万像素以内');
  return { width, height };
}
export function normalizeChatImage(bytes: Buffer): { bytes: Buffer; width: number; height: number } {
  imageDimensions(bytes);
  let image = nativeImage.createFromBuffer(bytes); let size = image.getSize();
  if (image.isEmpty() || !size.width || !size.height || size.width * size.height > chatImageLimits.pixels) throw new Error('图片无法解码，请选择有效的 PNG / JPEG');
  const scale = Math.min(1, chatImageLimits.edge / Math.max(size.width, size.height));
  if (scale < 1) image = image.resize({ width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)), quality: 'best' });
  size = image.getSize(); const png = image.toPNG();
  if (!png.length || png.byteLength > chatImageLimits.storedBytes) throw new Error('处理后的图片超过 4 MiB，请压缩图片后重试');
  return { bytes: png, ...size };
}
