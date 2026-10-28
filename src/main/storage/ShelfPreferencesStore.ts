import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { defaultShelfPreferences, shelfPreferencesSchema, shelfSizeSchema, type ShelfPreferences } from '../../shared/shelf-preferences';
export class ShelfPreferencesStore {
  private value: ShelfPreferences = { ...defaultShelfPreferences };
  private writable = true;
  constructor(private readonly file: string) {}
  load() {
    if (!existsSync(this.file)) return;
    this.writable = false;
    // Old dimensions remain available as custom values; new browsing height defaults to 3/4.
    this.value = shelfPreferencesSchema.parse(JSON.parse(readFileSync(this.file, 'utf8')));
    this.writable = true;
  }
  current() { return { width: this.value.width, height: this.value.height }; }
  configuration() { return { ...this.value }; }
  save(input: unknown) {
    const size = shelfSizeSchema.parse(input);
    this.configure({ ...this.value, ...size, heightMode: 'fixed' });
    return this.current();
  }
  configure(input: unknown) {
    if (!this.writable) throw new Error('收纳区配置损坏，原文件已保留；本次调整未保存');
    const value = shelfPreferencesSchema.parse(input);
    if (JSON.stringify(value) === JSON.stringify(this.value)) return this.configuration();
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
    const pending = this.file + '.' + randomUUID() + '.tmp';
    try {
      writeFileSync(pending, JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 });
      renameSync(pending, this.file); this.value = value;
    } finally { if (existsSync(pending)) unlinkSync(pending); }
    return this.configuration();
  }
}
