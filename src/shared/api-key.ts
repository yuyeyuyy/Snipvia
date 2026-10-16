export const invalidApiKeyMessage = 'API Key 含有中文符号、空格或换行；请只粘贴厂商控制台提供的原始密钥。';

export function assertApiKeyFormat(key: string) {
  if (key && !/^[\x21-\x7E]+$/.test(key)) throw new Error(invalidApiKeyMessage);
}
