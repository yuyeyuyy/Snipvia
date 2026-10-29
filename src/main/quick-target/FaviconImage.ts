export type FaviconImage = { kind: 'png'; bytes: Buffer } | { kind: 'bitmap'; bytes: Buffer; width: number; height: number };
function png(bytes: Buffer): FaviconImage | undefined {
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) || bytes.toString('ascii', 12, 16) !== 'IHDR') return;
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  if (!width || !height || width > 1024 || height > 1024) return;
  return { kind: 'png', bytes };
}
/** Accept bounded PNG or ICO (embedded PNG / uncompressed 24- or 32-bit DIB). */
export function faviconImage(bytes: Buffer): FaviconImage | undefined {
  if (bytes.length > 256 * 1024) return;
  const direct = png(bytes); if (direct) return direct;
  if (bytes.length < 22 || bytes.readUInt16LE(0) !== 0 || bytes.readUInt16LE(2) !== 1) return;
  const count = bytes.readUInt16LE(4); if (!count || count > 64 || 6 + count * 16 > bytes.length) return;
  const entries = Array.from({ length: count }, (_, i) => {
    const offset = 6 + i * 16;
    return { width: bytes[offset] || 256, height: bytes[offset + 1] || 256, length: bytes.readUInt32LE(offset + 8), offset: bytes.readUInt32LE(offset + 12) };
  }).sort((a, b) => Math.abs(a.width - 68) - Math.abs(b.width - 68));
  for (const entry of entries) {
    if (entry.offset < 6 + count * 16 || entry.length < 40 || entry.offset + entry.length > bytes.length) continue;
    const data = bytes.subarray(entry.offset, entry.offset + entry.length), image = png(data);
    if (image) return image;
    const header = data.readUInt32LE(0), bits = data.readUInt16LE(14), w = data.readInt32LE(4), h = data.readInt32LE(8);
    if (header < 40 || header > 124 || ![24, 32].includes(bits) || data.readUInt32LE(16) !== 0 || w !== entry.width || h !== entry.height * 2) continue;
    const row = Math.ceil(w * bits / 32) * 4, maskRow = Math.ceil(w / 32) * 4, height = entry.height;
    if (header + row * height + maskRow * height > data.length) continue;
    const bitmap = Buffer.alloc(w * height * 4); let hasAlpha = false;
    if (bits === 32) for (let y = 0; y < height; y++) for (let x = 0; x < w; x++) hasAlpha ||= data[header + y * row + x * 4 + 3] !== 0;
    for (let y = 0; y < height; y++) for (let x = 0; x < w; x++) {
      const source = header + (height - 1 - y) * row + x * (bits / 8), target = (y * w + x) * 4;
      const mask = data[header + row * height + (height - 1 - y) * maskRow + (x >> 3)] & (0x80 >> (x % 8));
      bitmap[target] = data[source]; bitmap[target + 1] = data[source + 1]; bitmap[target + 2] = data[source + 2];
      bitmap[target + 3] = mask ? 0 : hasAlpha ? data[source + 3] : 255;
    }
    return { kind: 'bitmap', bytes: bitmap, width: w, height };
  }
}
