import { request as httpRequest, Agent as HttpAgent, type IncomingHttpHeaders, type RequestOptions } from 'node:http';
import { request as httpsRequest, Agent as HttpsAgent } from 'node:https';
import { Readable, Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import ipaddr from 'ipaddr.js';
import { NetworkPolicy, type PublicTarget } from './NetworkPolicy';
import { ToolError, throwIfAborted } from '../ToolError';
import { webOperation } from './operation';

export interface WebResponse {
  status: number;
  headers: IncomingHttpHeaders;
  body: AsyncIterable<Uint8Array>;
  close(): void;
}
export interface WebTransport {
  open(target: PublicTarget, signal: AbortSignal, headers: Record<string, string>, jsonBody?: string): Promise<WebResponse>;
}
export const webUserAgent = 'Snipvia/0.1 (Agent Web Tools)';

/** Inspectable transport contract: original hostname/TLS identity, pinned socket address, no proxy. */
export function pinnedRequestOptions(target: PublicTarget): RequestOptions & { autoSelectFamily: false } {
  return {
    method: 'GET', maxHeaderSize: 32 * 1024, autoSelectFamily: false, family: target.address.family,
    lookup: (_hostname, options, callback) => {
      if (options.all) callback(null, [{ ...target.address }]);
      else callback(null, target.address.address, target.address.family);
    }
  };
}

export class NodeWebTransport implements WebTransport {
  open(target: PublicTarget, signal: AbortSignal, headers: Record<string, string>, jsonBody?: string): Promise<WebResponse> {
    throwIfAborted(signal);
    return new Promise((resolve, reject) => {
      // Explicit per-hop agent ignores environment/global proxy settings and cannot reuse a socket.
      const secure = target.url.protocol === 'https:';
      const agent = secure ? new HttpsAgent({ keepAlive: false, proxyEnv: {} }) : new HttpAgent({ keepAlive: false, proxyEnv: {} });
      const request = (secure ? httpsRequest : httpRequest)(target.url, {
        ...pinnedRequestOptions(target), agent, signal,
        ...(jsonBody === undefined ? {} : { method: 'POST' }),
        ...(secure ? { rejectUnauthorized: true } : {}),
        headers: { ...headers, 'User-Agent': webUserAgent, 'Accept-Encoding': 'gzip, deflate, br', Connection: 'close',
          ...(jsonBody === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(jsonBody) }) }
      }, (response) => {
        const peer = response.socket.remoteAddress;
        if (!peer || ipaddr.process(peer).toString() !== ipaddr.process(target.address.address).toString()) {
          response.destroy(); request.destroy(); agent.destroy();
          reject(new ToolError('URL_BLOCKED', '连接地址与已验证的公网地址不一致')); return;
        }
        resolve({ status: response.statusCode ?? 0, headers: response.headers, body: response,
          close: () => { response.destroy(); request.destroy(); agent.destroy(); } });
      });
      request.once('error', () => { agent.destroy(); reject(new ToolError('NETWORK_ERROR', '网页连接失败')); });
      request.once('upgrade', (_response, socket) => {
        socket.destroy(); request.destroy(); agent.destroy(); reject(new ToolError('NETWORK_ERROR', '不支持协议升级'));
      });
      request.end(jsonBody);
    });
  }
}

export interface WebDocumentResponse {
  url: string; contentType: string; charset: string; bytes: Buffer;
  downloadedBytes: number; redirects: number; status: number;
}
export interface WebGetOptions {
  signal: AbortSignal;
  acceptedTypes?: readonly string[];
  maxBytes?: number;
  maxRedirects?: number;
  /** Trusted Main only; no headers in the model-facing schema. Dropped on cross-origin redirect. */
  headers?: Record<string, string>;
}
const redirectStatuses = new Set([301, 302, 303, 307, 308]);

