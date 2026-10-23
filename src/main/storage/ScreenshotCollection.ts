import { randomUUID } from 'node:crypto';
import type { ScreenshotStore } from './ScreenshotStore';

/** Session-local ordering only. Image ownership remains in ScreenshotStore. */
export class ScreenshotCollection {
  readonly id = randomUUID();
  readonly createdAt = Date.now();
  private updatedAt = this.createdAt;
  private revision = 0;
  private ids: string[] = [];
  constructor(private readonly store: ScreenshotStore) {}
  append(id: string) {
    if (this.ids.includes(id)) throw new Error('截图已在收纳区');
    this.store.retain(id, this.id);
    this.ids.push(id); this.changed(); return this.snapshot();
  }
  remove(id: string) {
    if (!this.ids.includes(id)) throw new Error('截图不在收纳区');
    this.ids = this.ids.filter(item => item !== id); this.store.unretain(id, this.id); this.changed();
    return this.snapshot();
  }
  reorder(ids: string[], expectedRevision: number) {
    if (expectedRevision !== this.revision) throw new Error('收纳区已变化，请重试排序');
    if (ids.length !== this.ids.length || new Set(ids).size !== ids.length || ids.some(id => !this.ids.includes(id))) throw new Error('截图顺序无效');
    this.ids = [...ids]; this.changed(); return this.snapshot();
  }
  clear(confirmed: boolean, expectedRevision: number) {
    if (!confirmed) throw new Error('请先确认清空');
    if (expectedRevision !== this.revision) throw new Error('收纳区已变化，请重新确认清空');
    const old = this.ids; this.ids = []; this.changed();
    for (const id of old) this.store.unretain(id, this.id);
    return this.snapshot();
  }
  getItems() { return this.ids.map(id => this.store.metadata(id)); }
  getCount() { return this.ids.length; }
  getItem(id: string) { if (!this.ids.includes(id)) throw new Error('截图不在收纳区'); return this.store.metadata(id); }
  snapshot() { return { id: this.id, createdAt: this.createdAt, updatedAt: this.updatedAt, revision: this.revision, items: this.getItems(), count: this.getCount() }; }
  private changed() { this.updatedAt = Date.now(); this.revision++; }
}
