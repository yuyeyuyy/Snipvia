import { providerFor } from '../../../shared/providers';
import { unknownCapabilities, type ModelCapability, type ModelInfo, type ModelScope, type CapabilityStatus } from '../../../shared/models';

export const documentationDate = '2026-10-09T00:00:00.000Z';
export const modelDocumentation = {
  openai: 'https://developers.openai.com/api/docs/models',
  anthropic: 'https://platform.claude.com/docs/en/models/opus-5-5/overview',
  gemini: 'https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash',
  xai: 'https://docs.x.ai/developers/models/grok-4.3',
  qwen: 'https://help.aliyun.com/zh/model-studio/vision',
  deepseek: 'https://api-docs.deepseek.com/quick_start/pricing/',
  kimi: 'https://platform.kimi.com/docs/guide/kimi-k2-6-quickstart',
  zhipu: 'https://docs.bigmodel.cn/cn/guide/models/vlm/glm-4.6v',
  doubao: 'https://docs.volcengine.com/docs/82379/1330310?lang=en',
  qianfan: 'https://cloud.baidu.com/doc/qianfan-api/s/Dmba8k71y',
  hunyuan: 'https://cloud.tencent.cn/document/product/1729/111007'
} as const;

type Mapping = Partial<Record<ModelCapability, CapabilityStatus>>;
// Exact IDs only. Missing entries, fine-tunes and Endpoint IDs never inherit by name.
const documented: Partial<Record<ModelScope['provider'], Record<string, Mapping>>> = {
  openai: {
    ...Object.fromEntries(['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-luna', 'gpt-6-sol'].map(id => [id, { textInput: 'supported', vision: 'supported', reasoning: 'supported', imageGeneration: 'unsupported', audioInput: 'unsupported', videoUnderstanding: 'unsupported', toolCalling: 'supported', structuredOutput: 'supported' } as Mapping])),
    'gpt-4.1': { textInput: 'supported', vision: 'supported', imageGeneration: 'unsupported', audioInput: 'unsupported', videoUnderstanding: 'unsupported', toolCalling: 'supported', structuredOutput: 'supported' },
    'gpt-4.1-mini': { textInput: 'supported', vision: 'supported', imageGeneration: 'unsupported', audioInput: 'unsupported', videoUnderstanding: 'unsupported', toolCalling: 'supported', structuredOutput: 'supported' }
  },
  anthropic: { 'claude-opus-5-5': { textInput: 'supported', vision: 'supported', reasoning: 'supported' } },
  xai: Object.fromEntries(['grok-4.3', 'grok-4.3-latest'].map(id => [id, { textInput: 'supported', vision: 'supported', reasoning: 'supported', toolCalling: 'supported', structuredOutput: 'supported' } as Mapping])),
  gemini: {
    'gemini-3.8-flash': { textInput: 'supported', vision: 'supported', videoUnderstanding: 'supported', audioInput: 'supported', reasoning: 'supported', toolCalling: 'supported', structuredOutput: 'supported', imageGeneration: 'unsupported' }
  },
  qwen: Object.fromEntries(['qwen3.8-max', 'qwen3.8-flash', 'qwen3-vl-plus', 'qwen3-vl-flash', 'qwen-vl-plus', 'qwen-vl-max'].map(id => [id, { textInput: 'supported', vision: 'supported', videoUnderstanding: 'supported', imageGeneration: 'unsupported' }])) as Record<string, Mapping>,
  deepseek: {
    'deepseek-flash': { textInput: 'supported', vision: 'supported', reasoning: 'supported', toolCalling: 'supported', structuredOutput: 'supported', imageGeneration: 'unsupported' },
    'deepseek-v4-pro': { textInput: 'supported', vision: 'unsupported', reasoning: 'supported', toolCalling: 'supported', structuredOutput: 'supported', imageGeneration: 'unsupported' }
  },
  kimi: { 'kimi-k2.6': { textInput: 'supported', vision: 'supported', reasoning: 'supported', toolCalling: 'supported' } },
  zhipu: Object.fromEntries(['glm-4.6v', 'glm-4.6v-flashx', 'glm-4.6v-flash'].map(id => [id, { textInput: 'supported', vision: 'supported', videoUnderstanding: 'supported', reasoning: 'supported', toolCalling: 'supported', imageGeneration: 'unsupported' }])) as Record<string, Mapping>,
  doubao: {
    'doubao-seed-2-0-lite-260428': { textInput: 'supported', vision: 'supported', reasoning: 'supported', toolCalling: 'supported', structuredOutput: 'supported' },
    'doubao-seed-2-0-mini-260428': { textInput: 'supported', vision: 'supported', reasoning: 'supported', toolCalling: 'supported', structuredOutput: 'supported' }
  },
  qianfan: { 'ernie-4.5-turbo-vl-32k': { textInput: 'supported', vision: 'supported', imageGeneration: 'unsupported' } },
  hunyuan: { 'hunyuan-vision': { textInput: 'supported', vision: 'supported' } }
};

export function newModel(scope: ModelScope, id: string, name: string, source: ModelInfo['source'], now: string): ModelInfo {
  const model: ModelInfo = { provider: scope.provider, endpoint: scope.endpoint, id, name: name === id ? providerFor(scope.provider).models.find(item => item.id === id)?.name ?? name : name, source, discoveredAt: now, endpointId: scope.provider === 'doubao' && /^ep-/.test(id), capabilities: unknownCapabilities(), evidence: {} };
  const mapping = documented[scope.provider]?.[id];
  if (!model.endpointId && mapping && scope.provider in modelDocumentation) {
    for (const [key, status] of Object.entries(mapping)) {
      const capability = key as ModelCapability;
      model.capabilities[capability] = status;
      model.evidence[capability] = { source: 'documentation', checkedAt: documentationDate, detail: `官方模型文档：${id}`, url: scope.provider === 'openai' ? `https://developers.openai.com/api/docs/models/${id}` : modelDocumentation[scope.provider as keyof typeof modelDocumentation] };
    }
  }
  return model;
}

export function staticModels(scope: ModelScope, now: string): ModelInfo[] {
  return providerFor(scope.provider).models.map(model => newModel(scope, model.id, model.name, 'documentation', now));
}
