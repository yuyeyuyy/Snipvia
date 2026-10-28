import { deflate } from 'node:zlib';
import { promisify } from 'node:util';
const compress = promisify(deflate);
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let i = 0; i < 8; i++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function chunk(type: string, bytes: Buffer) {
  const tag = Buffer.from(type), result = Buffer.allocUnsafe(bytes.length + 12);
  result.writeUInt32BE(bytes.length); tag.copy(result, 4); bytes.copy(result, 8);
  let crc = 0xffffffff;
  for (const byte of tag) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4); return result;
}
export type BitmapCrop = { bytes: Uint8Array; width: number; height: number; rect: { x: number; y: number; width: number; height: number } };
/** Electron bitmap bytes are BGRA premultiplied. Conversion and PNG encoding run in a Worker. */
export async function encodeBgraPng(input: BitmapCrop) {
  const { width, height, rect, bytes } = input;
  const integers = [width, height, rect.x, rect.y, rect.width, rect.height];
  if (!integers.every(Number.isSafeInteger) || width < 1 || height < 1 || width > 32768 || height > 32768
    || width * height > 32 * 1024 * 1024 || bytes.length !== width * height * 4
    || rect.x < 0 || rect.y < 0 || rect.width < 1 || rect.height < 1
    || rect.x + rect.width > width || rect.y + rect.height > height) throw new Error('截图位图或裁剪范围无效');
  const rowBytes = rect.width * 4, filtered = Buffer.allocUnsafe((rowBytes + 1) * rect.height);
  for (let y = 0; y < rect.height; y++) {
    const row = y * (rowBytes + 1); filtered[row] = 1; // PNG Sub filter.
    const previous = [0, 0, 0, 0];
    for (let x = 0; x < rect.width; x++) {
      const i = ((y + rect.y) * width + x + rect.x) * 4, alpha = bytes[i + 3];
      for (let c = 0; c < 4; c++) {
        const channel = bytes[i + (c === 0 ? 2 : c === 2 ? 0 : c)];
        const value = c < 3 && alpha < 255 ? alpha ? Math.min(255, Math.round(channel * 255 / alpha)) : 0 : channel;
        filtered[row + 1 + x * 4 + c] = (value - previous[c] + 256) & 255; previous[c] = value;
      }
    }
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(rect.width); header.writeUInt32BE(rect.height, 4); header[8] = 8; header[9] = 6;
  const encoded = await compress(filtered, { level: 3 });
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', encoded), chunk('IEND', Buffer.alloc(0))]);
  if (png.length > 64 * 1024 * 1024) throw new Error('截图输出超过 64 MiB，原图已保留');
  return png;
}
