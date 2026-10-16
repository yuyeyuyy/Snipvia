import type { ModelProfile } from '../../shared/contracts';

/** Keep model dialects in the transport, shared by chat, classification and Agent. */
export function chatCompletionOptions(settings: ModelProfile): Record<string, unknown> {
  const { provider, model } = settings;
  if (provider === 'qwen') {
    if (/^qwen3\.8(?:-|$)/.test(model)) return { enable_thinking: false, preserve_thinking: false };
    if (/^qwen3-vl-(?:plus|flash)(?:-|$)/.test(model)) return { enable_thinking: false };
  }
  // These models otherwise require reasoning content to be echoed across tool
  // turns. Snipvia deliberately stores visible answers only.
  if (provider === 'deepseek') return { thinking: { type: 'disabled' } };
  if (provider === 'kimi' && /^kimi-k2\.[56](?:-|$)/.test(model)) return { thinking: { type: 'disabled' }, temperature: 0.6 };
  if (provider === 'zhipu' && /^glm-4\.6v(?:-|$)/.test(model)) return { thinking: { type: 'disabled' } };
  if (provider === 'doubao') return { thinking: { type: 'disabled' } };
  return {};
}
