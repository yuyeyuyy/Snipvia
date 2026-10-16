import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';
import { ToolError, throwIfAborted } from '../ToolError';
import { createSystemWebDnsResolver } from './SystemWebDnsResolver';

export interface ResolvedAddress { address: string; family: 4 | 6 }
export type WebDnsResolver = (hostname: string, signal?: AbortSignal) => Promise<Array<{ address: string; family: number }>>;
export interface PublicTarget { url: URL; address: ResolvedAddress }
const resolver = createSystemWebDnsResolver();
const v4Denied = ['0.0.0.0/8', '192.0.0.0/24', '192.88.99.0/24'].map((cidr) => ipaddr.parseCIDR(cidr));
const v6Denied = ['2001::/23', '2002::/16', '3fff::/20'].map((cidr) => ipaddr.parseCIDR(cidr));

export function isPublicAddress(address: string): boolean {
  if (!isIP(address) || address.includes('%')) return false;
  const parsed = ipaddr.parse(address);
  if (parsed.range() !== 'unicast') return false;
  const denied = parsed.kind() === 'ipv4' ? v4Denied : v6Denied;
  if (denied.some(([network, bits]) => parsed.kind() === network.kind() && parsed.match(network, bits))) return false;
  // Only native IPv6 global unicast; reject mapped IPv4, NAT64, tunnelling and future ranges.
  return parsed.kind() === 'ipv4' || parsed.match(ipaddr.parse('2000::'), 3);
}

/** URL normalization happens BEFORE classification (including numeric/octal/hex IPv4 forms). */
export function publicWebUrl(input: string): URL {
  let url: URL;
  try {
    if (typeof input !== 'string' || input.length > 2048 || input !== input.trim() ||
        [...input].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) || input.includes('\\')) throw new Error();
    url = new URL(input);
  } catch { throw new ToolError('URL_BLOCKED', '网页地址格式无效'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) {
    throw new ToolError('URL_BLOCKED', '仅允许不含凭据的标准端口 HTTP / HTTPS 地址');
  }
  if (url.href.length > 2048) throw new ToolError('URL_BLOCKED', '规范化网页地址超过长度限制');
  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (isIP(host)) {
    if (!isPublicAddress(host)) throw new ToolError('URL_BLOCKED', '禁止访问非公网 IP');
  } else if (!host.includes('.') || ['localhost', 'local', 'internal', 'lan', 'home', 'home.arpa', 'onion'].some((suffix) => host === suffix || host.endsWith(`.${suffix}`))) {
    throw new ToolError('URL_BLOCKED', '禁止访问本机或内部域名');
  }
  url.hash = '';
  return url;
}

export class NetworkPolicy {
  constructor(private readonly resolveDns: WebDnsResolver = resolver) {}
  async resolve(input: string, signal: AbortSignal): Promise<PublicTarget> {
    throwIfAborted(signal);
    const url = publicWebUrl(input);
    const hostname = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');
    let addresses: Array<{ address: string; family: number }>;
    try {
      addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await this.resolveDns(hostname, signal);
    } catch { throwIfAborted(signal); throw new ToolError('DNS_FAILED', '无法解析网页域名'); }
    throwIfAborted(signal);
    if (!Array.isArray(addresses) || !addresses.length || addresses.length > 32) throw new ToolError('DNS_FAILED', '域名解析结果为空或过多');
    if (addresses.some((entry) => !entry || typeof entry.address !== 'string' || !isPublicAddress(entry.address) || isIP(entry.address) !== entry.family)) {
      throw new ToolError('URL_BLOCKED', '域名包含非公网或无效地址，已阻止请求');
    }
    // A connection uses precisely one approved address; there is no second DNS lookup.
    return { url, address: { address: addresses[0].address, family: addresses[0].family as 4 | 6 } };
  }
}
