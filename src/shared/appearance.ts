import { z } from 'zod';

export const themeModeSchema = z.enum(['system', 'light', 'dark']);
export type ThemeMode = z.infer<typeof themeModeSchema>;
export const defaultChatFontSize = 15;
export const chatFontSizeSchema = z.number().int().min(12).max(24);
export type ThemeSnapshot = { mode: ThemeMode; resolved: 'light' | 'dark'; revision: number; chatFontSize?: number };
