import { vi } from 'vitest';
import type { IncomingHttpHeaders } from 'node:http';
import { NetworkPolicy, type PublicTarget } from '../../../src/main/agent/web/NetworkPolicy';
import { PublicHttpClient, type WebResponse } from '../../../src/main/agent/web/PublicHttpClient';

export const publicDns = async () => [{ address: '93.184.216.34', family: 4 }];
export const freshSignal = () => new AbortController().signal;
export function webResponse(body: string | Uint8Array = '<p>Hello</p>', headers: IncomingHttpHeaders = {}, status = 200): WebResponse {
  return { status, headers: { 'content-type': 'text/html; charset=utf-8', ...headers },
    body: (async function* () { yield typeof body === 'string' ? Buffer.from(body) : body; })(), close: vi.fn() };
}
export function fakeHttp(responses: WebResponse[], timeoutMs = 10_000, policy = new NetworkPolicy(publicDns)) {
  const open = vi.fn<(target: PublicTarget, signal: AbortSignal, headers: Record<string, string>, jsonBody?: string) => Promise<WebResponse>>(async () => {
    const response = responses.shift();
    if (!response) throw new Error('unexpected request');
    return response;
  });
  return { open, client: new PublicHttpClient(policy, { open }, timeoutMs) };
}
