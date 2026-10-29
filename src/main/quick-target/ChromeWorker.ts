import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

const reply = z.discriminatedUnion('ok', [
  z.strictObject({ id: z.uuid(), ok: z.literal(true), value: z.unknown() }),
  z.strictObject({ id: z.uuid(), ok: z.literal(false), error: z.enum(['invalid', 'permissionRequired', 'chromeNotRunning', 'tabChanged', 'unavailable']) })
]);
const messages = { invalid: '浏览器切换请求无效', permissionRequired: '请在设置中授权控制 Chrome', chromeNotRunning: 'Chrome 尚未运行', tabChanged: '标签已关闭、跳转或无法定位，请重新选择', unavailable: '浏览器切换组件暂不可用，请重试' };

/** Private, bounded pipe for two browser operations. It never accepts scripts or file paths. */
export class ChromeWorker {
  private child: ChildProcessWithoutNullStreams | null = null;
  private preparing: Promise<void> | null = null;
  private ready = false;
  private startup: { resolve(): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> } | null = null;
  private pending: { id: string; resolve(value: unknown): void; reject(error: Error): void; cleanup(): void } | null = null;
  constructor(private readonly helper: string) {}
  prepare(): Promise<void> {
    if (this.ready) return Promise.resolve();
    if (this.preparing) return this.preparing;
    const child = spawn(this.helper, ['browser-server'], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;
    let buffer = '';
    const pending = new Promise<void>((resolve, reject) => {
      this.startup = { resolve, reject, timer: setTimeout(() => this.fail(child, new Error('浏览器组件准备超时，请重试')), 5000) };
    }).finally(() => { if (this.preparing === pending) this.preparing = null; });
    this.preparing = pending;
    child.stdout.setEncoding('utf8'); child.stderr.resume();
    child.stdout.on('data', (chunk: string) => {
      if (this.child !== child) return;
      buffer += chunk;
      if (Buffer.byteLength(buffer) > 256 * 1024) { this.fail(child, new Error('浏览器组件响应过大')); return; }
      let end: number;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        try {
          const value: unknown = JSON.parse(line);
          if (!this.ready) {
            z.strictObject({ ready: z.literal(true) }).parse(value);
            this.ready = true;
            const startup = this.startup; this.startup = null;
            if (startup) { clearTimeout(startup.timer); startup.resolve(); }
          } else {
            const result = reply.parse(value), request = this.pending;
            if (!request || request.id !== result.id) throw new Error('stale response');
            this.pending = null; request.cleanup();
            if (result.ok) request.resolve(result.value); else request.reject(new Error(messages[result.error]));
          }
        } catch { this.fail(child, new Error('浏览器组件返回无效数据')); return; }
      }
    });
    child.stdin.on('error', () => this.fail(child, new Error('浏览器组件连接已中断')));
    child.once('error', () => this.fail(child, new Error('无法启动浏览器组件')));
    child.once('exit', () => this.fail(child, new Error('浏览器组件已退出，请重试')));
    return pending;
  }
  async request(command: 'browser-resolve' | 'browser-select', input: unknown, signal: AbortSignal) {
    signal.throwIfAborted(); await this.prepare(); signal.throwIfAborted();
    const child = this.child;
    if (!child || !this.ready || !child.stdin.writable) throw new Error('浏览器组件尚未就绪');
    if (this.pending) throw new Error('正在切换，请稍候');
    const id = randomUUID(), payload = JSON.stringify({ id, command, input }) + '\n';
    if (Buffer.byteLength(payload) > 8192) throw new Error('浏览器切换请求过大');
    return new Promise<unknown>((resolve, reject) => {
      const abort = () => this.fail(child, new Error('快速切换已取消'));
      const timer = setTimeout(() => this.fail(child, new Error('浏览器切换超时，请重试')), 4000);
      const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); };
      this.pending = { id, resolve, reject, cleanup };
      signal.addEventListener('abort', abort, { once: true });
      child.stdin.write(payload, error => { if (error) this.fail(child, new Error('浏览器组件连接已中断')); });
    });
  }
  dispose() { if (this.child) this.fail(this.child, new Error('浏览器切换已取消')); }
  private fail(child: ChildProcessWithoutNullStreams, error: Error) {
    if (this.child !== child) return;
    this.child = null; this.ready = false; this.preparing = null;
    const startup = this.startup; this.startup = null;
    if (startup) { clearTimeout(startup.timer); startup.reject(error); }
    const request = this.pending; this.pending = null;
    if (request) { request.cleanup(); request.reject(error); }
    if (!child.killed) child.kill();
  }
}
