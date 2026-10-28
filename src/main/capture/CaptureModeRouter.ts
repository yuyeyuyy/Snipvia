import type { CaptureMode, CaptureResult, CaptureSession } from '../../shared/capture-mode';

/** Owns mode dispatch and invalidation, never capture pixels or global window state. */
export class CaptureModeRouter<T> {
  private active: { session: CaptureSession; controller: AbortController; finishing: boolean } | null = null;
  constructor(private readonly handlers: { collect?(result: CaptureResult<T>, session: CaptureSession): Promise<void | boolean>; quick(result: CaptureResult<T>, session: CaptureSession): Promise<void | boolean>; edit(result: CaptureResult<T>, session: CaptureSession): Promise<void | boolean> }) {}
  begin(id: string, mode: CaptureMode): CaptureSession {
    if (mode === 'collect' && !this.handlers.collect) throw new Error('连续收纳尚未实现');
    this.cancel();
    const controller = new AbortController();
    const session = Object.freeze({ id, mode, signal: controller.signal });
    this.active = { session, controller, finishing: false };
    return session;
  }
  current(id: string) { return this.active?.session.id === id ? this.active.session : null; }
  detach(id: string) { if (this.active?.session.id === id) this.active = null; }
  cancel(id?: string) {
    if (id && this.active?.session.id !== id) return;
    this.active?.controller.abort(new Error('截图会话已结束'));
    this.active = null;
  }
  async complete(result: CaptureResult<T>) {
    const active = this.active;
    if (!active || active.session.id !== result.sessionId || active.session.signal.aborted) throw new Error('截图会话已失效');
    if (active.finishing) throw new Error('正在完成截图');
    active.finishing = true;
    try {
      const handler = this.handlers[active.session.mode];
      if (!handler) throw new Error('截图模式不可用');
      const completed = await handler(result, active.session);
      if (completed === false && this.active === active) { active.finishing = false; return false; }
      active.session.signal.throwIfAborted();
      if (this.active === active) this.active = null;
    } catch (error) {
      if (this.active === active) active.finishing = false;
      throw error;
    }
  }
}
