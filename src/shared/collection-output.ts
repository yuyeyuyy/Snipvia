import { z } from 'zod';
export const collectionOutputSchema = z.strictObject({
  ids: z.array(z.string().uuid()).min(1, '请先选择截图').max(32),
  revision: z.number().int().nonnegative()
}).refine(value => new Set(value.ids).size === value.ids.length, '截图不能重复');
export const mergeOptionsSchema = z.strictObject({ width: z.number().int().min(256).max(4096), gap: z.number().int().min(0).max(64) });
export type MergeOptions = z.infer<typeof mergeOptionsSchema>;
export function mergeLayout(items: { width: number; height: number }[], options: MergeOptions) {
  const { width: maximum, gap } = mergeOptionsSchema.parse(options);
  if (!items.length || items.length > 32) throw new Error('请选择 1–32 张截图');
  const sizes = items.map(item => {
    if (!Number.isInteger(item.width) || !Number.isInteger(item.height) || item.width < 1 || item.height < 1 || item.width > 32768 || item.height > 32768) throw new Error('截图尺寸无效');
    const scale = Math.min(1, maximum / item.width);
    return { width: Math.max(1, Math.round(item.width * scale)), height: Math.max(1, Math.round(item.height * scale)) };
  });
  const width = Math.max(...sizes.map(item => item.width));
  const height = sizes.reduce((total, item) => total + item.height, gap * (sizes.length - 1));
  if (height > 32768 || width * height > 32 * 1024 * 1024) throw new Error('合并图片过大，请减少数量或选择较小宽度；原图已保留');
  let y = 0;
  return { width, height, placements: sizes.map(item => { const rect = { ...item, x: Math.floor((width - item.width) / 2), y }; y += item.height + gap; return rect; }) };
}
export function orderedOutputIds(all: string[], selected: string[]) {
  if (!selected.length || new Set(selected).size !== selected.length || selected.some(id => !all.includes(id))) throw new Error('截图选择已失效，请重新选择');
  const chosen = new Set(selected); return all.filter(id => chosen.has(id));
}
