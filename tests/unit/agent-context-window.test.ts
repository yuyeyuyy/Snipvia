import { describe, expect, it } from 'vitest';
import { agentLimitsForModel, modelContextWindow } from '../../src/main/ai/llm/contextWindow';
import { providers } from '../../src/shared/providers';

describe('按模型配置 Agent 上下文窗口', () => {
  it('大窗口系列按 128K 工作上限，网关前缀不影响识别', () => {
    for (const model of ['gpt-4.1-mini', 'openai/gpt-4.1-mini', 'qwen3.8-max', 'Qwen/Qwen3-VL-235B-A22B-Instruct', 'gemini-3.8-flash', 'deepseek-flash', 'kimi-k2.6', 'glm-4.6v', 'doubao-seed-2-0-lite-260428']) {
      expect(modelContextWindow(model), model).toBe(131_072);
    }
    expect(agentLimitsForModel('gpt-4.1')).toEqual({ maxContextTokens: 131_072, maxOutputTokens: 8192 });
  });
  it('旧模型、自定义与本地模型使用保守的 32K，避免超出真实窗口', () => {
    for (const model of ['qwen-vl-plus', 'qwen-vl-max', 'llava:13b', 'ep-20260101-abcde', '']) expect(modelContextWindow(model), model).toBe(32_768);
    expect(agentLimitsForModel('llava:13b')).toEqual({ maxContextTokens: 32_768, maxOutputTokens: 8192 });
  });
  it('既有已识别系列继续使用大窗口，新厂商不因进入目录就扩大 Agent 预算', () => {
    const conservativeProviders = new Set(['xai']);
    const presets = providers.filter(provider => !conservativeProviders.has(provider.id)).flatMap((provider) => provider.models.map((model) => model.id)).filter((id) => !/^qwen-vl-|^gpt-6/.test(id));
    expect(presets.filter((id) => modelContextWindow(id) !== 131_072)).toEqual([]);
    for (const id of ['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-luna', 'gpt-6-sol']) expect(modelContextWindow(id)).toBe(32_768);
    for (const provider of providers.filter(provider => conservativeProviders.has(provider.id))) {
      for (const model of provider.models) expect(modelContextWindow(model.id), model.id).toBe(32_768);
    }
  });
});
