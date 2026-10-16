import { z } from 'zod';

/** Ephemeral failure metadata. Never includes a request ID, URL, key or content. */
export const predictionFailureSchema = z.object({
  stage: z.enum(['vision', 'branch', 'proxy', 'service']),
  reason: z.enum(['auth', 'request', 'endpoint', 'busy', 'network', 'timeout', 'invalid_response', 'unavailable']),
  upstreamStatus: z.number().int().min(400).max(599).optional()
}).strict();
export type PredictionFailure = z.infer<typeof predictionFailureSchema>;
export function predictionFailureMessage(failure: PredictionFailure): string {
  const service = failure.stage === 'vision' ? '视觉理解服务' : failure.stage === 'branch' ? 'Jev 分支预测服务' : failure.stage === 'service' ? '账号服务器' : '预测服务';
  const messages: Record<PredictionFailure['reason'], string> = {
    auth: '鉴权失败，请联系管理员检查对应 API Key、接口地址与地区是否匹配',
    request: '拒绝了请求，请联系管理员检查模型名称、输入格式与服务权限',
    endpoint: '接口或模型不存在，请联系管理员检查接口地址与模型名称',
    busy: '繁忙或调用额度不足，请稍后重试或联系管理员检查额度',
    network: failure.stage === 'service' ? '连接失败，请检查本机网络后重试' : '连接失败，请联系管理员检查服务器到模型服务的网络',
    timeout: '调用超时，请稍后重试或联系管理员检查预测超时设置',
    invalid_response: '响应格式异常，未完成分支预测，请联系管理员检查模型兼容性',
    unavailable: '暂时不可用，请稍后重试或联系管理员检查服务配置'
  };
  return `${service}${messages[failure.reason]}${failure.upstreamStatus ? `（HTTP ${failure.upstreamStatus}）` : ''}。`;
}
