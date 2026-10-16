export const providerIds = ['openai', 'anthropic', 'gemini', 'xai', 'qwen', 'deepseek', 'zhipu', 'kimi', 'doubao', 'qianfan', 'hunyuan', 'siliconflow', 'openrouter', 'custom'] as const;
export type ProviderId = typeof providerIds[number];
export type ProviderPreset = {
  id: ProviderId;
  name: string;
  subtitle: string;
  mark: string;
  endpoint: string;
  endpoints?: { name: string; url: string }[];
  models: { id: string; name: string }[];
  hint: string;
};

const providerRegistry: ProviderPreset[] = [
  {
    id: 'openai', name: 'OpenAI', subtitle: 'GPT 视觉模型', mark: 'O',
    endpoint: 'https://api.openai.com/v1',
    models: [
      { id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol' },
      { id: 'gpt-6-astra', name: 'GPT-6 Astra' },
      { id: 'gpt-6-luna', name: 'GPT-6 Luna' },
      { id: 'gpt-6-sol', name: 'GPT-6 Sol' },
      { id: 'gpt-4.1-mini', name: 'GPT-4.1 mini' },
      { id: 'gpt-4.1', name: 'GPT-4.1' }
    ],
    hint: '使用 OpenAI 开发者平台的 API Key。'
  },
  {
    id: 'anthropic', name: 'Anthropic Claude', subtitle: 'Claude 官方兼容接口', mark: 'A',
    endpoint: 'https://api.anthropic.com/v1',
    models: [{ id: 'claude-opus-5-5', name: 'Claude Opus 5.5' }],
    hint: '使用 Claude API Key；原生模型目录和图片测试直接访问 Anthropic，日常对话复用官方 OpenAI 兼容接口。'
  },
  {
    id: 'xai', name: 'xAI Grok', subtitle: 'Grok 官方模型目录', mark: 'X',
    endpoint: 'https://api.x.ai/v1',
    models: [{ id: 'grok-4.3-latest', name: 'Grok 4.3 Latest' }],
    hint: '使用 xAI API Key；模型目录返回的输入模态优先用于识别图片能力。'
  },
  {
    id: 'qianfan', name: '百度千帆', subtitle: 'ERNIE / 千帆模型平台', mark: '百',
    endpoint: 'https://qianfan.baidubce.com/v2',
    models: [{ id: 'ernie-4.5-turbo-vl-32k', name: 'ERNIE 4.5 Turbo VL 32K' }],
    hint: '使用千帆 API Key（不是旧版 OAuth Access Token）。目录可见不代表已获得该模型的调用权限。'
  },
  {
    id: 'hunyuan', name: '腾讯混元', subtitle: '混元官方 OpenAI 兼容接口', mark: '混',
    endpoint: 'https://api.hunyuan.cloud.tencent.com/v1',
    models: [{ id: 'hunyuan-vision', name: '混元 Vision' }],
    hint: '使用混元 API Key（不是腾讯云 SecretId / SecretKey）；模型目录采用官方文档维护清单，支持手动填写 ID。'
  },
  {
    id: 'qwen', name: '通义千问', subtitle: '千问平台 / 阿里云百炼', mark: 'Q',
    endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    endpoints: [
      { name: '百炼 · 北京', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
      { name: '千问平台', url: 'https://maas.qianwenaiapi.com/compatible-mode/v1' },
      { name: '百炼 · 新加坡', url: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1' },
      { name: '百炼 · 香港', url: 'https://cn-hongkong.dashscope.aliyuncs.com/compatible-mode/v1' }
    ],
    models: [
      { id: 'qwen3.8-max', name: 'Qwen3.8 Max · 图像理解' },
      { id: 'qwen3.8-flash', name: 'Qwen3.8 Flash · 图像理解' },
      { id: 'qwen3-vl-plus', name: 'Qwen3 VL Plus' },
      { id: 'qwen3-vl-flash', name: 'Qwen3 VL Flash' },
      { id: 'qwen-vl-plus', name: 'Qwen VL Plus' },
      { id: 'qwen-vl-max', name: 'Qwen VL Max' }
    ],
    hint: '选择与 Key 来源一致的千问平台或百炼地区。切换接口后密钥独立保存；模型以该接口账号的可用列表为准。'
  },
  {
    id: 'gemini', name: 'Google Gemini', subtitle: 'Gemini 视觉模型', mark: 'G',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai',
    models: [{ id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash' }],
    hint: '使用 Google AI Studio 的 Gemini API Key。'
  },
  {
    id: 'deepseek', name: 'DeepSeek', subtitle: 'Flash 视觉模型', mark: 'D',
    endpoint: 'https://api.deepseek.com',
    models: [{ id: 'deepseek-flash', name: 'DeepSeek Flash · 图像理解' }],
    hint: '使用 DeepSeek 开放平台 Key。deepseek-flash 支持图片；DeepSeek V4 Pro 等纯文字模型不能用于截图。'
  },
  {
    id: 'kimi', name: 'Kimi', subtitle: '月之暗面 · 视觉与工具调用', mark: 'K',
    endpoint: 'https://api.moonshot.cn/v1',
    endpoints: [
      { name: '国内平台', url: 'https://api.moonshot.cn/v1' },
      { name: '国际平台', url: 'https://api.moonshot.ai/v1' }
    ],
    models: [{ id: 'kimi-k2.6', name: 'Kimi K2.6 · 图像理解' }],
    hint: '使用对应国内或国际平台的 API Key，选择支持图片和工具调用的 Kimi 模型。'
  },
  {
    id: 'zhipu', name: '智谱 GLM', subtitle: 'GLM 视觉模型', mark: 'Z',
    endpoint: 'https://open.bigmodel.cn/api/paas/v4',
    endpoints: [
      { name: '智谱开放平台', url: 'https://open.bigmodel.cn/api/paas/v4' },
      { name: 'Z.AI 国际平台', url: 'https://api.z.ai/api/paas/v4' }
    ],
    models: [{ id: 'glm-4.6v', name: 'GLM-4.6V' }, { id: 'glm-4.6v-flash', name: 'GLM-4.6V Flash' }],
    hint: '使用对应开放平台的通用 API Key。GLM-4.6V 支持图片与工具调用，套餐专用 Key 请按其接口说明配置。'
  },
  {
    id: 'doubao', name: '豆包', subtitle: '火山方舟 · Seed 视觉模型', mark: '豆',
    endpoint: 'https://ark.cn-beijing.volces.com/api/v3',
    models: [
      { id: 'doubao-seed-2-0-lite-260428', name: 'Doubao Seed 2.0 Lite' },
      { id: 'doubao-seed-2-0-mini-260428', name: 'Doubao Seed 2.0 Mini' }
    ],
    hint: '使用火山方舟 API Key，并开通所选视觉模型。需要推理接入点时，在「其他模型」填写 ep- 开头的接入点 ID。'
  },
  {
    id: 'siliconflow', name: '硅基流动', subtitle: '第三方平台 · 开源视觉模型', mark: 'S',
    endpoint: 'https://api.siliconflow.cn/v1',
    models: [{ id: 'Qwen/Qwen3-VL-235B-A22B-Instruct', name: 'Qwen3 VL 235B Instruct' }],
    hint: '使用硅基流动 Key。截图发给该平台；请在模型广场确认模型支持图片，Agent 还需要工具调用能力。'
  },
  {
    id: 'openrouter', name: 'OpenRouter', subtitle: '第三方平台 · 多厂商视觉模型', mark: 'R',
    endpoint: 'https://openrouter.ai/api/v1',
    models: [{ id: 'openai/gpt-4.1-mini', name: 'GPT-4.1 mini' }, { id: 'qwen/qwen3-vl-235b-a22b-instruct', name: 'Qwen3 VL 235B Instruct' }],
    hint: '使用 OpenRouter Key。截图经过该平台及其上游；其他模型请填写支持 image 输入与 tools 的完整模型 ID。'
  },
  {
    id: 'custom', name: '自定义服务', subtitle: '其他厂商 / 本地模型', mark: '+', endpoint: '', models: [],
    hint: '填写支持图片输入的 Chat Completions 兼容服务；无认证本地服务可留空密钥。'
  }
];

// Legacy IDs remain readable so upgrades can preserve existing encrypted credentials.
export const retiredProviderIds: readonly ProviderId[] = ['qianfan', 'hunyuan', 'siliconflow', 'openrouter'];
export const providers = providerRegistry.filter(provider => !retiredProviderIds.includes(provider.id));

export function providerFor(id: ProviderId): ProviderPreset {
  return providerRegistry.find((provider) => provider.id === id)!;
}

export function credentialScope(settings: { provider: ProviderId; endpoint: string }): string {
  return `${settings.provider}:${settings.endpoint.replace(/\/+$/, '')}`;
}

export function inferProvider(endpoint: string): ProviderId {
  return providerRegistry.find((provider) => provider.id !== 'custom' && isProviderEndpoint(provider.id, endpoint))?.id ?? 'custom';
}

export function providerEndpoints(id: ProviderId): { name: string; url: string }[] {
  const provider = providerFor(id);
  return provider.endpoints ?? (provider.endpoint ? [{ name: provider.name, url: provider.endpoint }] : []);
}

export function isProviderEndpoint(id: ProviderId, endpoint: string): boolean {
  if (id === 'custom') return true;
  const normalized = endpoint.replace(/\/+$/, '');
  if (providerEndpoints(id).some((entry) => entry.url === normalized)) return true;
  if (id !== 'qwen') return false;
  try {
    const url = new URL(normalized);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.search && !url.hash &&
      url.pathname === '/compatible-mode/v1' && /^[-a-z0-9]+\.(?:ap-southeast-1|cn-beijing|cn-hongkong|ap-northeast-1|us-east-1)\.maas\.aliyuncs\.com$/.test(url.hostname);
  } catch { return false; }
}

export function modelProfileLabel(profile: { provider: ProviderId; endpoint: string; model: string }, profiles: { provider: ProviderId; endpoint: string; model: string }[], modelOnly = false): string {
  const provider = providerFor(retiredProviderIds.includes(profile.provider) ? 'custom' : profile.provider);
  const sameModel = profiles.filter((item) => item.model === profile.model);
  const sameVendor = sameModel.filter((item) => item.provider === profile.provider);
  const source = sameVendor.length > 1 ? providerEndpoints(profile.provider).find((item) => item.url === profile.endpoint.replace(/\/+$/, ''))?.name ?? new URL(profile.endpoint).host : '';
  if (modelOnly) return `${profile.model}${sameModel.length > 1 ? ` · ${provider.name}${source ? ` · ${source}` : ''}` : ''}`;
  return `${provider.name} · ${profile.model}${source ? ` · ${source}` : ''}`;
}
