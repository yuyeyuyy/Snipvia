import { z } from 'zod';
export const shelfSizeSchema = z.strictObject({
  width: z.number().int().min(280).max(960),
  height: z.number().int().min(300).max(1600)
});
export type ShelfSize = z.infer<typeof shelfSizeSchema>;
export const defaultShelfSize: ShelfSize = { width: 420, height: 660 };
export const shelfResizeSchema = shelfSizeSchema.extend({ commit: z.boolean().default(true) });
export const shelfPreferencesSchema = shelfSizeSchema.extend({
  heightMode: z.enum(['screen', 'fixed']).default('screen'),
  autoHide: z.boolean().default(true),
  hideDelayMs: z.number().int().min(600).max(10000).default(1800),
  mergeWidth: z.union([z.literal(800), z.literal(1600), z.literal(2048), z.literal(4096)]).default(1600),
  gap: z.number().int().min(0).max(64).default(12)
});
export type ShelfPreferences = z.infer<typeof shelfPreferencesSchema>;
export const defaultShelfPreferences: ShelfPreferences = shelfPreferencesSchema.parse(defaultShelfSize);
