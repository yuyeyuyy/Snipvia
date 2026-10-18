/** Inform without rewriting legacy endpoints or blocking trusted local services. */
export function modelTransportNotice(endpoint: string): string | null {
  let url: URL;
  try { url = new URL(endpoint.trim()); } catch { return null; }
  if (url.protocol !== 'http:') return null;
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(host)) return null;
  return '此地址使用未加密 HTTP，API Key、截图和对话可能以明文传输。远程服务请优先使用 HTTPS。';
}
