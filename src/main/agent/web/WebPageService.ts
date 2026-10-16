import { PublicHttpClient } from './PublicHttpClient';
import { WebContentStore } from './WebContentStore';
import { extractWebText } from './htmlText';
import { webOperation } from './operation';
import { ToolError, throwIfAborted } from '../ToolError';

export class WebPageService {
  constructor(private readonly http = new PublicHttpClient(), readonly contents = new WebContentStore()) {}
  async fetch(url: string, owner: object, signal: AbortSignal, focus?: string) {
    return webOperation(signal, 10_000, async (activeSignal) => {
      const response = await this.http.get(url, { signal: activeSignal });
      let text: string;
      try { text = new TextDecoder(response.charset).decode(response.bytes); }
      catch { throw new ToolError('UNSUPPORTED_ENCODING', '网页字符编码不受支持'); }
      const parsed = await extractWebText(text, ['text/html', 'application/xhtml+xml'].includes(response.contentType), activeSignal);
      throwIfAborted(activeSignal);
      return this.contents.put(owner, { url: response.url, title: parsed.title, text: parsed.text,
        contentType: response.contentType, charset: response.charset, downloadedBytes: response.downloadedBytes,
        decodedBytes: response.bytes.length, extractionTruncated: parsed.truncated }, focus);
    });
  }
}
