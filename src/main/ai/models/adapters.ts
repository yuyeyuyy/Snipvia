import { type ProviderId } from '../../../shared/providers';
import { hasModelControlCharacters, modelIdSchema, type ModelScope, type ModelInfo, type ModelCapability, type CapabilityStatus } from '../../../shared/models';
import { newModel, staticModels } from './catalogue-mapping';
import { ModelAPIError, type ModelJSONRequest } from './http';

export type AdapterContext = ModelScope & { apiKey: string; now: string; request: ModelJSONRequest };
export type AdapterListing = { models: ModelInfo[]; method: string; warning?: string };
export interface ModelProviderAdapter {
  readonly provider: ProviderId;
  list(context: AdapterContext): Promise<AdapterListing>;
  parseModel(value: unknown, context: AdapterContext): ModelInfo | null;
}
const listSources: Partial<Record<ProviderId, string>> = {
  openai: 'https://developers.openai.com/api/reference/resources/models/methods/list',
  anthropic: 'https://platform.claude.com/docs/en/api/models/list',
  gemini: 'https://ai.google.dev/api/models',
  xai: 'https://docs.x.ai/developers/rest-api-reference/inference/models',
  qwen: 'https://help.aliyun.com/zh/model-studio/list-models',
  deepseek: 'https://api-docs.deepseek.com/api/list-models/',
  kimi: 'https://platform.kimi.com/docs/api/list-models',
  qianfan: 'https://cloud.baidu.com/doc/qianfan-api/s/Dmba8k71y',
  openrouter: 'https://openrouter.ai/docs/api/api-reference/models/get-models',
  siliconflow: 'https://siliconflow.readme.io/reference/retrieve-a-list-of-models'
};
export function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function strings(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.length > 0 && value.every(item => typeof item === 'string') ? value as string[] : undefined;
}
function setCapability(model: ModelInfo, context: AdapterContext, key: ModelCapability, value: CapabilityStatus, field: string) {
  model.capabilities[key] = value;
  model.evidence[key] = { source: 'api', checkedAt: context.now, detail: field, url: listSources[context.provider] };
}
function booleanCapability(model: ModelInfo, context: AdapterContext, key: ModelCapability, value: unknown, field: string) {
  if (typeof value === 'boolean') setCapability(model, context, key, value ? 'supported' : 'unsupported', field);
}
function modalities(model: ModelInfo, context: AdapterContext, input: unknown, output: unknown, field: string) {
  const inputs = strings(input)?.map(value => value.toLowerCase());
  const outputs = strings(output)?.map(value => value.toLowerCase());
  if (inputs?.some(value => ['text', 'image', 'video', 'audio', 'voice'].includes(value))) {
    for (const [key, names] of Object.entries({ textInput: ['text'], vision: ['image'], videoUnderstanding: ['video'], audioInput: ['audio', 'voice'] })) {
      // Image conditioning/editing is not proof of image understanding.
      if (key === 'vision' && outputs && !outputs.includes('text')) continue;
      setCapability(model, context, key as ModelCapability, names.some(value => inputs.includes(value)) ? 'supported' : 'unsupported', `${field}.input`);
    }
  }
  if (outputs?.some(value => ['text', 'image', 'video', 'audio', 'voice'].includes(value))) {
    setCapability(model, context, 'imageGeneration', outputs.includes('image') ? 'supported' : 'unsupported', `${field}.output`);
  }
}

class ProviderAdapter implements ModelProviderAdapter {
  constructor(readonly provider: ProviderId) {}

