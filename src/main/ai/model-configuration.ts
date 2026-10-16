import type { Settings } from '../../shared/contracts';
import { assertApiKeyFormat } from '../../shared/api-key';

export function requireModelConfiguration(settings: Pick<Settings, 'provider' | 'endpoint' | 'model'>, key: string): void {
  if (!settings.endpoint || !settings.model || (!key && settings.provider !== 'custom')) throw new Error('请先在模型与设置中选择模型并配置 API Key');
  assertApiKeyFormat(key);
}
