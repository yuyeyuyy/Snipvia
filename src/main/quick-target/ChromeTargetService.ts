import { randomUUID } from 'node:crypto';
import type { QuickTarget, QuickTargetActivation, QuickTargetPermissions } from '../../shared/quick-target';

export type ChromeTab = { windowId: string; tabId: string; url: string; title: string; index: number };
type Website = Extract<QuickTarget, { kind: 'website' }>;
export type ChromeResolution = { kind: 'unavailable'; permissions: QuickTargetPermissions }
  | { kind: 'choices'; permissions: QuickTargetPermissions; tabs: ChromeTab[] }
  | { kind: 'activated'; permissions: QuickTargetPermissions; focused: boolean };
export interface ChromeTargetBridge {
  resolve(target: Website, signal: AbortSignal): Promise<ChromeResolution>;
  select(tab: ChromeTab, focus: boolean, signal: AbortSignal): Promise<{ activated: true; focused: boolean; accessibility: boolean }>;
}
export function matchesWebsite(expected: string, candidate: string, exact: boolean) {
  try {
    const a = new URL(expected), b = new URL(candidate);
    return ['https:', 'http:'].includes(b.protocol) && !b.username && !b.password && a.origin === b.origin && (!exact || a.href === b.href);
  } catch { return false; }
}

/** Native tab references stay in Main, scoped to one presentation and configuration. */
export class ChromeTargetService {
  private choices = new Map<string, { tab: ChromeTab; target: string; presentation: number; expires: number; fingerprint: string }>();
  constructor(private readonly bridge: ChromeTargetBridge) {}
  clear() { this.choices.clear(); }
  async activate(target: Website, presentation: number, choiceId: string | undefined, signal: AbortSignal): Promise<QuickTargetActivation> {
    signal.throwIfAborted();
    const fingerprint = JSON.stringify([target.url, target.match, target.focusInput]);
    const selected = choiceId ? this.choices.get(choiceId) : undefined;
    if (choiceId && (!selected || selected.target !== target.id || selected.presentation !== presentation || selected.expires < Date.now() || selected.fingerprint !== fingerprint)) throw new Error('标签选择已过期，请重新选择网页目标');
    if (selected) {
      // The helper checks current permission and the full URL; no extra process for a preflight.
      const result = await this.bridge.select(selected.tab, target.focusInput === true, signal);
      signal.throwIfAborted(); this.clear();
      return this.complete(target, result.focused, result.accessibility);
    }
    this.clear();
    const result = await this.bridge.resolve(target, signal); signal.throwIfAborted();
    const permissions = result.permissions;
    if (!permissions.supported) throw new Error('Chrome 已有标签切换当前仅支持 macOS；可在设置中改为打开网址');
    if (!permissions.chromeRunning) throw new Error('请先打开 Chrome 和目标网页；不会自动启动或新建标签');
    if (permissions.automation !== 'granted') throw new Error('请在设置的快速切换中授权控制 Chrome；图片仍在剪贴板中');
    if (result.kind === 'activated') return this.complete(target, result.focused, permissions.accessibility);
    if (result.kind !== 'choices') throw new Error('浏览器切换状态已变化，请重试');
    const tabs = result.tabs.filter(item => matchesWebsite(target.url, item.url, target.match === 'exact'));
    if (!tabs.length) throw new Error('Chrome 中没有匹配的普通标签，请先打开目标网页');
    if (tabs.length > 32) throw new Error('匹配标签过多，请关闭部分标签或使用完整网址匹配');
    const windows = new Map<string, number>();
    const choices = tabs.map(item => {
      if (!windows.has(item.windowId)) windows.set(item.windowId, windows.size + 1);
      const id = randomUUID();
      this.choices.set(id, { tab: item, target: target.id, presentation, expires: Date.now() + 60000, fingerprint });
      return { id, title: [...item.title].filter(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127 && !'\u200e\u200f\u202a\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069'.includes(character)).join('').slice(0, 160) || target.label, detail: `Chrome · 窗口 ${windows.get(item.windowId)} · 标签 ${item.index}` };
    });
    return { kind: 'choose', choices };
  }
  private complete(target: Website, focused: boolean, accessibility: boolean): QuickTargetActivation {
    if (target.focusInput && !focused) return { kind: 'manual', message: accessibility ? '已切换网页；未找到唯一可编辑输入框，请手动点击后粘贴' : '已切换网页；输入框聚焦需要辅助功能权限，请手动点击后粘贴' };
    return { kind: 'done' };
  }
}
