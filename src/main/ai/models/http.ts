export class ModelAPIError extends Error {
  constructor(readonly kind: 'http' | 'network' | 'invalidResponse', readonly status = 0, readonly diagnostic = '') {
    super(kind === 'http' ? `模型服务请求失败（HTTP ${status}）` : kind === 'network' ? '模型服务连接失败或超时' : '模型服务返回格式无效');
  }
}

export type ModelJSONRequest = (url: string, init?: RequestInit) => Promise<unknown>;
export function modelJSONRequest(fetcher: typeof fetch = (...args) => fetch(...args)): ModelJSONRequest {
  return async (url, init = {}) => {
    const signal = AbortSignal.timeout(30_000);
    try {
      const response = await fetcher(url, { ...init, signal, redirect: 'error' });
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      if (reader) {
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            length += value.byteLength;
            if (length > 4_000_000) { await reader.cancel(); throw new ModelAPIError('invalidResponse'); }
            chunks.push(value);
          }
        } finally { reader.releaseLock(); }
      }
      const text = Buffer.concat(chunks).toString('utf8');
      // Diagnostic text is used only for classification; never return or log it.
      if (!response.ok) throw new ModelAPIError('http', response.status, text.slice(0, 8000));
      try {
        const value: unknown = JSON.parse(text);
        const object = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
        if (object.error || object.success === false) throw new ModelAPIError('http', 400, text.slice(0, 8000));
        return value;
      } catch (error) { if (error instanceof ModelAPIError) throw error; throw new ModelAPIError('invalidResponse'); }
    } catch (error) {
      if (error instanceof ModelAPIError) throw error;
      throw new ModelAPIError('network');
    }
  };
}
