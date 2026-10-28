import { expect, it, vi } from 'vitest';
import { CaptureOutputQueue } from '../../src/main/capture/CaptureOutputQueue';
import { CaptureModeRouter } from '../../src/main/capture/CaptureModeRouter';

it('confirmed outputs survive a new selection and commit in order', async () => {
  let unblock!: () => void; const gate = new Promise<void>(r => { unblock = r; }), commits: string[] = [], released: string[] = [];
  const queue = new CaptureOutputQueue();
  const router = new CaptureModeRouter<number>({
    quick: async (_, session) => {
      queue.enqueue({ id: session.id, bytes: 1, run: async () => { if (session.id === 'first') await gate; commits.push(session.id); }, release: () => { released.push(session.id); } });
      router.detach(session.id);
    }, edit: async () => {}
  });
  router.begin('first', 'quick'); await router.complete({ sessionId: 'first', value: 0 });
  router.begin('second', 'quick'); await router.complete({ sessionId: 'second', value: 0 });
  await vi.waitFor(() => expect(queue.state().pending).toBe(2));
  expect(commits).toEqual([]); unblock();
  await vi.waitFor(() => expect(queue.state().pending).toBe(0));
  expect(commits).toEqual(['first', 'second']); expect(released).toEqual(['first', 'second']);
});

it('retains failures within both limits and retries only after prior accepted work', async () => {
  const done: string[] = [], release = vi.fn(); let fail = true;
  const queue = new CaptureOutputQueue({ maxJobs: 2, maxBytes: 10 });
  queue.enqueue({ id: 'failed', bytes: 6, run: async () => { if (fail) throw Error('clipboard denied'); done.push('retry'); }, release });
  await vi.waitFor(() => expect(queue.state().failed).toBe(1));
  expect(release).not.toHaveBeenCalled(); expect(() => queue.assertCapacity(5)).toThrow('队列已满');
  queue.enqueue({ id: 'newer', bytes: 4, run: async () => { done.push('newer'); }, release: () => {} });
  expect(() => queue.assertCapacity(1)).toThrow('队列已满');
  fail = false; queue.retryFailed();
  await vi.waitFor(() => expect(queue.state()).toEqual({ pending: 0, failed: 0, bytes: 0 }));
  expect(done).toEqual(['newer', 'retry']); expect(release).toHaveBeenCalledTimes(1);
});

it('disposes queued and failed resources, aborts running work and refuses new output', async () => {
  let started = false; const releases: string[] = [];
  const queue = new CaptureOutputQueue();
  queue.enqueue({ id: 'active', bytes: 1, run: signal => new Promise((_, reject) => { started = true; signal.addEventListener('abort', () => reject(Error('exit')), { once: true }); }), release: () => { releases.push('active'); } });
  queue.enqueue({ id: 'queued', bytes: 1, run: async () => {}, release: () => { releases.push('queued'); } });
  await vi.waitFor(() => expect(started).toBe(true)); queue.dispose();
  await vi.waitFor(() => expect(queue.state().pending).toBe(0));
  expect(releases.sort()).toEqual(['active', 'queued']); expect(() => queue.assertCapacity(1)).toThrow('已停止');
});
