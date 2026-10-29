import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { z } from 'zod';
import { ChromeWorker } from './ChromeWorker';
import type { QuickTarget, QuickTargetPermissions } from '../../shared/quick-target';
import type { ChromeTab, ChromeResolution } from './ChromeTargetService';
const permissionsSchema = z.strictObject({ supported: z.boolean(), chromeRunning: z.boolean(), automation: z.enum(['granted', 'required', 'denied']), accessibility: z.boolean() });
const tabSchema = z.strictObject({ windowId: z.string().min(1).max(128), tabId: z.string().min(1).max(128), url: z.string().max(4096), title: z.string().max(160), index: z.number().int().positive() });

const description = z.strictObject({ path: z.string().max(4096), bundleId: z.string().min(1).max(255), label: z.string().min(1).max(200), version: z.string().max(100) });
export class QuickTargetPlatform {
  private worker: ChromeWorker | null = null;
  constructor(private readonly helper: string, private readonly platform = process.platform, private readonly timing?: (value: { operation: string; durationMs: number; success: boolean }) => void) {}
  supported() { return this.platform === 'darwin' && existsSync(this.helper); }
  private async run(args: string[], signal?: AbortSignal, input?: unknown, timeout = 4000): Promise<unknown> {
    if (!this.supported()) throw new Error(this.platform === 'darwin' ? '应用切换组件不可用，请更新或重新安装 Snipvia' : '当前阶段尚未支持此系统的应用切换；网页地址仍可使用');
    signal?.throwIfAborted();
    return new Promise((resolve, reject) => {
      const started = performance.now();
      const record = (success: boolean) => { try { this.timing?.({ operation: args[0], durationMs: Math.round(performance.now() - started), success }); } catch { /* Diagnostics never affect switching. */ } };
      const child = execFile(this.helper, args, { timeout, maxBuffer: 256 * 1024, signal }, (error, stdout, stderr) => {
        if (error) {
          record(false);
          const message = signal?.aborted ? '快速切换已取消' : stderr.trim() === 'permissionRequired' ? '请在设置中授权控制 Chrome' : stderr.trim() === 'chromeNotRunning' ? 'Chrome 尚未运行' : stderr.trim() === 'tabChanged' ? '标签已关闭、跳转或无法定位，请重新选择' : stderr.trim() === 'notRunning' ? '目标应用尚未运行；请先打开，或在设置中允许启动' : '未能切换目标：应用可能已移动或系统拒绝激活';
          reject(new Error(message)); return;
        }
        try {
          const result: unknown = JSON.parse(stdout);
          record(true); resolve(result);
        } catch { record(false); reject(new Error('应用切换组件返回无效数据')); }
      });
      child.stdin?.on('error', () => { /* execFile reports a failed child through its callback. */ });
      child.stdin?.end(input === undefined ? undefined : JSON.stringify(input));
    });
  }
  async permissions(signal?: AbortSignal): Promise<QuickTargetPermissions> {
    if (!this.supported()) return { supported: false, chromeRunning: false, automation: 'required', accessibility: false };
    return permissionsSchema.parse(await this.run(['permissions'], signal));
  }
  async requestPermission(kind: 'automation' | 'accessibility') {
    if (kind === 'automation' && !(await this.permissions()).chromeRunning) throw new Error('请先打开 Google Chrome，再点击授权；无需重启 Snipvia');
    return permissionsSchema.parse(await this.run(['request-' + kind], undefined, undefined, 60000));
  }
  prepareBrowser() {
    if (!this.supported()) return Promise.resolve();
    this.worker ??= new ChromeWorker(this.helper);
    return this.worker.prepare();
  }
  disposeBrowser() { this.worker?.dispose(); this.worker = null; }
  private async browser(command: 'browser-resolve' | 'browser-select', input: unknown, signal: AbortSignal) {
    if (!this.supported()) throw new Error('当前系统的浏览器切换组件不可用');
    this.worker ??= new ChromeWorker(this.helper);
    const started = performance.now(); let success = false;
    try { const result = await this.worker.request(command, input, signal); success = true; return result; }
    finally { try { this.timing?.({ operation: command, durationMs: Math.round(performance.now() - started), success }); } catch { /* Diagnostics never affect switching. */ } }
  }
  async resolve(target: Extract<QuickTarget, { kind: 'website' }>, signal: AbortSignal): Promise<ChromeResolution> {
    if (!this.supported()) return { kind: 'unavailable', permissions: await this.permissions(signal) };
    return z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('unavailable'), permissions: permissionsSchema }),
      z.strictObject({ kind: z.literal('choices'), permissions: permissionsSchema, tabs: z.array(tabSchema).max(32) }),
      z.strictObject({ kind: z.literal('activated'), permissions: permissionsSchema, focused: z.boolean() })
    ]).parse(await this.browser('browser-resolve', { url: target.url, exact: target.match === 'exact', focus: target.focusInput === true }, signal));
  }
  async tabs(target: Extract<QuickTarget, { kind: 'website' }>, signal: AbortSignal): Promise<ChromeTab[]> {
    return z.strictObject({ tabs: z.array(tabSchema).max(32) }).parse(await this.run(['browser-list'], signal, { url: target.url, exact: target.match === 'exact' })).tabs;
  }
  async select(tab: ChromeTab, focus: boolean, signal: AbortSignal) {
    return z.strictObject({ activated: z.literal(true), focused: z.boolean(), accessibility: z.boolean() }).parse(await this.browser('browser-select', { windowId: tab.windowId, tabId: tab.tabId, url: tab.url, focus }, signal));
  }
  async describe(path: string) { return description.parse(await this.run(['describe', path])); }
  async icon(path: string) {
    return z.strictObject({ icon: z.string().max(44000).regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/) }).parse(await this.run(['icon', path])).icon;
  }
  async browserIcon(mode: 'chrome' | 'default' | 'http') {
    if (!this.supported()) return undefined;
    return z.strictObject({ icon: z.string().max(44000).regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/).nullable() }).parse(await this.run(['browser-icon', mode])).icon ?? undefined;
  }
  async activate(target: { path: string; bundleId: string }, launch: boolean, signal: AbortSignal) {
    const result = z.strictObject({ activated: z.literal(true) }).parse(await this.run(['activate', target.path, target.bundleId, String(launch)], signal));
    signal.throwIfAborted(); return result;
  }
}
