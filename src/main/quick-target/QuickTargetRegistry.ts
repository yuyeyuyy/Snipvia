import { randomUUID } from 'node:crypto';
import { quickTargetWebsiteSchema, type QuickTargetSettingsState, type QuickTargetView } from '../../shared/quick-target';
import { QuickTargetPreferencesStore } from '../storage/QuickTargetPreferencesStore';
import { QuickTargetPlatform } from './QuickTargetPlatform';

export class QuickTargetRegistry {
  private icons = new Map<string, Promise<string | undefined>>();
  private browsers = new Map<string, { at: number; value: Promise<string | undefined> }>();
  constructor(readonly store: QuickTargetPreferencesStore, readonly platform: QuickTargetPlatform, private readonly icon: (path: string) => Promise<string>,
    private readonly artwork?: { website(url: string): string | undefined; browser(mode: 'chrome' | 'default' | 'http'): Promise<string | undefined> }) {}
  async settings(): Promise<QuickTargetSettingsState> {
    const value = this.store.current();
    const targets = await Promise.all(value.targets.map(async target => {
      let icon: string | undefined;
      if (target.kind === 'application') {
        let cached = this.icons.get(target.path);
        if (!cached) {
          cached = this.icon(target.path).catch(() => {
            // A transient read failure must not suppress artwork for the whole session.
            if (this.icons.get(target.path) === cached) this.icons.delete(target.path);
            return undefined;
          });
          this.icons.set(target.path, cached);
        }
        icon = await cached;
      }
      const hostname = target.kind === 'website' ? new URL(target.url).hostname : '';
      const websiteIcon: QuickTargetView['websiteIcon'] = ['chatgpt.com', 'www.chatgpt.com', 'chat.openai.com'].includes(hostname) ? 'chatgpt'
        : ['chat.deepseek.com', 'deepseek.com', 'www.deepseek.com'].includes(hostname) ? 'deepseek' : undefined;
      let browserIcon: string | undefined;
      if (target.kind === 'website' && this.artwork) {
        icon = this.artwork.website(target.url);
        const mode = target.mode === 'existing-tab' ? 'chrome' : new URL(target.url).protocol === 'http:' ? 'http' : 'default';
        let cached = this.browsers.get(mode);
        if (!cached || Date.now() - cached.at > 5 * 60 * 1000) {
          cached = { at: Date.now(), value: this.artwork.browser(mode).catch(() => undefined) };
          this.browsers.set(mode, cached);
        }
        browserIcon = await cached.value;
      }
      return { id: target.id, kind: target.kind, label: target.label, detail: target.kind === 'application' ? '切换应用' : (target.mode === 'existing-tab' ? 'Chrome 已有标签 · ' : '打开网页 · ') + hostname, icon, ...(target.kind === 'website' ? { websiteIcon, browserIcon, browser: { mode: target.mode ?? 'open', match: target.match ?? 'origin', focusInput: target.focusInput ?? false } } : {}) } satisfies QuickTargetView;
    }));
    const paths = new Set(value.targets.flatMap(target => target.kind === 'application' ? [target.path] : []));
    for (const path of this.icons.keys()) if (!paths.has(path)) this.icons.delete(path);
    return { enabled: value.enabled, durationMs: value.durationMs, launchApplications: value.launchApplications, targets, applicationSupported: this.platform.supported(), warning: this.store.available() ? '' : '快速切换配置损坏或版本不受支持，原文件已保留；功能已禁用' };
  }
  async addApplication(path: string) {
    const info = await this.platform.describe(path);
    this.store.add({ id: randomUUID(), kind: 'application', label: info.label.slice(0, 40), path: info.path, bundleId: info.bundleId });
  }
  addWebsite(value: unknown) { this.store.add({ id: randomUUID(), kind: 'website', ...quickTargetWebsiteSchema.parse(value) }); }
}