export class PublicHttpClient {
  constructor(private readonly policy = new NetworkPolicy(), private readonly transport: WebTransport = new NodeWebTransport(),
    private readonly timeoutMs = 10_000) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) throw new ToolError('INVALID_INPUT', '网页超时配置无效');
  }
  async get(input: string, options: WebGetOptions): Promise<WebDocumentResponse> {
    return this.request(input, options);
  }
  /** Trusted provider adapters only. Never exposed as a generic model-controlled HTTP tool. */
  async postJson(input: string, body: unknown, options: Omit<WebGetOptions, 'maxRedirects'>): Promise<WebDocumentResponse> {
    let jsonBody: string;
    try { jsonBody = JSON.stringify(body); } catch { throw new ToolError('INVALID_INPUT', '搜索请求格式无效'); }
    if (typeof jsonBody !== 'string' || Buffer.byteLength(jsonBody) > 64 * 1024) throw new ToolError('INVALID_INPUT', '搜索请求过大');
    return this.request(input, { ...options, maxRedirects: 0 }, jsonBody);
  }
  private async request(input: string, options: WebGetOptions, jsonBody?: string): Promise<WebDocumentResponse> {
    return webOperation(options.signal, this.timeoutMs, async (signal) => {
      const limit = options.maxBytes ?? 2 * 1024 * 1024;
      const maxRedirects = options.maxRedirects ?? 3;
      if (!Number.isInteger(limit) || limit < 1 || limit > 2 * 1024 * 1024 || !Number.isInteger(maxRedirects) || maxRedirects < 0 || maxRedirects > 5) {
        throw new ToolError('INVALID_INPUT', '网页大小或重定向限制无效');
      }
      const accepted = options.acceptedTypes ?? ['text/html', 'text/plain', 'text/markdown', 'application/xhtml+xml'];
      let url = input;
      let extraHeaders = { ...options.headers };
      const visited = new Set<string>();
      try {
        for (let redirects = 0; ; redirects++) {
          const target = await this.policy.resolve(url, signal);
          if (visited.has(target.url.href)) throw new ToolError('REDIRECT_LIMIT', '网页重定向循环');
          visited.add(target.url.href);
          const headers = { Accept: accepted.join(', '), ...extraHeaders };
          const response = jsonBody === undefined ? await this.transport.open(target, signal, headers)
            : await this.transport.open(target, signal, headers, jsonBody);
          // Abort before headers/body completion must close even if a custom transport is stalled.
          const abort = () => response.close();
          signal.addEventListener('abort', abort, { once: true });
          try {
            throwIfAborted(signal);
            if (redirectStatuses.has(response.status)) {
              const location = response.headers.location;
              if (!location || redirects >= maxRedirects) throw new ToolError('REDIRECT_LIMIT', '网页重定向次数超过限制或缺少地址');
              let next: URL;
              try { next = new URL(location, target.url); } catch { throw new ToolError('URL_BLOCKED', '重定向地址无效'); }
              if (target.url.protocol === 'https:' && next.protocol !== 'https:') throw new ToolError('URL_BLOCKED', '禁止 HTTPS 降级重定向');
              if (next.origin !== target.url.origin) extraHeaders = {};
              url = next.href; continue;
            }
            if (response.status < 200 || response.status >= 300) throw new ToolError('HTTP_ERROR', `网页返回 HTTP ${response.status}`);
            if (response.headers['content-disposition']?.toLowerCase().startsWith('attachment')) {
              throw new ToolError('UNSUPPORTED_CONTENT_TYPE', '不下载网页附件');
            }
            const typeHeader = response.headers['content-type'] ?? '';
            const contentType = typeHeader.split(';')[0].trim().toLowerCase();
            if (!accepted.includes(contentType)) throw new ToolError('UNSUPPORTED_CONTENT_TYPE', '仅支持 HTML、纯文本或指定的搜索 JSON 响应');
            const declared = response.headers['content-length'];
            if (declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > limit)) {
              throw new ToolError('RESPONSE_TOO_LARGE', '网页声明的下载大小超过限制');
            }
            const encoding = (response.headers['content-encoding'] ?? 'identity').trim().toLowerCase();
            const decoder = encoding === 'gzip' ? createGunzip() : encoding === 'deflate' ? createInflate() : encoding === 'br' ? createBrotliDecompress() : undefined;
            if (!decoder && encoding !== 'identity') throw new ToolError('UNSUPPORTED_CONTENT_TYPE', '不支持此网页压缩格式');
            let downloadedBytes = 0, decodedBytes = 0;
            const chunks: Buffer[] = [];
            const byteLimit = new Transform({ transform(chunk: Buffer, _encoding, callback) {
              downloadedBytes += chunk.length;
              callback(downloadedBytes > limit ? new ToolError('RESPONSE_TOO_LARGE', '网页下载大小超过限制') : null, chunk);
            } });
            const collect = new Writable({ write(chunk: Buffer, _encoding, callback) {
              decodedBytes += chunk.length;
              if (decodedBytes > limit) callback(new ToolError('RESPONSE_TOO_LARGE', '网页解压后大小超过限制'));
              else { chunks.push(Buffer.from(chunk)); callback(); }
            } });
            const source = Readable.from(response.body);
            if (decoder) await pipeline(source, byteLimit, decoder, collect, { signal });
            else await pipeline(source, byteLimit, collect, { signal });
            throwIfAborted(signal);
            const charset = /charset\s*=\s*["']?([^;\s"']+)/i.exec(typeHeader)?.[1] ?? 'utf-8';
            return { url: target.url.href, contentType, charset, bytes: Buffer.concat(chunks), downloadedBytes, redirects, status: response.status };
          } finally { signal.removeEventListener('abort', abort); response.close(); }
        }
      } catch (error) {
        throwIfAborted(signal);
        if (error instanceof ToolError) throw error;
        throw new ToolError('NETWORK_ERROR', '网页读取失败或响应数据损坏');
      }
    });
  }
}
