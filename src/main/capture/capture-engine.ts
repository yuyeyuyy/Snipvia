import type { CaptureBackend, CaptureBackendRequest, CaptureEngineResult } from './types';

type CaptureEngineOptions = {
  primary: CaptureBackend;
  fallback: CaptureBackend;
  primaryEnabled: () => boolean;
  beforeFallback?: () => void | Promise<void>;
  onFallback?: (sessionId: string, reason: string) => void;
};

export class CaptureEngine {
  private initialized = false;
  private primaryHealthy = false;
  private primaryError = 'ScreenCaptureKit backend unavailable';

  constructor(private readonly options: CaptureEngineOptions) {}

  async initialize() {
    if (this.initialized) return;
    this.initialized = true;
    const [primary] = await Promise.allSettled([
      this.options.primaryEnabled() ? this.options.primary.initialize() : Promise.reject(new Error('ScreenCaptureKit backend disabled')),
      this.options.fallback.initialize()
    ]);
    this.primaryHealthy = primary.status === 'fulfilled' && await this.options.primary.isAvailable();
    if (primary.status === 'rejected') this.primaryError = primary.reason instanceof Error ? primary.reason.message : 'ScreenCaptureKit initialization failed';
  }

  async captureDisplay(request: CaptureBackendRequest): Promise<CaptureEngineResult> {
    request.signal?.throwIfAborted();
    if (!this.initialized) await this.initialize();
    request.signal?.throwIfAborted();
    // Windows uses Electron directly. Never consult native health or retry the
    // Swift helper when the platform has disabled the primary backend.
    if (!this.options.primaryEnabled()) {
      await this.options.beforeFallback?.();
      request.signal?.throwIfAborted();
      return { frame: await this.options.fallback.captureDisplay(request), backend: this.options.fallback.name, fallbackUsed: false };
    }
    const attemptPrimary = this.options.primary.shouldAttemptCapture?.() ?? true;
    if (!attemptPrimary) {
      const reason = this.options.primary.availabilityReason?.() ?? this.primaryError;
      this.options.onFallback?.(request.performanceSessionId, reason);
      await this.options.beforeFallback?.();
      return {
        frame: await this.options.fallback.captureDisplay(request),
        backend: this.options.fallback.name,
        fallbackUsed: true,
        fallbackReason: reason
      };
    }
    if (this.options.primaryEnabled() && (!this.primaryHealthy || !await this.options.primary.isAvailable())) {
      try {
        await this.options.primary.initialize();
        this.primaryHealthy = await this.options.primary.isAvailable();
      } catch (error) {
        this.primaryHealthy = false;
        this.primaryError = error instanceof Error ? error.message : 'ScreenCaptureKit initialization failed';
      }
    }
    if (this.primaryHealthy && await this.options.primary.isAvailable()) {
      try {
        return {
          frame: await this.options.primary.captureDisplay(request),
          backend: this.options.primary.name,
          fallbackUsed: false
        };
      } catch (error) {
        if (request.signal?.aborted) {
          throw request.signal.reason instanceof Error ? request.signal.reason : new Error('Screen capture cancelled');
        }
        const reason = error instanceof Error ? error.message : 'ScreenCaptureKit capture failed';
        this.primaryHealthy = false;
        this.options.onFallback?.(request.performanceSessionId, reason);
        void this.options.primary.initialize().then(async () => {
          this.primaryHealthy = await this.options.primary.isAvailable();
        }).catch(() => { this.primaryHealthy = false; });
        await this.options.beforeFallback?.();
        return {
          frame: await this.options.fallback.captureDisplay(request),
          backend: this.options.fallback.name,
          fallbackUsed: true,
          fallbackReason: reason
        };
      }
    }
    const fallbackUsed = this.options.primaryEnabled();
    if (fallbackUsed) this.options.onFallback?.(request.performanceSessionId, this.primaryError);
    await this.options.beforeFallback?.();
    return {
      frame: await this.options.fallback.captureDisplay(request),
      backend: this.options.fallback.name,
      fallbackUsed,
      ...(fallbackUsed ? { fallbackReason: this.primaryError } : {})
    };
  }

  async invalidateDisplays() {
    await Promise.allSettled([
      this.options.primary.invalidateDisplays(),
      this.options.fallback.invalidateDisplays()
    ]);
  }

  async dispose() {
    await Promise.allSettled([this.options.primary.dispose(), this.options.fallback.dispose()]);
    this.initialized = false;
    this.primaryHealthy = false;
  }
}
