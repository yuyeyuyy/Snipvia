import { z } from 'zod';
export const capturePreferencesSchema = z.strictObject({
  shortcut: z.string().trim().min(1).max(100),
  editorShortcut: z.string().trim().min(1).max(100)
}).refine(value => value.shortcut !== value.editorShortcut, '截图快捷键不能相同');
export type CapturePreferences = z.infer<typeof capturePreferencesSchema>;
