import type { EditorCrop } from '../../../../shared/screenshot-editor';
import { annotationBounds, type Annotation } from './model';

export function drawAnnotations(ctx: CanvasRenderingContext2D, items: Annotation[]) {
  for (const item of items) {
    const a = item.points[0], b = item.points.at(-1)!;
    const rect = annotationBounds(item);
    ctx.save();
    ctx.strokeStyle = item.color;
    ctx.fillStyle = item.color;
    ctx.lineWidth = item.size;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    switch (item.tool) {
      case 'rectangle': ctx.strokeRect(rect.x, rect.y, rect.width, rect.height); break;
      case 'ellipse':
        ctx.ellipse(rect.x + rect.width / 2, rect.y + rect.height / 2, rect.width / 2, rect.height / 2, 0, 0, Math.PI * 2);
        ctx.stroke(); break;
      case 'arrow': {
        const angle = Math.atan2(b.y - a.y, b.x - a.x), length = Math.max(12, item.size * 4);
        ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(b.x, b.y);
        ctx.lineTo(b.x - length * Math.cos(angle - Math.PI / 6), b.y - length * Math.sin(angle - Math.PI / 6));
        ctx.lineTo(b.x - length * Math.cos(angle + Math.PI / 6), b.y - length * Math.sin(angle + Math.PI / 6));
        ctx.closePath(); ctx.fill(); break;
      }
      case 'pencil':
        ctx.moveTo(a.x, a.y);
        for (const point of item.points.slice(1)) ctx.lineTo(point.x, point.y);
        if (item.points.length === 1) ctx.lineTo(a.x + 0.1, a.y);
        ctx.stroke(); break;
      case 'text': {
        const font = item.size * 6 + 12;
        ctx.font = `500 ${font}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
        ctx.textBaseline = 'top';
        (item.text ?? '').split('\n').forEach((line, i) => ctx.fillText(line, a.x, a.y + i * font * 1.3));
        break;
      }
      case 'number': {
        const r = item.size * 2 + 10;
        ctx.arc(a.x, a.y, r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ffffff'; ctx.font = `600 ${r * 1.15}px -apple-system, "Segoe UI", sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(item.number ?? 1), a.x, a.y + 1);
        break;
      }
      case 'mosaic': {
        if (rect.width < 1 || rect.height < 1) break;
        // Flatten actual pixels, including previous marks. No hidden unredacted layer is exported.
        const transform = ctx.getTransform();
        const px = rect.x * transform.a + transform.e, py = rect.y * transform.d + transform.f;
        const small = document.createElement('canvas');
        small.width = Math.max(1, Math.ceil(rect.width / (item.size * 4)));
        small.height = Math.max(1, Math.ceil(rect.height / (item.size * 4)));
        const smallCtx = small.getContext('2d')!;
        smallCtx.drawImage(ctx.canvas, px, py, rect.width * transform.a, rect.height * transform.d, 0, 0, small.width, small.height);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(small, rect.x, rect.y, rect.width, rect.height);
        break;
      }
    }
    ctx.restore();
  }
}

export async function renderEditedPng(crop: EditorCrop, items: Annotation[]): Promise<Uint8Array<ArrayBuffer>> {
  const bitmap = await createImageBitmap(new Blob([Uint8Array.from(crop.bytes)], { type: 'image/png' }));
  try {
    const canvas = document.createElement('canvas'); canvas.width = crop.width; canvas.height = crop.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0);
    ctx.setTransform(crop.scaleX, 0, 0, crop.scaleY, -crop.originX, -crop.originY);
    drawAnnotations(ctx, items);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('无法生成标注图片')), 'image/png'));
    return new Uint8Array(await blob.arrayBuffer());
  } finally { bitmap.close(); }
}
