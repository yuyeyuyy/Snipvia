import type { ModelInfo, VisionTestResult } from '../../../shared/models';
import { chatCompletionOptions } from '../chat-completion-options';
import { type AdapterContext, object } from './adapters';
import { ModelAPIError } from './http';

// Synthetic 64x64 PNG: red upper-left, blue lower-right, other quadrants white.
// No user's screenshot, file, conversation or API Key is included in the prompt.
export const visionTestImage = 'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAU0lEQVR42u3QoQ0AAAwCMP5/ersBgSvBk5JLth0nAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA9YD2wvggAAAAAAAAAAAAAAAAAAAAAAAAAAAAAoO0DQafh0iYXw8AAAAAASUVORK5CYII=';
const prompt = 'Look at the attached image. Return only JSON with topLeft and bottomRight, each containing the English name of that quadrant’s color. Do not guess if you cannot see the image.';

export function visionFailure(error: unknown, protocol: VisionTestResult['protocol'], now: string): VisionTestResult {
  const result = (outcome: VisionTestResult['outcome'], message: string): VisionTestResult => ({ outcome, message, protocol, checkedAt: now, ...(error instanceof ModelAPIError && error.status ? { httpStatus: error.status } : {}) });
  if (!(error instanceof ModelAPIError) || error.kind === 'network') return result('network', '连接失败或请求超时，图片能力尚未确认。');
  if (error.kind === 'invalidResponse') return result('inconclusive', '响应格式无效，图片能力尚未确认。');
  const text = error.diagnostic.toLowerCase();
  if (error.status === 401 || /invalid[_ ]api[_ ]key|authentication[_ ]error|鉴权失败/.test(text)) return result('authentication', '鉴权失败，请检查 Key、厂商和地区；图片能力尚未确认。');
  if (error.status === 402 || /insufficient[_ ](?:quota|balance|credit)|余额不足|欠费|credit balance|payment required/.test(text)) return result('balance', '余额或额度不足，图片能力尚未确认。');
  if (error.status === 403 || /permission[_ ]denied|没有权限|权限不足/.test(text)) return result('permission', '账号无权调用该模型，图片能力尚未确认。');
  if (error.status === 429) return result('rateLimit', '请求被限流，请稍后重试；图片能力尚未确认。');
  if (error.status >= 500) return result('network', '模型服务暂时不可用，图片能力尚未确认。');
  if (error.status === 404 || /model[_ ]not[_ ]found|model does not exist|模型不存在|接入点不存在/.test(text)) return result('modelUnavailable', '模型或接入点不可用，请检查 ID 和开通状态。');
  // A malformed image, unsupported parameter or generic HTTP 400 is not evidence.
  if ([400, 422].includes(error.status) && /does not support (?:image|vision)|(?:image|vision)(?: input)? (?:is |are )?not supported|unsupported (?:image input|image content|vision)|不支持(?:图片|图像)(?:输入|理解)|仅支持(?:纯)?文本(?:输入)?/.test(text)) {
    return result('unsupported', '服务明确拒绝该模型的图片输入。');
  }
  if (error.status === 400 || error.status === 422) return result('invalidRequest', '服务拒绝测试请求；可能是接口格式或参数差异，不能据此判断不支持图片。');
  return result('inconclusive', '测试未能确认图片能力。');
}

export async function testModelVision(context: AdapterContext, model: ModelInfo): Promise<VisionTestResult> {
  const protocol: VisionTestResult['protocol'] = context.provider === 'anthropic' ? 'anthropic-messages' : context.provider === 'gemini' ? 'gemini-generate-content' : 'chat-completions';
  const base = context.endpoint.replace(/\/+$/, '');
  let url = `${base}/chat/completions`;
  let headers: Record<string, string> = { 'Content-Type': 'application/json', ...(context.apiKey ? { Authorization: `Bearer ${context.apiKey}` } : {}) };
  let body: Record<string, unknown>;
  if (protocol === 'anthropic-messages') {
    url = `${base}/messages`;
    headers = { 'Content-Type': 'application/json', 'x-api-key': context.apiKey, 'anthropic-version': '2023-06-01' };
    body = { model: model.id, max_tokens: 128, messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: visionTestImage } }, { type: 'text', text: prompt }] }] };
  } else if (protocol === 'gemini-generate-content') {
    url = `${new URL(base).origin}/v1beta/models/${encodeURIComponent(model.id)}:generateContent`;
    headers = { 'Content-Type': 'application/json', 'x-goog-api-key': context.apiKey };
    body = { contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'image/png', data: visionTestImage } }, { text: prompt }] }], generationConfig: { maxOutputTokens: 512 } };
  } else {
    body = { model: model.id, stream: false, ...(context.provider === 'openai' ? { max_completion_tokens: 512 } : { max_tokens: 512 }), ...chatCompletionOptions({ provider: context.provider, endpoint: context.endpoint, model: model.id }), messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: `data:image/png;base64,${visionTestImage}` } }, { type: 'text', text: prompt }] }] };
  }
  try {
    const data = object(await context.request(url, { method: 'POST', headers, body: JSON.stringify(body) }));
    let text: unknown;
    if (protocol === 'anthropic-messages') text = Array.isArray(data.content) ? data.content.map(part => object(part).type === 'text' ? object(part).text : '').join('') : undefined;
    else if (protocol === 'gemini-generate-content') {
      const candidate = Array.isArray(data.candidates) ? object(data.candidates[0]) : {};
      const parts = object(candidate.content).parts;
      text = Array.isArray(parts) ? parts.filter(part => object(part).thought !== true).map(part => object(part).text ?? '').join('') : undefined;
    } else text = object(object(Array.isArray(data.choices) ? data.choices[0] : {}).message).content;
    let answer: Record<string, unknown> = {};
    if (typeof text === 'string') {
      try { answer = object(JSON.parse(text.replace(/^\s*```(?:json)?\s*/, '').replace(/\s*```\s*$/, '').trim())); } catch { /* A guess/refusal/empty reply remains inconclusive. */ }
    }
    const success = answer.topLeft === 'red' && answer.bottomRight === 'blue';
    return { protocol, checkedAt: context.now, outcome: success ? 'supported' : 'inconclusive', message: success ? '模型正确识别测试图的两个颜色区域，图片输入验证通过。' : '接口接受了请求，但未正确识别测试图；图片能力尚未确认。' };
  } catch (error) { return visionFailure(error, protocol, context.now); }
}
