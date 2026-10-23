import { mergeLayout, type MergeOptions } from '../../../shared/collection-output';
import type { ScreenshotItem } from '../../../shared/screenshot';
export async function mergeCollectionImages(items: ScreenshotItem[], options: MergeOptions) {
  const layout = mergeLayout(items, options);
  const canvas = document.createElement('canvas');
  canvas.width = layout.width; canvas.height = layout.height;
  try {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法创建合并画布');
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height);
    for (const [index, item] of items.entries()) {
      const result = await window.snipvia.collection.image(item.id);
      if (!result.ok) throw new Error(result.error);
      const bitmap = await createImageBitmap(new Blob([new Uint8Array(result.value.bytes)], { type: result.value.mimeType }));
      try { const rect = layout.placements[index]; context.drawImage(bitmap, rect.x, rect.y, rect.width, rect.height); }
      finally { bitmap.close(); }
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('合并图片编码失败')), 'image/png'));
    if (blob.size > 64 * 1024 * 1024) throw new Error('合并图片过大，原图已保留');
    return new Uint8Array(await blob.arrayBuffer());
  } finally { canvas.width = 0; canvas.height = 0; }
}
