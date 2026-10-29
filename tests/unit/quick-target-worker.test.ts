import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, expect, it, vi } from 'vitest';
const { launch } = vi.hoisted(() => ({ launch: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: launch }));
import { ChromeWorker } from '../../src/main/quick-target/ChromeWorker';

function peer() {
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), killed: false, kill: vi.fn(() => { child.killed = true; return true; }) });
  launch.mockReturnValueOnce(child);
  return child;
}
afterEach(() => { launch.mockReset(); vi.useRealTimers(); });
it('prewarms once and reuses a bounded private pipe for subsequent commands', async () => {
  const child = peer(), worker = new ChromeWorker('/fixture/helper');
  const ready = worker.prepare(); expect(worker.prepare()).toBe(ready); child.stdout.write('{"ready":true}\n'); await ready;
  for (let index = 0; index < 2; index++) {
    const result = worker.request('browser-resolve', { url: 'https://example.test/' }, new AbortController().signal);
    await Promise.resolve();
    const request = JSON.parse(child.stdin.read().toString());
    expect(request.command).toBe('browser-resolve');
    child.stdout.write(JSON.stringify({ id: request.id, ok: true, value: { sample: index } }) + '\n');
    await expect(result).resolves.toEqual({ sample: index });
  }
  expect(launch).toHaveBeenCalledTimes(1); worker.dispose(); expect(child.kill).toHaveBeenCalledOnce();
});
it('kills canceled work and ignores an old child reply after replacement', async () => {
  const first = peer(), worker = new ChromeWorker('/fixture/helper');
  const ready = worker.prepare(); first.stdout.write('{"ready":true}\n'); await ready;
  const controller = new AbortController(), result = worker.request('browser-select', {}, controller.signal); await Promise.resolve();
  const old = JSON.parse(first.stdin.read().toString()); const rejected = expect(result).rejects.toThrow('取消'); controller.abort(); await rejected;
  expect(first.kill).toHaveBeenCalledOnce();
  const second = peer(), next = worker.prepare();
  first.stdout.write(JSON.stringify({ id: old.id, ok: true, value: 'stale' }) + '\n');
  second.stdout.write('{"ready":true}\n'); await next;
  expect(second.kill).not.toHaveBeenCalled(); worker.dispose();
});
it('rejects an unmatched response and oversized native output without accepting an action result', async () => {
  const child = peer(), worker = new ChromeWorker('/fixture/helper');
  const ready = worker.prepare(); child.stdout.write('{"ready":true}\n'); await ready;
  const result = worker.request('browser-resolve', {}, new AbortController().signal); await Promise.resolve();
  const request = JSON.parse(child.stdin.read().toString());
  const rejected = expect(result).rejects.toThrow('无效数据');
  child.stdout.write(JSON.stringify({ id: request.id === '00000000-0000-4000-8000-000000000000' ? '00000000-0000-4000-8000-000000000001' : '00000000-0000-4000-8000-000000000000', ok: true, value: {} }) + '\n'); await rejected;
  const second = peer(), next = worker.prepare(); const failed = expect(next).rejects.toThrow('过大'); second.stdout.write('x'.repeat(256 * 1024 + 1)); await failed;
});
it('bounds startup and request deadlines and safely exposes only fixed native errors', async () => {
  vi.useFakeTimers(); const first = peer(), worker = new ChromeWorker('/fixture/helper');
  const startup = worker.prepare(), timedOut = expect(startup).rejects.toThrow('准备超时'); await vi.advanceTimersByTimeAsync(5000); await timedOut;
  expect(first.kill).toHaveBeenCalledOnce();
  const child = peer(), ready = worker.prepare(); child.stdout.write('{"ready":true}\n'); await ready;
  const request = worker.request('browser-select', {}, new AbortController().signal); await Promise.resolve();
  const result = expect(request).rejects.toThrow('切换超时'); await vi.advanceTimersByTimeAsync(4000); await result;
  const third = peer(), warm = worker.prepare(); third.stdout.write('{"ready":true}\n'); await warm;
  const denied = worker.request('browser-select', {}, new AbortController().signal); await Promise.resolve();
  const payload = JSON.parse(third.stdin.read().toString());
  third.stdout.write(JSON.stringify({ id: payload.id, ok: false, error: 'permissionRequired' }) + '\n');
  await expect(denied).rejects.toThrow('授权控制 Chrome'); expect(third.kill).not.toHaveBeenCalled(); worker.dispose();
});
