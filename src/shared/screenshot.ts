import { z } from 'zod';

// Metadata is small and never embeds a bitmap, Base64 image or Conversation ID.
export const screenshotItemSchema = z.strictObject({
  id: z.string().uuid(),
  createdAt: z.string().datetime({ offset: true }),
  width: z.number().int().positive().max(32768),
  height: z.number().int().positive().max(32768),
  mimeType: z.enum(['image/png', 'image/jpeg']),
  status: z.enum(['temporary', 'saved']),
  sourceDisplayId: z.string().max(100).optional(),
  fileName: z.string().regex(/^[0-9a-f-]+\.(png|jpg)$/).optional(),
  legacyCaptureId: z.string().uuid().optional()
});
export type ScreenshotItem = z.infer<typeof screenshotItemSchema>;
export type ScreenshotPreview = Pick<ScreenshotItem, 'id' | 'createdAt' | 'width' | 'height'> & { dataUrl: string; performanceSessionId?: string };
export type ScreenshotImage = { item: ScreenshotItem; bytes: Uint8Array; mimeType: ScreenshotItem['mimeType'] };
export type ScreenshotAPI = {
  list(): Promise<import('./contracts').Result<ScreenshotItem[]>>;
  save(id: string): Promise<import('./contracts').Result<ScreenshotItem>>;
  delete(id: string): Promise<import('./contracts').Result<void>>;
  copy(id: string): Promise<import('./contracts').Result<void>>;
};
