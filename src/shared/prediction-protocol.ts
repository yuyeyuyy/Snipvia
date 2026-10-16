import { z } from 'zod';

const action = z.union([
  z.enum(['explain-error', 'explain-code', 'understand-text', 'analyze-table', 'analyze-ui', 'answer-question', 'describe-image', 'create-schedule', 'translate', 'ocr', 'ask-ai']),
  z.string().regex(/^custom:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
]);
export const predictionContentTypeSchema = z.enum(['error', 'code', 'text', 'table', 'ui', 'question', 'unknown']);
export const screenshotPredictionRequestSchema = z.object({
  image: z.string().max(2_000_000).regex(/^data:image\/(?:jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/, '请提供选中区域的 JPEG 或 PNG 截图'),
  branches: z.array(z.object({ id: action, applicableContent: z.string().trim().min(1).max(1000) }).strict()).min(1).max(30)
}).strict().superRefine((value, ctx) => {
  if (new Set(value.branches.map(branch => branch.id)).size !== value.branches.length) ctx.addIssue({ code: 'custom', message: '分支 ID 不能重复' });
});
export type ScreenshotPredictionRequest = z.infer<typeof screenshotPredictionRequestSchema>;
export const screenshotPredictionResponseSchema = z.object({
  contentType: predictionContentTypeSchema, confidence: z.number().finite().min(0).max(1), matchedBranchId: action.nullable(),
  recommendedAction: action,
  signals: z.object({ hasSchedule: z.boolean() }).strict()
}).strict();
export type ScreenshotPredictionResponse = z.infer<typeof screenshotPredictionResponseSchema>;

export const predictionServiceSchema = z.union([
  z.object({ provider: z.literal('typesafe'), model: z.string().regex(/^[a-zA-Z0-9._-]{1,100}$/), input: z.literal('image'), timeoutMs: z.number().int().min(3000).max(60_000) }).strict(),
  z.object({ provider: z.null() }).strict()
]);
