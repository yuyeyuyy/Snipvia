import { performance } from 'node:perf_hooks';
import type { CaptureMode } from '../../shared/capture-mode';

/** Native accelerator callbacks are not a Node async entry. Wake libuv explicitly. */
export function dispatchCaptureHotkey(
  mode: CaptureMode,
  start: (mode: CaptureMode, requestedAt: number) => Promise<void>,
  failed: (error: unknown) => void
) {
  const requestedAt = performance.now();
  setImmediate(() => {
    try { void start(mode, requestedAt).catch(failed); } catch (error) { failed(error); }
  });
}
