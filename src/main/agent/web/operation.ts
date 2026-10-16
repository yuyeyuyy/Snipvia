import { ToolError, throwIfAborted } from '../ToolError';

/** One absolute deadline, including DNS, redirects, download and provider work. */
export async function webOperation<T>(parent: AbortSignal, timeoutMs: number, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  throwIfAborted(parent);
  const controller = new AbortController();
  const forward = () => controller.abort(parent.reason);
  parent.addEventListener('abort', forward, { once: true });
  const timer = setTimeout(() => controller.abort(new ToolError('TIMEOUT', '网页工具请求超时')), timeoutMs);
  let abort: () => void = () => {};
  const interrupted = new Promise<never>((_resolve, reject) => {
    abort = () => { try { throwIfAborted(controller.signal); } catch (error) { reject(error); } };
    controller.signal.addEventListener('abort', abort, { once: true });
  });
  try {
    const result = await Promise.race([Promise.resolve().then(() => {
      throwIfAborted(controller.signal); return work(controller.signal);
    }), interrupted]);
    throwIfAborted(controller.signal);
    return result;
  } finally {
    clearTimeout(timer); parent.removeEventListener('abort', forward);
    controller.signal.removeEventListener('abort', abort);
    controller.abort(new ToolError('ABORTED', '网页工具请求已结束'));
  }
}

export function utf8Prefix(text: string, maxBytes: number): string {
  const bytes = Buffer.from(text);
  if (bytes.length <= maxBytes) return text;
  let end = Math.max(0, maxBytes);
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
  return bytes.subarray(0, end).toString('utf8');
}
