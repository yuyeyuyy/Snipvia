import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { defaultQuickTargetPreferences, quickTargetPreferencesSchema, quickTargetConfigureSchema, quickTargetBrowserSchema, type QuickTarget, type QuickTargetPreferences } from '../../shared/quick-target';

export class QuickTargetPreferencesStore {
  private value: QuickTargetPreferences = structuredClone(defaultQuickTargetPreferences);
  private writable = true;
  constructor(private readonly file: string) {}
  load() {
    if (!existsSync(this.file)) return;
    this.writable = false;
    this.value = quickTargetPreferencesSchema.parse(JSON.parse(readFileSync(this.file, 'utf8')));
    this.writable = true;
  }
  available() { return this.writable; }
  current() { return structuredClone(this.value); }
  configure(input: unknown) {
    const request = quickTargetConfigureSchema.parse(input);
    const byId = new Map(this.value.targets.map(target => [target.id, target]));
    if (request.order.length !== byId.size || new Set(request.order).size !== byId.size || request.order.some(id => !byId.has(id))) throw new Error('目标列表已变化，请刷新后重试');
    return this.save({ ...this.value, enabled: request.enabled, durationMs: request.durationMs, launchApplications: request.launchApplications, targets: request.order.map(id => byId.get(id)!) });
  }
  add(target: QuickTarget) {
    if (this.value.targets.some(item => item.kind === target.kind && (item.kind === 'application' && target.kind === 'application' ? item.path === target.path : item.kind === 'website' && target.kind === 'website' && item.url === target.url))) throw new Error('这个目标已添加');
    return this.save({ ...this.value, targets: [...this.value.targets, target] });
  }
  configureBrowser(input: unknown) {
    const { id, ...options } = quickTargetBrowserSchema.parse(input);
    if (!this.value.targets.some(target => target.id === id && target.kind === 'website')) throw new Error('网页目标已移除');
    return this.save({ ...this.value, targets: this.value.targets.map(target => target.id === id ? { ...target, ...options } : target) });
  }
  rename(id: string, label: string) { this.requireTarget(id); return this.save({ ...this.value, targets: this.value.targets.map(target => target.id === id ? { ...target, label } : target) }); }
  remove(id: string) { this.requireTarget(id); return this.save({ ...this.value, targets: this.value.targets.filter(target => target.id !== id) }); }
  private requireTarget(id: string) { if (!this.value.targets.some(target => target.id === id)) throw new Error('目标已移除'); }
  private save(input: QuickTargetPreferences) {
    if (!this.writable) throw new Error('快速切换配置损坏或版本不受支持，原文件已保留');
    const value = quickTargetPreferencesSchema.parse(input);
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
    const pending = this.file + '.' + randomUUID() + '.tmp';
    try { writeFileSync(pending, JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 }); renameSync(pending, this.file); this.value = value; }
    finally { if (existsSync(pending)) unlinkSync(pending); }
    return this.current();
  }
}
