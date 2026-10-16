import type { AgentLimits } from '../../agent/types/agent';

/**
 * Working context per model. Families known to have at least 128K windows use 128K (each
 * Agent step re-sends the whole context, so a larger working set mostly adds cost). Older
 * or unknown models, including custom/local services, use a conservative 32K so requests
 * never exceed the real window; long tasks are compacted instead.
 */
const large = [/^gpt-4\.1/, /^gpt-4o/, /^gpt-5/, /^o[34]/, /^gemini-/, /^deepseek/, /^kimi-k2/, /^moonshot-v1-128k/, /^glm-4\.[5-9]v?/, /^glm-[5-9]/,
  /^qwen3/, /^qwen-(plus|max|turbo|long)/, /^qwen3-vl/, /^doubao-seed/, /^doubao-1\.5/, /^claude-/];
const workingCap = 131_072;
const fallback = 32_768;

export function modelContextWindow(model: string): number {
  // Gateways prefix the vendor ("openai/gpt-4.1-mini", "Qwen/Qwen3-VL-...").
  const id = model.trim().toLowerCase().split('/').at(-1) ?? '';
  return large.some((pattern) => pattern.test(id)) ? workingCap : fallback;
}

export function agentLimitsForModel(model: string): Pick<AgentLimits, 'maxContextTokens' | 'maxOutputTokens'> {
  const window = modelContextWindow(model);
  return { maxContextTokens: window, maxOutputTokens: Math.min(8192, Math.floor(window / 4)) };
}
