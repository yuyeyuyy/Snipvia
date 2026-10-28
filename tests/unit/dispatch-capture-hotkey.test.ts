import { it, expect } from 'vitest';
import { dispatchCaptureHotkey } from '../../src/main/capture/dispatch-capture-hotkey';
it('leaves the native callback and preserves shortcut arrival time and mode in the Node task', async () => {
  const calls: { mode: string; at: number }[] = [], errors: unknown[] = [];
  const before = performance.now();
  dispatchCaptureHotkey('quick', async (mode, at) => { calls.push({ mode, at }); }, error => errors.push(error));
  expect(calls).toEqual([]);
  await new Promise<void>(resolve => setImmediate(resolve));
  expect(calls).toHaveLength(1); expect(calls[0].mode).toBe('quick');
  expect(calls[0].at).toBeGreaterThanOrEqual(before); expect(calls[0].at).toBeLessThanOrEqual(performance.now());
  expect(errors).toEqual([]);
});
it('delivers asynchronous and synchronous errors without an unhandled native callback rejection', async () => {
  const errors: unknown[] = [];
  dispatchCaptureHotkey('edit', async () => { throw Error('async capture denied'); }, error => errors.push(error));
  dispatchCaptureHotkey('collect', () => { throw Error('sync capture denied'); }, error => errors.push(error));
  await new Promise<void>(resolve => setImmediate(resolve));
  expect(errors.map(error => (error as Error).message).sort()).toEqual(['async capture denied', 'sync capture denied']);
});