  parseModel(value: unknown, context: AdapterContext): ModelInfo | null {
    const raw = object(value);
    if (raw.lifecycle === 'retired') return null;
    const id = this.provider === 'gemini' ? (typeof raw.name === 'string' ? raw.name.replace(/^models\//, '') : undefined)
      : this.provider === 'qwen' ? raw.model : raw.id;
    const parsed = modelIdSchema.safeParse(id);
    if (!parsed.success || (context.apiKey && parsed.data.includes(context.apiKey))) return null;
    const label = raw.display_name ?? raw.displayName ?? raw.name;
    const name = typeof label === 'string' && label.trim() && label.length <= 200 && !hasModelControlCharacters(label) && (!context.apiKey || !label.includes(context.apiKey)) ? label : parsed.data;
    const model = newModel(context, parsed.data, name, 'api', context.now);
    // A deployment ID is opaque: capabilities of similarly named base models do not apply.
    if (model.endpointId) return model;
    switch (this.provider) {
      case 'anthropic': {
        const caps = object(raw.capabilities);
        booleanCapability(model, context, 'vision', object(caps.image_input).supported, 'capabilities.image_input.supported');
        booleanCapability(model, context, 'reasoning', object(caps.thinking).supported, 'capabilities.thinking.supported');
        booleanCapability(model, context, 'structuredOutput', object(caps.structured_outputs).supported, 'capabilities.structured_outputs.supported');
        break;
      }
      case 'gemini': {
        const methods = strings(raw.supportedGenerationMethods);
        if (methods?.includes('generateContent')) setCapability(model, context, 'textInput', 'supported', 'supportedGenerationMethods=generateContent');
        booleanCapability(model, context, 'reasoning', raw.thinking, 'thinking');
        break;
      }
      case 'deepseek':
      case 'xai': {
        modalities(model, context, raw.input_modalities, raw.output_modalities, 'modalities');
        if (strings(object(raw.effort).supported_levels)?.length || strings(object(raw.capabilities).reasoning_effort)?.length) {
          setCapability(model, context, 'reasoning', 'supported', this.provider === 'deepseek' ? 'effort.supported_levels' : 'capabilities.reasoning_effort');
        }
        break;
      }
      case 'kimi': {
        booleanCapability(model, context, 'vision', raw.supports_image_in, 'supports_image_in');
        booleanCapability(model, context, 'videoUnderstanding', raw.supports_video_in, 'supports_video_in');
        booleanCapability(model, context, 'reasoning', raw.supports_reasoning, 'supports_reasoning');
        break;
      }
      case 'qwen': {
        const metadata = object(raw.inference_metadata);
        modalities(model, context, metadata.request_modality, metadata.response_modality, 'inference_metadata');
        const caps = strings(raw.capabilities);
        for (const [key, flag] of Object.entries({ vision: 'VU', imageGeneration: 'IG', reasoning: 'Reasoning', audioInput: 'ASR' })) {
          if (caps?.includes(flag)) setCapability(model, context, key as ModelCapability, 'supported', `capabilities=${flag}`);
        }
        const features = strings(raw.features);
        if (features?.includes('function-calling')) setCapability(model, context, 'toolCalling', 'supported', 'features=function-calling');
        if (features?.includes('structured-outputs')) setCapability(model, context, 'structuredOutput', 'supported', 'features=structured-outputs');
        break;
      }
      case 'qianfan':
      case 'openrouter': {
        const architecture = object(raw.architecture);
        modalities(model, context, architecture.input_modalities, architecture.output_modalities, 'architecture');
        if (this.provider === 'openrouter') {
          const parameters = strings(raw.supported_parameters);
          for (const [key, parameter] of Object.entries({ toolCalling: 'tools', reasoning: 'reasoning', structuredOutput: 'structured_outputs' })) {
            if (parameters?.includes(parameter)) setCapability(model, context, key as ModelCapability, 'supported', `supported_parameters=${parameter}`);
          }
        }
        break;
      }
      // Plain OpenAI /models and arbitrary compatible responses have no standardized capability fields.
    }
    return model;
  }

  async list(context: AdapterContext): Promise<AdapterListing> {
    const base = context.endpoint.replace(/\/+$/, '');
    const headers: Record<string, string> = context.apiKey ? { Authorization: `Bearer ${context.apiKey}` } : {};
    const fallback = (warning: string): AdapterListing => ({ models: staticModels(context, context.now), method: '官方文档维护清单', warning });
    if (this.provider === 'zhipu' || this.provider === 'hunyuan') return fallback('尚未核实该 API Key 接口的官方模型列表协议；清单不代表账号可调用，支持手动添加和图片验证。');
    if (this.provider === 'doubao') return fallback('方舟基础模型目录使用 Access Key 签名鉴权，现有 API Key 配置采用官方清单；ep- 接入点需手动添加并验证。');
    let url = `${base}/models`;
    if (this.provider === 'qwen') {
      const origin = new URL(base).origin;
      if (origin === 'https://dashscope.aliyuncs.com' || origin === 'https://maas.qianwenaiapi.com') {
        return fallback('百炼北京动态目录需要业务空间专属 Base URL；千问平台目录协议尚未核实。当前展示官方文档清单。');
      }
      url = `${origin}/api/v1/models?page_no=1&page_size=100`;
    }
    if (this.provider === 'anthropic') {
      delete headers.Authorization;
      headers['x-api-key'] = context.apiKey; headers['anthropic-version'] = '2023-06-01';
      url += '?limit=1000';
    }
    if (this.provider === 'gemini') {
      delete headers.Authorization; headers['x-goog-api-key'] = context.apiKey;
      url = `${new URL(base).origin}/v1beta/models?pageSize=1000`;
    }
    const models: ModelInfo[] = [];
    const seen = new Set<string>();
    for (let page = 1; page <= 30; page++) {
      const raw = object(await context.request(url, { headers }));
      const items = this.provider === 'qwen' ? object(raw.output).models : this.provider === 'gemini' ? raw.models : raw.data;
      if (!Array.isArray(items)) throw new ModelAPIError('invalidResponse');
      for (const item of items) {
        const parsed = this.parseModel(item, context);
        if (parsed && !seen.has(parsed.id)) { seen.add(parsed.id); models.push(parsed); }
      }
      if (models.length > 3000) throw new ModelAPIError('invalidResponse');
      let cursor: string | undefined;
      if (this.provider === 'anthropic' && raw.has_more === true) cursor = typeof raw.last_id === 'string' ? raw.last_id : '';
      if (this.provider === 'gemini' && raw.nextPageToken) cursor = typeof raw.nextPageToken === 'string' ? raw.nextPageToken : '';
      if (cursor !== undefined) {
        if (!cursor || cursor.length > 2000 || items.length === 0 || page === 30) throw new ModelAPIError('invalidResponse');
        const next = new URL(url);
        const key = this.provider === 'anthropic' ? 'after_id' : 'pageToken';
        if (next.searchParams.get(key) === cursor) throw new ModelAPIError('invalidResponse');
        next.searchParams.set(key, cursor); url = next.toString(); continue;
      }
      if (this.provider === 'qwen' && typeof object(raw.output).total === 'number' && page * 100 < Number(object(raw.output).total)) {
        if (items.length === 0 || page === 30) throw new ModelAPIError('invalidResponse');
        const next = new URL(url); next.searchParams.set('page_no', String(page + 1)); url = next.toString(); continue;
      }
      if (items.length && !models.length) throw new ModelAPIError('invalidResponse');
      break;
    }
    let warning: string | undefined;
    if (this.provider === 'xai') {
      // /models is the account catalogue; specialized lists enrich only matching IDs.
      for (const kind of ['language-models', 'image-generation-models'] as const) {
        try {
          const extra = object(await context.request(`${base}/${kind}`, { headers }));
          if (!Array.isArray(extra.models)) throw new ModelAPIError('invalidResponse');
          for (const item of extra.models) {
            const enriched = this.parseModel(item, context);
            if (enriched) {
              if (kind === 'image-generation-models') setCapability(enriched, context, 'imageGeneration', 'supported', '/image-generation-models');
              const aliases = strings(object(item).aliases) ?? [];
              for (const model of models.filter(model => model.id === enriched.id || aliases.includes(model.id))) {
                for (const key of Object.keys(enriched.capabilities) as ModelCapability[]) {
                  if (enriched.capabilities[key] !== 'unknown') {
                    model.capabilities[key] = enriched.capabilities[key]; model.evidence[key] = enriched.evidence[key];
                  }
                }
              }
            }
          }
        } catch { warning = '账号目录已获取，部分 xAI 模态目录获取失败；未返回的能力保留 unknown。'; }
      }
    }
    return { models, method: this.provider === 'xai' ? 'GET /models + /language-models + /image-generation-models' : `GET ${new URL(url).pathname}`, warning };
  }
}

const adapters = new Map<ProviderId, ModelProviderAdapter>();
export function modelProviderAdapter(provider: ProviderId): ModelProviderAdapter {
  let adapter = adapters.get(provider);
  if (!adapter) { adapter = new ProviderAdapter(provider); adapters.set(provider, adapter); }
  return adapter;
}
