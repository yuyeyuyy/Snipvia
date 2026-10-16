import { z } from 'zod';

/** Ephemeral failure metadata. Never includes a request ID, URL, key or content. */
export const predictionFailureSchema = z.object({
  stage: z.enum(['vision', 'branch']),
  reason: z.enum(['configuration', 'auth', 'request', 'endpoint', 'busy', 'network', 'timeout', 'invalid_response', 'unavailable']),
  upstreamStatus: z.number().int().min(400).max(599).optional()
}).strict();
export type PredictionFailure = z.infer<typeof predictionFailureSchema>;
export function predictionFailureMessage(failure: PredictionFailure): string {
  const service = failure.stage === 'branch' ? '分支预测模型' : '视觉理解模型';
  const messages: Record<PredictionFailure['reason'], string> = {
    configuration: '尚未配置，请在模型与设置中选择支持图片的模型并配置 API Key',
    auth: '鉴权失败，请在模型与设置中检查 API Key、接口地址与地区',
    request: '拒绝了请求，请检查模型名称、输入格式与调用权限',
    endpoint: '接口或模型不存在，请检查接口地址与模型名称',
    busy: '繁忙或额度不足，请稍后重试或检查模型额度',
    network: '连接失败，请检查网络与模型接口后重试',
    timeout: '调用超时，请稍后重试',
    invalid_response: '响应格式异常，未执行预测分支，请检查模型兼容性',
    unavailable: '暂时不可用，请稍后重试或检查模型配置'
  };
  return `${service}${messages[failure.reason]}${failure.upstreamStatus ? `（HTTP ${failure.upstreamStatus}）` : ''}。`;
}
