import { lookup } from 'node:dns/promises';
import { Agent, request } from 'node:https';
import type { WebDnsResolver } from './NetworkPolicy';
import { ToolError, throwIfAborted } from '../ToolError';
import { webOperation } from './operation';

const fakeIP = (value: string) => /^198\.(18|19)\.(?:\d{1,3})\.(?:\d{1,3})$/.test(value);

/** Only the synthetic benchmark range triggers fallback; private/loopback DNS answers remain denied. */
export function createSystemWebDnsResolver(
  system: WebDnsResolver = (hostname) => lookup(hostname, { all: true, verbatim: true }),
  publicDns: WebDnsResolver = resolvePublicDns
): WebDnsResolver {
  return async (hostname, signal) => {
    const addresses = await system(hostname, signal);
    if (signal) throwIfAborted(signal);
    if (addresses.length > 0 && addresses.length <= 32 && addresses.every((item) => item.family === 4 && fakeIP(item.address))) {
      return publicDns(hostname, signal);
    }
    return addresses;
  };
}

/** Fixed public resolver IP, TLS verified, no redirects/proxy; model cannot choose resolver URL or headers. */
async function resolvePublicDns(hostname: string, signal = new AbortController().signal) {
  return webOperation(signal, 5000, (active) => new Promise<Array<{ address: string; family: number }>>((resolve, reject) => {
    const url = new URL('https://1.1.1.1/dns-query'); url.searchParams.set('name', hostname); url.searchParams.set('type', 'A');
    const agent = new Agent({ keepAlive: false, proxyEnv: {} });
    let bytes = 0; const chunks: Buffer[] = []; let settled = false;
    const fail = () => {
      if (settled) return; settled = true; agent.destroy();
      reject(new ToolError('DNS_FAILED', '无法取得真实公网 DNS 地址，请检查网络或代理 DNS 模式'));
    };
    const req = request(url, { agent, signal: active, rejectUnauthorized: true, maxHeaderSize: 8192,
      headers: { Accept: 'application/dns-json', 'User-Agent': 'Snipvia/0.1 (Agent Web Tools)', Connection: 'close' } }, (response) => {
      if (response.statusCode !== 200 || !response.headers['content-type']?.startsWith('application/dns-json')) { response.destroy(); fail(); return; }
      response.on('error', fail);
      response.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 32 * 1024) { response.destroy(); fail(); } else chunks.push(chunk);
      });
      response.on('end', () => {
        if (settled) return;
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { Status?: number; Answer?: Array<{ type?: number; data?: string }> };
          if (body.Status !== 0 || !Array.isArray(body.Answer) || body.Answer.length > 64) { fail(); return; }
          const addresses = body.Answer.filter((item) => item?.type === 1 && typeof item.data === 'string').map((item) => ({ address: item.data!, family: 4 }));
          // NetworkPolicy must still reject invalid/private addresses before any target connection.
          if (!addresses.length) { fail(); return; }
          settled = true; agent.destroy(); resolve(addresses);
        } catch { fail(); }
      });
    });
    req.on('error', fail);
    req.on('upgrade', (_response, socket) => { socket.destroy(); fail(); });
    req.end();
  }));
}
