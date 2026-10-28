import { z } from 'zod';

export const themeModeSchema = z.enum(['system', 'light', 'dark']);
export type ThemeMode = z.infer<typeof themeModeSchema>;
export type ThemeSnapshot = { mode: ThemeMode; resolved: 'light' | 'dark'; revision: number };
