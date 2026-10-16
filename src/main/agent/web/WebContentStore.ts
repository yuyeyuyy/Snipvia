import { randomUUID } from 'node:crypto';
import { ToolError } from '../ToolError';
import { utf8Prefix } from './operation';
import { relevantOffset } from './relevantExcerpt';

export interface WebContentMetadata {
  contentId: string;
  contentType: string;
  charset: string;
  fetchedAt: string;
  expiresAt: string;
  downloadedBytes: number;
  decodedBytes: number;
  storedTextBytes: number;
  extractionTruncated: boolean;
  truncated: boolean;
  offset: number;
  nextOffset: number | null;
  offsetUnit: 'utf16';
  source: 'untrusted_web';
  selection?: 'focused';
}
export interface WebContentOutput { url: string; title: string; text: string; metadata: WebContentMetadata }
export interface StoredWebContent {
  url: string; title: string; text: string; contentType: string; charset: string;
  downloadedBytes: number; decodedBytes: number; extractionTruncated: boolean;
}
interface Entry { owner: object; content: StoredWebContent; expiresAt: number; fetchedAt: string; bytes: number }

/** Small, expiring Main-memory snapshots. A content ID alone is not authorization. */
export class WebContentStore {
  private readonly entries = new Map<string, Entry>();
  constructor(private readonly ttlMs = 5 * 60_000) {
    if (!Number.isInteger(ttlMs) || ttlMs < 1 || ttlMs > 30 * 60_000) throw new ToolError('INVALID_INPUT', '网页缓存有效期无效');
  }
  put(owner: object, content: StoredWebContent, focus?: string): WebContentOutput {
    this.prune();
    const bytes = Buffer.byteLength(content.text);
    if (bytes > 256 * 1024) throw new ToolError('RESPONSE_TOO_LARGE', '网页文本缓存超过限制');
    // Up to 16 documents, each <= 256 KiB. URLs/titles are bounded before storage.
    while (this.entries.size >= 16) this.entries.delete(this.entries.keys().next().value!);
    const id = randomUUID();
    this.entries.set(id, { owner, content: { ...content }, bytes, fetchedAt: new Date().toISOString(), expiresAt: Date.now() + this.ttlMs });
    const output = this.read(owner, id, focus ? relevantOffset(content.text, focus) : 0);
    if (focus) output.metadata.selection = 'focused';
    return output;
  }
  read(owner: object, id: string, offset: number): WebContentOutput {
    this.prune();
    const saved = this.entries.get(id);
    if (!saved || saved.owner !== owner) throw new ToolError('CONTENT_UNAVAILABLE', '网页内容已过期或不属于当前会话，请重新 fetch_url');
    const content = saved.content;
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > content.text.length ||
        (offset > 0 && /[\uDC00-\uDFFF]/.test(content.text[offset] ?? ''))) throw new ToolError('INVALID_INPUT', '网页分块 offset 无效');
    const output: WebContentOutput = {
      url: content.url, title: content.title, text: utf8Prefix(content.text.slice(offset), 4000),
      metadata: { contentId: id, contentType: content.contentType, charset: content.charset, fetchedAt: saved.fetchedAt,
        expiresAt: new Date(saved.expiresAt).toISOString(), downloadedBytes: content.downloadedBytes, decodedBytes: content.decodedBytes,
        storedTextBytes: saved.bytes, extractionTruncated: content.extractionTruncated, truncated: false,
        offset, nextOffset: null, offsetUnit: 'utf16', source: 'untrusted_web' }
    };
    const update = () => {
      const next = offset + output.text.length;
      output.metadata.nextOffset = next < content.text.length ? next : null;
      output.metadata.truncated = output.metadata.nextOffset !== null || content.extractionTruncated;
    };
    update();
    // Budget the serialized shape, including JSON escaping. Leave headroom for ToolResult metadata.
    while (Buffer.byteLength(JSON.stringify(output)) > 7000 && output.text) {
      output.text = utf8Prefix(output.text, Math.floor(Buffer.byteLength(output.text) * 0.8)); update();
    }
    if (Buffer.byteLength(JSON.stringify(output)) > 7000 || !output.text && offset < content.text.length) {
      throw new ToolError('RESPONSE_TOO_LARGE', '网页元数据超过输出预算');
    }
    return output;
  }
  clear(owner?: object): void {
    if (!owner) this.entries.clear();
    else for (const [id, entry] of this.entries) if (entry.owner === owner) this.entries.delete(id);
  }
  private prune(): void { for (const [id, entry] of this.entries) if (entry.expiresAt <= Date.now()) this.entries.delete(id); }
}
