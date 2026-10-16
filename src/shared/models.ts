import { z } from 'zod';
import { isProviderEndpoint, providerIds } from './providers';

export const capabilityIds = ['textInput', 'vision', 'imageGeneration', 'videoUnderstanding', 'audioInput', 'toolCalling', 'reasoning', 'structuredOutput'] as const;
export type ModelCapability = typeof capabilityIds[number];
export const capabilityLabels: Record<ModelCapability, string> = {
  textInput: '文本输入', vision: '图片理解', imageGeneration: '图片生成', videoUnderstanding: '视频理解',
  audioInput: '音频输入', toolCalling: '工具调用', reasoning: '深度推理', structuredOutput: '结构化输出'
};
export const capabilityStatusSchema = z.enum(['supported', 'unsupported', 'unknown']);
export type CapabilityStatus = z.infer<typeof capabilityStatusSchema>;
const capabilityShape = Object.fromEntries(capabilityIds.map(id => [id, capabilityStatusSchema])) as Record<ModelCapability, typeof capabilityStatusSchema>;
export const modelCapabilitiesSchema = z.object(capabilityShape);
export type ModelCapabilities = z.infer<typeof modelCapabilitiesSchema>;
export const evidenceSchema = z.object({
  source: z.enum(['api', 'documentation', 'verification']), detail: z.string().max(300),
  checkedAt: z.string().datetime(), url: z.string().url().max(600).optional()
});
export type CapabilityEvidence = z.infer<typeof evidenceSchema>;
export const modelScopeSchema = z.object({
  provider: z.enum(providerIds), endpoint: z.string().url().max(500).refine(value => {
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash;
    } catch { return false; }
  }, '接口地址无效')
}).refine(value => isProviderEndpoint(value.provider, value.endpoint), '厂商与接口地址不匹配');
export type ModelScope = z.infer<typeof modelScopeSchema>;
export const hasModelControlCharacters = (value: string) => Array.from(value).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
export const modelIdSchema = z.string().trim().min(1).max(200).refine(value => !hasModelControlCharacters(value), '模型 ID 无效');
export const modelListRequestSchema = modelScopeSchema.safeExtend({ apiKey: z.string().max(4096).optional(), refresh: z.boolean().default(false) });
export type ModelListRequest = z.input<typeof modelListRequestSchema>;
export const modelTestRequestSchema = modelListRequestSchema.safeExtend({ model: modelIdSchema, confirmCost: z.literal(true) });
export type ModelTestRequest = z.input<typeof modelTestRequestSchema>;
export const modelAddRequestSchema = modelListRequestSchema.safeExtend({ model: modelIdSchema });
export const visionTestSchema = z.object({
  outcome: z.enum(['supported', 'unsupported', 'authentication', 'permission', 'balance', 'rateLimit', 'network', 'modelUnavailable', 'invalidRequest', 'inconclusive']),
  message: z.string().max(500), checkedAt: z.string().datetime(), httpStatus: z.number().int().optional(),
  protocol: z.enum(['chat-completions', 'anthropic-messages', 'gemini-generate-content'])
});
export type VisionTestResult = z.infer<typeof visionTestSchema>;
export const modelInfoSchema = z.object({
  provider: z.enum(providerIds), endpoint: z.string().max(500), id: modelIdSchema, name: z.string().min(1).max(200),
  capabilities: modelCapabilitiesSchema,
  evidence: z.partialRecord(z.enum(capabilityIds), evidenceSchema),
  source: z.enum(['api', 'documentation', 'manual']), discoveredAt: z.string().datetime(),
  endpointId: z.boolean().default(false), visionTest: visionTestSchema.optional()
});
export type ModelInfo = z.infer<typeof modelInfoSchema>;
export const modelCatalogSchema = z.object({
  models: z.array(modelInfoSchema).max(3000), fetchedAt: z.string().datetime(),
  fromCache: z.boolean(), stale: z.boolean(), method: z.string().max(400), warning: z.string().max(500).optional()
});
export type ModelCatalogResult = z.infer<typeof modelCatalogSchema>;
export type ModelCatalogAPI = {
  list(value: ModelListRequest): Promise<import('./contracts').Result<ModelCatalogResult>>;
  add(value: z.input<typeof modelAddRequestSchema>): Promise<import('./contracts').Result<ModelInfo>>;
  testVision(value: ModelTestRequest): Promise<import('./contracts').Result<ModelInfo>>;
};
export function unknownCapabilities(): ModelCapabilities {
  return Object.fromEntries(capabilityIds.map(id => [id, 'unknown'])) as ModelCapabilities;
}
