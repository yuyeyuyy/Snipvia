export type CaptureHelperState = 'starting' | 'ready' | 'degraded' | 'unhealthy' | 'restarting' | 'disabled';

export type CaptureHealthSnapshot = {
  state: CaptureHelperState;
  captureCount: number;
  successCount: number;
  failureCount: number;
  timeoutCount: number;
  consecutiveFailures: number;
  recentFailures: number;
  circuitOpenUntil?: number;
  lastCaptureDurationMs?: number;
  recentCaptureP95Ms?: number;
  lastFailure?: string;
};

type CaptureHealthOptions = {
  failureWindow?: number;
  failureThreshold?: number;
  cooldownMs?: number;
  now?: () => number;
};

function percentile(values: number[], fraction: number) {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * fraction) - 1];
}

/** Small, deterministic circuit breaker for the native capture helper. */
export class CaptureHealth {
  private readonly failureWindow: number;
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;
  private results: boolean[] = [];
  private captureDurations: number[] = [];
  private value: CaptureHealthSnapshot = {
    state: 'starting', captureCount: 0, successCount: 0, failureCount: 0,
    timeoutCount: 0, consecutiveFailures: 0, recentFailures: 0
  };

  constructor(options: CaptureHealthOptions = {}) {
    this.failureWindow = options.failureWindow ?? 5;
    this.failureThreshold = options.failureThreshold ?? 3;
    this.cooldownMs = options.cooldownMs ?? 30_000;
    this.now = options.now ?? Date.now;
  }

  setState(state: CaptureHelperState) {
    if (this.value.state === 'degraded' && state !== 'disabled' && !this.cooldownElapsed()) return;
    this.value.state = state;
  }

  recordSuccess(durationMs: number) {
    this.pushResult(true);
    this.captureDurations.push(durationMs);
    if (this.captureDurations.length > 20) this.captureDurations.shift();
    this.value = {
      ...this.value,
      state: 'ready',
      captureCount: this.value.captureCount + 1,
      successCount: this.value.successCount + 1,
      consecutiveFailures: 0,
      recentFailures: this.recentFailureCount(),
      lastCaptureDurationMs: durationMs,
      recentCaptureP95Ms: percentile(this.captureDurations, 0.95)
    };
    delete this.value.circuitOpenUntil;
  }

  recordFailure(reason: string, timedOut: boolean) {
    this.pushResult(false);
    const recentFailures = this.recentFailureCount();
    const open = recentFailures >= this.failureThreshold;
    this.value = {
      ...this.value,
      state: open ? 'degraded' : 'unhealthy',
      captureCount: this.value.captureCount + 1,
      failureCount: this.value.failureCount + 1,
      timeoutCount: this.value.timeoutCount + (timedOut ? 1 : 0),
      consecutiveFailures: this.value.consecutiveFailures + 1,
      recentFailures,
      lastFailure: reason,
      ...(open ? { circuitOpenUntil: this.now() + this.cooldownMs } : {})
    };
    return open;
  }

  shouldAttempt() {
    return this.value.state !== 'disabled' && (this.value.state !== 'degraded' || this.cooldownElapsed());
  }

  beginProbe() {
    if (!this.shouldAttempt()) return false;
    this.value.state = 'restarting';
    return true;
  }

  probeSucceeded() {
    this.results = [];
    this.value = { ...this.value, state: 'ready', consecutiveFailures: 0, recentFailures: 0 };
    delete this.value.circuitOpenUntil;
  }

  probeFailed(reason: string) {
    this.value = {
      ...this.value,
      state: 'degraded',
      lastFailure: reason,
      circuitOpenUntil: this.now() + this.cooldownMs
    };
  }

  snapshot(): CaptureHealthSnapshot {
    return { ...this.value };
  }

  private cooldownElapsed() {
    return this.value.circuitOpenUntil !== undefined && this.now() >= this.value.circuitOpenUntil;
  }

  private pushResult(success: boolean) {
    this.results.push(success);
    if (this.results.length > this.failureWindow) this.results.shift();
  }

  private recentFailureCount() {
    return this.results.filter((success) => !success).length;
  }
}
