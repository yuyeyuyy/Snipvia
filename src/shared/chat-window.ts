import { z } from 'zod';

/** Size only; the Main process chooses the owning window, display and position. */
export const chatWindowSizeSchema = z.strictObject({ width: z.number().int().min(1).max(10000), height: z.number().int().min(1).max(10000) });
