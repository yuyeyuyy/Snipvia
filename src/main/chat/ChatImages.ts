import { randomUUID } from 'node:crypto';
import { chatImageLimits, chatImageSchema, type ChatImage } from '../../shared/chat-images';
import { writeChatImage, readChatImage, removeChatImages } from '../storage/chat-images';

type Draft = { owner: number; scope: string | null; image: ChatImage; bytes: Buffer; locked: boolean; detached?: boolean };
/** Ephemeral drafts, Main-owned IDs and existing history files; no second message or credential store. */
export class ChatImages {
  private readonly drafts = new Map<string, Draft>();
  constructor(private readonly normalize: (bytes: Buffer) => { bytes: Buffer; width: number; height: number }) {}
  add(owner: number, scope: string | null, files: Array<{ name: string; bytes: Uint8Array }>): ChatImage[] {
    if (!files.length || files.length > chatImageLimits.perTurn) throw new Error('每次最多添加 4 张图片');
    const current = [...this.drafts.values()];
    if (current.filter(item => item.owner === owner && item.scope === scope && !item.locked).length + files.length > chatImageLimits.perTurn) throw new Error('每条消息最多 4 张图片，请先移除多余图片');
    if (current.filter(item => item.owner === owner).length + files.length > 16) throw new Error('图片草稿过多，请先发送或移除其他会话的图片');
    const prepared = files.map(file => {
      const normalized = this.normalize(Buffer.from(file.bytes));
      const name = Array.from(file.name).map(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 || char === '/' || char === '\\' ? '_' : char).join('').slice(-100) || '图片';
      const image = chatImageSchema.parse({ id: randomUUID(), name, mimeType: 'image/png', bytes: normalized.bytes.byteLength, width: normalized.width, height: normalized.height });
      return { owner, scope, image, bytes: normalized.bytes, locked: false };
    });
    if ([...current, ...prepared].reduce((sum, item) => sum + item.bytes.byteLength, 0) > chatImageLimits.draftBytes) throw new Error('图片草稿占用过多，请先发送或移除图片');
    for (const item of prepared) this.drafts.set(item.image.id, item);
    return prepared.map(item => structuredClone(item.image));
  }
  begin(owner: number, scope: string, ids: string[]) {
    if (new Set(ids).size !== ids.length || ids.length > chatImageLimits.perTurn) throw new Error('图片列表无效');
    const items = ids.map(id => { const item = this.drafts.get(id); if (!item || item.owner !== owner || item.scope !== scope || item.locked || item.detached) throw new Error('图片已失效或不属于当前会话，请重新添加'); return item; });
    for (const item of items) item.locked = true;
    return { images: items.map(item => structuredClone(item.image)), release: () => { for (const item of items) { item.locked = false; if (item.detached) this.drafts.delete(item.image.id); } } };
  }
  preview(owner: number, scope: string | null, id: string, saved: ChatImage[]): Buffer {
    const item = this.drafts.get(id);
    if (item?.owner === owner && (item.scope === scope || item.locked && item.scope === null)) return Buffer.from(item.bytes);
    const image = saved.find(image => image.id === id); if (!image) throw new Error('当前会话没有此图片'); return readChatImage(image);
  }
  bind(owner: number, scope: string, ids: string[]) {
    if ([...this.drafts.values()].filter(item => item.owner === owner && item.scope === scope && !item.locked).length + ids.length > chatImageLimits.perTurn) throw new Error('每条消息最多 4 张图片');
    const items = ids.map(id => { const item = this.drafts.get(id); if (!item || item.owner !== owner || item.scope !== null || item.locked) throw new Error('图片草稿已失效'); return item; });
    for (const item of items) item.scope = scope;
  }
  remove(owner: number, scope: string | null, id: string) { const item = this.drafts.get(id); if (!item || item.owner !== owner || item.scope !== scope || item.locked) throw new Error('图片已发送或不属于当前草稿'); this.drafts.delete(id); }
  data(image: ChatImage): Buffer { const draft = this.drafts.get(image.id); return draft ? draft.bytes : readChatImage(image); }
  persist(images: ChatImage[]): () => void {
    const written: string[] = [];
    try { for (const image of images) if (this.drafts.has(image.id)) { writeChatImage(image, this.drafts.get(image.id)!.bytes); written.push(image.id); } }
    catch (error) { removeChatImages(written); throw error; }
    return () => removeChatImages(written);
  }
  committed(images: ChatImage[]) { for (const image of images) this.drafts.delete(image.id); }
  release(images: ChatImage[]) { for (const image of images) { const item = this.drafts.get(image.id); if (item) { item.locked = false; if (item.detached) this.drafts.delete(image.id); } } }
  detach(owner: number) { for (const [id, item] of this.drafts) if (item.owner === owner) { if (item.locked) item.detached = true; else this.drafts.delete(id); } }
  forget(scope: string) { for (const [id, item] of this.drafts) if (item.scope === scope) this.drafts.delete(id); }
  clear() { this.drafts.clear(); }
}
