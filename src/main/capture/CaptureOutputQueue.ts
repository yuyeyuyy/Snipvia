export type CaptureOutputJob = {
  id: string;
  bytes: number;
  run(signal: AbortSignal): Promise<void>;
  release(): void;
};
type Entry = { job: CaptureOutputJob; controller: AbortController };
export type OutputQueueState = { pending: number; failed: number; bytes: number };
/** Accepted outputs outlive the selection session. Only one job may commit at a time. */
export class CaptureOutputQueue {
  private waiting: Entry[] = [];
  private failed: Entry[] = [];
  private running: Entry | null = null;
  private scheduled = false;
  private disposed = false;
  constructor(private readonly options: {
    maxJobs?: number; maxBytes?: number;
    changed?(state: OutputQueueState): void;
    failed?(id: string, error: unknown): void;
  } = {}) {}
  state(): OutputQueueState {
    const entries = [...this.waiting, ...this.failed, ...(this.running ? [this.running] : [])];
    return { pending: this.waiting.length + Number(!!this.running), failed: this.failed.length, bytes: entries.reduce((n, e) => n + e.job.bytes, 0) };
  }
  assertCapacity(bytes: number) {
    const state = this.state();
    if (this.disposed) throw new Error('截图输出已停止');
    if (!Number.isSafeInteger(bytes) || bytes <= 0 || state.pending + state.failed >= (this.options.maxJobs ?? 3)
      || state.bytes + bytes > (this.options.maxBytes ?? 256 * 1024 * 1024)) {
      throw new Error('截图输出队列已满，请稍候；失败的复制可在菜单中重试或放弃');
    }
  }
  enqueue(job: CaptureOutputJob) {
    this.assertCapacity(job.bytes);
    this.waiting.push({ job, controller: new AbortController() }); this.publish(); this.schedule();
  }
  retryFailed() {
    if (this.disposed) return;
    // A deliberate retry is a new user request, after previously accepted jobs.
    this.waiting.push(...this.failed.splice(0)); this.publish(); this.schedule();
  }
  discardFailed() {
    for (const entry of this.failed.splice(0)) entry.job.release();
    this.publish();
  }
  dispose() {
    this.disposed = true;
    for (const entry of this.waiting.splice(0).concat(this.failed.splice(0))) { entry.controller.abort(); entry.job.release(); }
    this.running?.controller.abort(new Error('应用退出')); this.publish();
  }
  private publish() { this.options.changed?.(this.state()); }
  private schedule() {
    if (this.disposed || this.scheduled || this.running || !this.waiting.length) return;
    this.scheduled = true;
    setImmediate(() => { this.scheduled = false; void this.pump(); });
  }
  private async pump() {
    if (this.disposed || this.running) return;
    const entry = this.waiting.shift(); if (!entry) return;
    this.running = entry; this.publish();
    let retained = false;
    try { await entry.job.run(entry.controller.signal); }
    catch (error) {
      if (!this.disposed) { this.failed.push(entry); retained = true; this.options.failed?.(entry.job.id, error); }
    } finally {
      if (!retained) entry.job.release();
      this.running = null; this.publish(); this.schedule();
    }
  }
}
