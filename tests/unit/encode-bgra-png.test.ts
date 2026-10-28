import { expect, it } from 'vitest';
import { inflateSync } from 'node:zlib';
import { encodeBgraPng } from '../../src/main/capture/encode-bgra-png';
function decode(png: Buffer) {
  const chunks: Buffer[] = []; let offset = 8;
  while (offset < png.length) { const size = png.readUInt32BE(offset); if (png.toString('ascii', offset + 4, offset + 8) === 'IDAT') chunks.push(png.subarray(offset + 8, offset + 8 + size)); offset += 12 + size; }
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20), rows = inflateSync(Buffer.concat(chunks)), rgba: number[] = [];
  for (let y = 0; y < height; y++) { const row = y * (width * 4 + 1), previous = [0, 0, 0, 0]; expect(rows[row]).toBe(1);
    for (let x = 0; x < width; x++) for (let c = 0; c < 4; c++) { const value = (rows[row + 1 + x * 4 + c] + previous[c]) & 255; rgba.push(value); previous[c] = value; }
  }
  return { width, height, rgba };
}
it('encodes the requested top-left crop without swapping channels or premultiplied alpha', async () => {
  const bytes = Uint8Array.from([0, 0, 255, 255, 0, 255, 0, 255, 255, 0, 0, 255, 0, 0, 128, 128]);
  const png = await encodeBgraPng({ bytes, width: 2, height: 2, rect: { x: 1, y: 0, width: 1, height: 2 } });
  expect(decode(png)).toEqual({ width: 1, height: 2, rgba: [0, 255, 0, 255, 255, 0, 0, 128] });
});
it('rejects truncated, fractional, negative, out-of-bounds and oversized bitmap requests', async () => {
  const valid = { bytes: new Uint8Array(16), width: 2, height: 2, rect: { x: 0, y: 0, width: 2, height: 2 } };
  for (const input of [{ ...valid, bytes: new Uint8Array(3) }, { ...valid, width: 1.5 }, { ...valid, rect: { ...valid.rect, x: -1 } }, { ...valid, rect: { ...valid.rect, x: 1 } }, { ...valid, width: 32769 }]) await expect(encodeBgraPng(input)).rejects.toThrow('无效');
});
