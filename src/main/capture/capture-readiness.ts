import type { BrowserWindow } from 'electron';

export const captureReadinessStrategies = [
  'fixed',
  'hide-event',
  'hide-event-immediate',
  'hide-event-tick',
  'hide-event-16',
  'hide-event-32'
] as const;

export type CaptureReadinessStrategy = typeof captureReadinessStrategies[number];

export type CaptureReadinessOptions = {
  window: BrowserWindow;
  strategy: CaptureReadinessStrategy;
  fallbackDelayMs: number;
  onHideCalled(): void;
  onHidden(): void;
};

function wait(delayMs: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}

function waitForImmediate() {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

/**
 * Waits for a macOS BrowserWindow to leave the screen capture surface.
 * The fixed strategy preserves the legacy safety delay; the event strategies
 * are explicitly selectable so real-device tests can establish a safe default.
 */
export async function waitForCaptureReadiness(options: CaptureReadinessOptions) {
  const { window, strategy, fallbackDelayMs, onHideCalled, onHidden } = options;
  let hidden = false;
  let resolveHidden: (() => void) | null = null;
  const hiddenPromise = new Promise<void>((resolve) => { resolveHidden = resolve; });
  const markHidden = () => {
    if (hidden) return;
    hidden = true;
    window.removeListener('hide', markHidden);
    onHidden();
    resolveHidden?.();
  };
  if (window.isVisible()) window.once('hide', markHidden);
  const fixedDelay = strategy === 'fixed' ? wait(fallbackDelayMs) : null;
  onHideCalled();
  if (window.isVisible()) window.hide();
  if (!window.isVisible()) markHidden();

  if (strategy === 'fixed') {
    await Promise.all([hiddenPromise, fixedDelay]);
    return;
  }
  await hiddenPromise;
  if (strategy === 'hide-event-immediate') await waitForImmediate();
  if (strategy === 'hide-event-tick') await wait(0);
  if (strategy === 'hide-event-16') await wait(16);
  if (strategy === 'hide-event-32') await wait(32);
}
