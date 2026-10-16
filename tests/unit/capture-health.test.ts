import { describe, expect, it } from 'vitest';
import { CaptureHealth } from '../../src/main/capture/capture-health';

describe('CaptureHealth', () => {
  it('opens after three failures in five captures and recovers after cooldown probe', () => {
    let now = 1_000;
    const health = new CaptureHealth({ now: () => now, cooldownMs: 30_000 });
    health.recordFailure('one', false);
    health.recordSuccess(100);
    health.recordFailure('two', true);
    health.recordSuccess(110);
    expect(health.recordFailure('three', true)).toBe(true);
    expect(health.snapshot()).toMatchObject({ state: 'degraded', recentFailures: 3, timeoutCount: 2 });
    expect(health.shouldAttempt()).toBe(false);
    now += 30_000;
    expect(health.shouldAttempt()).toBe(true);
    expect(health.beginProbe()).toBe(true);
    health.probeSucceeded();
    expect(health.snapshot()).toMatchObject({ state: 'ready', recentFailures: 0 });
  });

  it('keeps the recent capture P95 for local diagnostics', () => {
    const health = new CaptureHealth();
    [100, 110, 90, 140, 105].forEach((duration) => health.recordSuccess(duration));
    expect(health.snapshot()).toMatchObject({ captureCount: 5, successCount: 5, recentCaptureP95Ms: 140 });
  });
});
