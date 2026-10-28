import { Worker } from 'node:worker_threads';
import { join } from 'node:path';
import type { BitmapCrop } from './encode-bgra-png';
export class CapturePngEncoder {
  private worker: Worker | null = null;
  private sequence = 0;
  private pending = new Map<number, { resolve(bytes: Buffer): void; reject(error: Error): void; cleanup(): void }>();
  encode(input: BitmapCrop, signal: AbortSignal): Promise<Buffer> {
    signal.throwIfAborted();
    if (!this.worker) {
      const worker = new Worker(join(__dirname, 'capture-png-worker.js')); this.worker = worker; worker.unref();
      worker.on('message', (message: { id: number; bytes?: Uint8Array; error?: string }) => {
        const pending = this.pending.get(message.id); if (!pending) return;
        this.pending.delete(message.id); pending.cleanup();
        if (message.bytes) pending.resolve(Buffer.from(message.bytes)); else pending.reject(new Error(message.error || '截图编码失败'));
        if (!this.pending.size) worker.unref();
      });
      const fail = (error: Error) => {
        if (this.worker !== worker) return;
        this.worker = null;
        for (const pending of this.pending.values()) { pending.cleanup(); pending.reject(error); } this.pending.clear();
      };
      worker.once('error', fail); worker.once('exit', () => fail(new Error('截图编码进程已退出')));
    }
    const worker = this.worker, id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const abort = () => { this.pending.delete(id); cleanup(); reject(new Error('截图输出已取消')); if (!this.pending.size) worker.unref(); };
      const cleanup = () => signal.removeEventListener('abort', abort);
      this.pending.set(id, { resolve, reject, cleanup }); signal.addEventListener('abort', abort, { once: true });
      try {
        const bytes = Uint8Array.from(input.bytes); // Own this transfer; never detach the retained source.
        worker.ref(); worker.postMessage({ ...input, bytes, id }, [bytes.buffer]);
      } catch (error) {
        this.pending.delete(id); cleanup(); if (!this.pending.size) worker.unref();
        reject(error instanceof Error ? error : new Error('截图编码任务发送失败'));
      }
    });
  }
  dispose() {
    const worker = this.worker; this.worker = null;
    for (const pending of this.pending.values()) { pending.cleanup(); pending.reject(new Error('应用退出')); } this.pending.clear();
    void worker?.terminate();
  }
}
