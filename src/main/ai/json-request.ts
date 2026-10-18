import type { PredictionFailure } from '../../shared/prediction-failure';
import { PredictionError } from '../analysis/PredictionError';

/** Bounded, cancellable model JSON transport. Never relays response bodies. */
export async function requestPredictionJson(url: string, init: RequestInit, signal: AbortSignal, timeoutMs = 45_000, stage: PredictionFailure['stage'] = 'vision'): Promise<unknown> {
  signal.throwIfAborted();
  const timeout = AbortSignal.timeout(timeoutMs);
  const active = AbortSignal.any([signal, timeout]);
  const limit = 131_072;
  try {
    const response = await fetch(url, { ...init, redirect: 'error', credentials: 'omit', signal: active });
    if (!response.ok) {
      await response.body?.cancel();
      const status = response.status;
      throw new PredictionError({ stage, reason: status === 401 || status === 403 ? 'auth' : status === 429 ? 'busy' : status === 404 ? 'endpoint' : status === 400 || status === 422 ? 'request' : 'unavailable', upstreamStatus: status >= 400 && status <= 599 ? status : undefined });
    }
    if (Number(response.headers.get('content-length')) > limit || !response.body) {
      await response.body?.cancel();
      throw new PredictionError({ stage, reason: 'invalid_response' });
    }
    const reader = response.body.getReader();
    const cancel = () => { void reader.cancel().catch(() => undefined); };
    active.addEventListener('abort', cancel, { once: true });
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      if (active.aborted) { cancel(); active.throwIfAborted(); }
      while (true) {
        const chunk = await reader.read();
        active.throwIfAborted();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > limit) { await reader.cancel(); throw new PredictionError({ stage, reason: 'invalid_response' }); }
        chunks.push(chunk.value);
      }
      try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
      catch { throw new PredictionError({ stage, reason: 'invalid_response' }); }
    } finally { active.removeEventListener('abort', cancel); reader.releaseLock(); }
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof PredictionError) throw error;
    throw new PredictionError({ stage, reason: timeout.aborted ? 'timeout' : 'network' });
  }
}
