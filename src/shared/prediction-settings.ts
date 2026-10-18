import { z } from 'zod';
import type { Result } from './contracts';

export const jevModels = ['jev-1.14.0', 'jev-1.13.0'] as const;
export const predictionSettingsSchema = z.object({
  enabled: z.boolean(),
  model: z.enum(jevModels)
}).strict();
export const savePredictionSettingsSchema = predictionSettingsSchema.extend({
  apiKey: z.string().max(4096).optional()
}).strict();
export type PredictionSettings = z.infer<typeof predictionSettingsSchema>;
export type SavePredictionSettings = z.infer<typeof savePredictionSettingsSchema>;
export type PublicPredictionSettings = PredictionSettings & { hasApiKey: boolean; error: string | null };
export const defaultPredictionSettings: PredictionSettings = { enabled: false, model: 'jev-1.14.0' };
export type PredictionSettingsAPI = {
  get(): Promise<Result<PublicPredictionSettings>>;
  save(value: SavePredictionSettings): Promise<Result<PublicPredictionSettings>>;
  openConsole(): Promise<Result<void>>;
};
