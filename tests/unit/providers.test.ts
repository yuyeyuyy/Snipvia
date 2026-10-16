import { describe, expect, it } from 'vitest';
import { defaults, settingsSchema } from '../../src/shared/contracts';
import { credentialScope, inferProvider, modelProfileLabel, providerEndpoints, providerFor, providers } from '../../src/shared/providers';

describe('客户端视觉厂商配置', () => {
  it('移除四家厂商入口，旧配置仍可读取并作为自定义服务展示', () => {
    for (const id of ['qianfan', 'hunyuan', 'siliconflow', 'openrouter'] as const) {
      expect(providers.some(provider => provider.id === id)).toBe(false);
      const preset = providerFor(id);
      const profile = { provider: id, endpoint: preset.endpoint, model: preset.models[0].id };
      expect(settingsSchema.parse({ ...defaults, ...profile }).provider).toBe(id);
      expect(modelProfileLabel(profile, [profile])).toContain('自定义服务');
      expect(credentialScope(profile)).toBe(`${id}:${preset.endpoint}`);
    }
  });
  it.each(providers.filter((provider) => provider.id !== 'custom'))('接受 $name 的官方预设及完整视觉模型 ID', (provider) => {
    for (const endpoint of providerEndpoints(provider.id)) {
      const settings = settingsSchema.parse({ ...defaults, provider: provider.id, endpoint: endpoint.url, model: provider.models[0].id });
      expect(inferProvider(settings.endpoint + '/')).toBe(provider.id);
    }
  });
  it('允许百炼业务空间地址，但拒绝厂商错配、相似域名和 URL 凭据', () => {
    const endpoint = 'https://workspace.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1';
    expect(settingsSchema.parse({ ...defaults, provider: 'qwen', endpoint }).endpoint).toBe(endpoint);
    for (const bad of [endpoint.replace('aliyuncs.com', 'aliyuncs.com.evil.test'), endpoint + '?key=secret', endpoint.replace('workspace.', 'key:password@workspace.'), 'https://api.deepseek.com']) {
      expect(settingsSchema.safeParse({ ...defaults, provider: 'qwen', endpoint: bad }).success).toBe(false);
    }
  });
  it('将同厂商不同接口的密钥与配置隔离，并保留旧作用域', () => {
    expect(credentialScope({ provider: 'qwen', endpoint: providerFor('qwen').endpoint })).toBe('qwen:https://dashscope.aliyuncs.com/compatible-mode/v1');
    expect(credentialScope({ provider: 'qwen', endpoint: 'https://maas.qianwenaiapi.com/compatible-mode/v1/' })).not.toBe(credentialScope({ provider: 'qwen', endpoint: providerFor('qwen').endpoint }));
  });
  it('拒绝 DeepSeek 纯文字 Pro 模型，仍接受用户输入的兼容服务模型 ID', () => {
    expect(settingsSchema.safeParse({ ...defaults, provider: 'deepseek', endpoint: providerFor('deepseek').endpoint, model: 'deepseek-v4-pro' }).success).toBe(false);
    expect(settingsSchema.parse({ ...defaults, provider: 'custom', endpoint: 'http://localhost:1234/v1', model: 'local-vision' }).model).toBe('local-vision');
  });
  it('重名模型显示接口来源，普通悬浮选择仍只显示模型 ID', () => {
    const beijing = { provider: 'qwen' as const, endpoint: providerFor('qwen').endpoint, model: 'qwen3-vl-plus' };
    const platform = { ...beijing, endpoint: 'https://maas.qianwenaiapi.com/compatible-mode/v1' };
    expect(modelProfileLabel(beijing, [beijing], true)).toBe('qwen3-vl-plus');
    expect(modelProfileLabel(beijing, [beijing, platform])).toContain('百炼 · 北京');
    expect(modelProfileLabel(platform, [beijing, platform])).toContain('千问平台');
    expect(modelProfileLabel(platform, [beijing, platform], true)).toContain('千问平台');
  });
});
