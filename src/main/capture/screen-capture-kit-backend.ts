import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { nativeImage } from 'electron';
import { CaptureHealth, type CaptureHelperState } from './capture-health';
import type { CaptureBackend, CaptureBackendRequest, CapturedFrame } from './types';

export type HelperDisplay = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  pixelWidth: number;
  pixelHeight: number;
  scaleFactor: number;
};

function matchesDisplayDimensions(candidate: HelperDisplay, display: CaptureBackendRequest['display']) {
  return candidate.width === display.size.width
    && candidate.height === display.size.height
    && candidate.pixelWidth === Math.round(display.size.width * display.scaleFactor)
    && candidate.pixelHeight === Math.round(display.size.height * display.scaleFactor);
}

export function mapScreenCaptureKitDisplay(displays: HelperDisplay[], display: CaptureBackendRequest['display']) {
  const exact = displays.find((candidate) => candidate.id === display.id);
  if (exact && matchesDisplayDimensions(exact, display)) return exact;
  const geometry = displays.filter((candidate) => matchesDisplayDimensions(candidate, display));
  return geometry.length === 1 ? geometry[0] : null;
}

type HelperHeader = {
  kind: 'event' | 'response' | 'protocol-error';
  requestId?: string;
  captureSessionId?: string;
  command?: string;
  name?: string;
  ok?: boolean;
  error?: string;
  payloadLength: number;
  displays?: HelperDisplay[];
  excludedApplicationFound?: boolean;
  helperPid?: number;
  displayId?: string;
  width?: number;
  height?: number;
  bytesPerRow?: number;
  format?: 'bgra' | 'jpeg' | 'comparison';
  mimeType?: string;
  capturedAtEpochMs?: number;
  captureMs?: number;
  encodeMs?: number;
  rawBytesLength?: number;
  jpegBytesLength?: number;
  rawEncodeMs?: number;
  jpegEncodeMs?: number;
  displayCacheGeneration?: number;
  recognizedText?: string;
  ocrConfidence?: number;
  ocrLineCount?: number;
  ocrMs?: number;
  ocrAvailable?: boolean;
};

type HelperResponse = { header: HelperHeader; payload: Buffer };
type PendingRequest = {
  requestId: string;
  captureSessionId?: string;
  resolve: (response: HelperResponse) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
  onEvent?: (name: string) => void;
  cleanupAbort?: () => void;
};

export function matchesPendingResponse(
  pending: Pick<PendingRequest, 'requestId' | 'captureSessionId'>,
  response: Pick<HelperHeader, 'requestId' | 'captureSessionId'>
) {
  return pending.requestId === response.requestId && pending.captureSessionId === response.captureSessionId;
}

export type ScreenCaptureKitStatus = {
  available: boolean;
  healthy: boolean;
  helperPid?: number;
  helperPath: string;
  helperRestarts: number;
  displays: HelperDisplay[];
  excludedApplicationFound: boolean;
  lastError?: string;
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
  displayCacheGeneration?: number;
  displayInvalidationCount: number;
};

type ScreenCaptureKitBackendOptions = {
  helperPath: string;
  systemVersion: string;
  timeoutMs?: number;
  outputFormat: () => 'bgra' | 'jpeg' | 'comparison';
  enabled: () => boolean;
  processStrategy?: () => 'persistent' | 'per-capture';
  mark: (sessionId: string, event: 'frame_capture_start' | 'frame_capture_end' | 'sck_request_sent' | 'sck_request_received' | 'sck_capture_start' | 'sck_capture_end' | 'sck_bridge_start' | 'sck_bridge_end' | 'sck_encode_start' | 'sck_encode_end' | 'sck_frame_ready', metadata?: Record<string, string | number | boolean>) => void;
  updateMetadata: (sessionId: string, metadata: Record<string, string | number | boolean>) => void;
};

export class ScreenCaptureKitBackend implements CaptureBackend {
  readonly name = 'screen-capture-kit' as const;
  private child: ChildProcessWithoutNullStreams | null = null;
  private stdoutChunks: Buffer[] = [];
  private stdoutBytes = 0;
  private pendingHeaderLength: number | null = null;
  private pendingHeader: HelperHeader | null = null;
  private pending = new Map<string, PendingRequest>();
  private displays: HelperDisplay[] = [];
  private healthy = false;
  private excludedApplicationFound = false;
  private helperPid: number | undefined;
  private initializePromise: Promise<void> | null = null;
  private restartTimer: NodeJS.Timeout | null = null;
  private circuitProbeTimer: NodeJS.Timeout | null = null;
  private helperRestarts = 0;
  private lastError: string | undefined;
  private disposing = false;
  private readonly health = new CaptureHealth();
  private displayCacheGeneration: number | undefined;
  private displayInvalidationCount = 0;
  private displayRefreshPromise: Promise<void> | null = null;

  constructor(private readonly options: ScreenCaptureKitBackendOptions) {}

  async initialize() {
    if (!this.options.enabled()) {
      this.health.setState('disabled');
      throw new Error('ScreenCaptureKit backend disabled');
    }
    if (!this.supportedSystem()) {
      this.health.setState('disabled');
      throw new Error('ScreenCaptureKit backend requires macOS 14 or later');
    }
    if (!this.health.shouldAttempt()) throw new Error(this.availabilityReason());
    if (this.healthy && this.child) return;
    if (this.initializePromise) return this.initializePromise;
    this.health.setState(this.helperRestarts > 0 ? 'restarting' : 'starting');
    this.initializePromise = this.startAndInitialize().catch((error) => {
      const failure = error instanceof Error ? error : new Error('ScreenCaptureKit initialization failed');
      this.fail(failure);
      throw failure;
    }).finally(() => { this.initializePromise = null; });
    return this.initializePromise;
  }

  async isAvailable() {
    return this.options.enabled() && this.supportedSystem() && this.health.snapshot().state === 'ready'
      && this.healthy && this.excludedApplicationFound && !!this.child;
  }

  shouldAttemptCapture() {
    return this.options.enabled() && this.supportedSystem() && this.health.shouldAttempt();
  }

  availabilityReason() {
    const status = this.health.snapshot();
    if (status.state === 'degraded') {
      return `ScreenCaptureKit circuit open${status.circuitOpenUntil ? ` until ${new Date(status.circuitOpenUntil).toISOString()}` : ''}`;
    }
    return this.lastError ?? `ScreenCaptureKit helper is ${status.state}`;
  }

  async captureDisplay(request: CaptureBackendRequest): Promise<CapturedFrame> {
    await this.initialize();
    let mapped = mapScreenCaptureKitDisplay(this.displays, request.display);
    if (!mapped) {
      await this.invalidateDisplays();
      mapped = mapScreenCaptureKitDisplay(this.displays, request.display);
    }
    if (!mapped) throw new Error('ScreenCaptureKit display mapping failed');
    const format = this.options.outputFormat();
    const command = !process.env.SNIPVIA_SCK_TEST_FAILURE
      ? 'capture'
      : process.env.SNIPVIA_SCK_TEST_FAILURE === 'timeout' ? 'sleep'
        : process.env.SNIPVIA_SCK_TEST_FAILURE === 'crash' ? 'crash' : 'capture';
    const eventMap = {
      'capture-start': 'sck_capture_start',
      'capture-end': 'sck_capture_end',
      'encode-start': 'sck_encode_start',
      'encode-end': 'sck_encode_end',
      'bridge-start': 'sck_bridge_start'
    } as const;
    const requestId = randomUUID();
    const captureStarted = performance.now();
    this.options.mark(request.performanceSessionId, 'sck_request_sent', { displayId: mapped.id, format, requestId });
    let response: HelperResponse;
    try {
      response = await this.request(command, {
        displayId: Number(mapped.id), format, quality: 0.95,
        ...(command === 'sleep' ? { delayMs: 1000 } : {})
      }, this.options.timeoutMs ?? 500, (name) => {
        const event = eventMap[name as keyof typeof eventMap];
        if (event) this.options.mark(request.performanceSessionId, event);
        if (name === 'capture-start') this.options.mark(request.performanceSessionId, 'frame_capture_start', { backend: this.name });
        if (name === 'capture-end') this.options.mark(request.performanceSessionId, 'frame_capture_end', { backend: this.name, sourceCount: 1 });
      }, request.signal, request.performanceSessionId, requestId);
    } catch (error) {
      if (request.signal?.aborted) throw error;
      const failure = error instanceof Error ? error : new Error('ScreenCaptureKit capture failed');
      const circuitOpened = this.health.recordFailure(failure.message, failure.message.includes('timed out'));
      if (circuitOpened) this.openCircuit();
      else this.fail(failure);
      throw failure;
    }
    const captureDurationMs = performance.now() - captureStarted;
    this.health.recordSuccess(captureDurationMs);
    this.options.mark(request.performanceSessionId, 'sck_request_received');
    this.options.mark(request.performanceSessionId, 'sck_bridge_end', { bytes: response.payload.byteLength });
    const header = response.header;
    if (!header.width || !header.height || !header.format || !header.capturedAtEpochMs) throw new Error('ScreenCaptureKit returned incomplete frame metadata');
    let frameBytes = response.payload;
    let previewBytes: Buffer | undefined;
    if (header.format === 'comparison') {
      const rawLength = header.rawBytesLength ?? 0;
      const jpegLength = header.jpegBytesLength ?? 0;
      if (rawLength <= 0 || jpegLength <= 0 || rawLength + jpegLength !== response.payload.byteLength) {
        throw new Error('ScreenCaptureKit comparison payload is inconsistent');
      }
      frameBytes = response.payload.subarray(0, rawLength);
      previewBytes = response.payload.subarray(rawLength);
    }
    const image = header.format === 'bgra' || header.format === 'comparison'
      ? nativeImage.createFromBitmap(frameBytes, { width: header.width, height: header.height, scaleFactor: 1 })
      : undefined;
    if (image?.isEmpty()) throw new Error('ScreenCaptureKit returned an invalid image');
    if (image) {
      const actualSize = image.getSize();
      if (actualSize.width !== header.width || actualSize.height !== header.height) throw new Error('ScreenCaptureKit frame dimensions are inconsistent');
    } else if (frameBytes.byteLength < 4 || frameBytes[0] !== 0xff || frameBytes[1] !== 0xd8) {
      throw new Error('ScreenCaptureKit returned an invalid JPEG frame');
    }
    const expectedWidth = Math.round(request.display.size.width * request.display.scaleFactor);
    const expectedHeight = Math.round(request.display.size.height * request.display.scaleFactor);
    if (header.width !== expectedWidth || header.height !== expectedHeight) throw new Error('ScreenCaptureKit frame does not match the selected Retina display');
    this.options.mark(request.performanceSessionId, 'sck_frame_ready', { width: header.width, height: header.height, format: header.format });
    this.options.updateMetadata(request.performanceSessionId, {
      captureBackend: this.name,
      screenCaptureKitRequestId: requestId,
      screenCaptureKitHelperPid: this.helperPid ?? -1,
      screenCaptureKitHelperRestarts: this.helperRestarts,
      screenCaptureKitRequestDurationMs: captureDurationMs,
      screenCaptureKitDisplayCacheGeneration: header.displayCacheGeneration ?? -1,
      screenCaptureKitDisplayId: mapped.id,
      screenCaptureKitDisplayMapping: mapped.id === request.display.id ? 'verified-direct-id' : 'verified-unique-geometry',
      screenCaptureKitCaptureMs: header.captureMs ?? -1,
      screenCaptureKitEncodeMs: header.encodeMs ?? -1,
      screenCaptureKitPayloadBytes: response.payload.byteLength,
      screenCaptureKitFormat: header.format,
      ...(header.rawBytesLength ? { screenCaptureKitRawBytes: header.rawBytesLength } : {}),
      ...(header.jpegBytesLength ? { screenCaptureKitJpegBytes: header.jpegBytesLength } : {}),
      ...(header.rawEncodeMs === undefined ? {} : { screenCaptureKitRawEncodeMs: header.rawEncodeMs }),
      ...(header.jpegEncodeMs === undefined ? {} : { screenCaptureKitJpegEncodeMs: header.jpegEncodeMs })
    });
    const frame: CapturedFrame = {
      width: header.width,
      height: header.height,
      scaleFactor: request.display.scaleFactor,
      displayId: request.display.id,
      capturedAt: header.capturedAtEpochMs,
      buffer: frameBytes,
      format: header.format === 'comparison' ? 'bgra' : header.format,
      ...(header.bytesPerRow ? { bytesPerRow: header.bytesPerRow } : {}),
      ...(image ? { image } : {}),
      ...(header.format === 'jpeg' || previewBytes ? {
        preview: { bytes: previewBytes ?? response.payload, mimeType: 'image/jpeg' as const, transport: 'jpeg-95' as const }
      } : {})
    };
    if (this.options.processStrategy?.() === 'per-capture') this.recycleHelper();
    return frame;
  }

  async recognizeText(jpeg: Buffer, signal?: AbortSignal, captureSessionId?: string) {
    await this.initialize();
    const response = await this.request('ocr', { imageBase64: jpeg.toString('base64') }, 8_000, undefined, signal, captureSessionId);
    const { recognizedText, ocrConfidence, ocrLineCount, ocrMs } = response.header;
    if (typeof recognizedText !== 'string' || typeof ocrConfidence !== 'number' || typeof ocrLineCount !== 'number') {
      throw new Error('本地 OCR 返回的数据不完整');
    }
    return {
      text: recognizedText,
      confidence: Math.max(0, Math.min(1, ocrConfidence)),
      lineCount: Math.max(0, Math.round(ocrLineCount)),
      available: response.header.ocrAvailable !== false,
      ...(typeof ocrMs === 'number' ? { durationMs: ocrMs } : {})
    };
  }

  async invalidateDisplays() {
    if (this.displayRefreshPromise) return this.displayRefreshPromise;
    this.displayInvalidationCount++;
    this.displays = [];
    if (!this.child || !this.healthy) return;
    this.displayRefreshPromise = (async () => {
      try {
        const result = await this.request('refresh', { excludedPid: process.pid }, 2000);
        this.acceptInitialization(result.header);
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error('ScreenCaptureKit refresh failed'));
      }
    })().finally(() => { this.displayRefreshPromise = null; });
    return this.displayRefreshPromise;
  }

  async dispose() {
    this.disposing = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    if (this.circuitProbeTimer) clearTimeout(this.circuitProbeTimer);
    this.circuitProbeTimer = null;
    const child = this.child;
    this.child = null;
    this.healthy = false;
    if (child && !child.killed) {
      child.stdin.write(`${JSON.stringify({ version: 1, requestId: randomUUID(), command: 'dispose' })}\n`);
      setTimeout(() => { if (!child.killed) child.kill(); }, 100).unref();
    }
    this.rejectPending(new Error('ScreenCaptureKit backend disposed'));
  }

  status(): ScreenCaptureKitStatus {
    const health = this.health.snapshot();
    return {
      available: this.options.enabled() && this.supportedSystem(),
      healthy: this.healthy,
      ...(this.helperPid ? { helperPid: this.helperPid } : {}),
      helperPath: this.options.helperPath,
      helperRestarts: this.helperRestarts,
      displays: this.displays.map((display) => ({ ...display })),
      excludedApplicationFound: this.excludedApplicationFound,
      ...(this.lastError ? { lastError: this.lastError } : {}),
      ...health,
      ...(this.displayCacheGeneration === undefined ? {} : { displayCacheGeneration: this.displayCacheGeneration }),
      displayInvalidationCount: this.displayInvalidationCount
    };
  }

  private async startAndInitialize() {
    await access(this.options.helperPath, constants.X_OK);
    this.disposing = false;
    const child = spawn(this.options.helperPath, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;
    this.stdoutChunks = [];
    this.stdoutBytes = 0;
    this.pendingHeaderLength = null;
    this.pendingHeader = null;
    child.stdout.on('data', (chunk: Buffer) => this.receive(chunk));
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => { stderr = `${stderr}${chunk.toString('utf8')}`.slice(-4096); });
    child.once('error', (error) => this.fail(error));
    child.once('exit', (code, signal) => {
      if (this.child !== child) return;
      this.child = null;
      this.fail(new Error(`ScreenCaptureKit helper exited (${code ?? signal ?? 'unknown'})${stderr ? `: ${stderr.trim()}` : ''}`));
    });
    const response = await this.request('initialize', { excludedPid: process.pid }, 3000);
    this.acceptInitialization(response.header);
    this.healthy = true;
    this.lastError = undefined;
    this.health.setState('ready');
  }

  private acceptInitialization(header: HelperHeader) {
    if (!header.excludedApplicationFound) throw new Error('ScreenCaptureKit could not identify Snipvia for application exclusion');
    if (!Array.isArray(header.displays) || header.displays.length === 0) throw new Error('ScreenCaptureKit did not return any displays');
    this.displays = header.displays;
    this.excludedApplicationFound = true;
    this.helperPid = header.helperPid;
    this.displayCacheGeneration = header.displayCacheGeneration;
  }

  private request(command: string, values: Record<string, unknown>, timeoutMs: number, onEvent?: (name: string) => void, signal?: AbortSignal, captureSessionId?: string, suppliedRequestId?: string) {
    const child = this.child;
    if (!child || child.killed || !child.stdin.writable) return Promise.reject(new Error('ScreenCaptureKit helper unavailable'));
    if (signal?.aborted) return Promise.reject(signal.reason instanceof Error ? signal.reason : new Error('Screen capture cancelled'));
    const requestId = suppliedRequestId ?? randomUUID();
    return new Promise<HelperResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        cleanupAbort?.();
        reject(new Error(`ScreenCaptureKit ${command} timed out after ${timeoutMs}ms`));
        if (this.child === child && !child.killed) {
          child.stdin.write(`${JSON.stringify({
            version: 1,
            requestId: randomUUID(),
            command: 'cancel',
            targetRequestId: requestId
          })}\n`);
          setTimeout(() => {
            if (this.child === child && !child.killed) child.kill('SIGKILL');
          }, 25).unref();
        }
      }, timeoutMs);
      const abort = () => {
        clearTimeout(timer);
        this.pending.delete(requestId);
        cleanupAbort?.();
        reject(signal?.reason instanceof Error ? signal.reason : new Error('Screen capture cancelled'));
        if (this.child === child && !child.killed) {
          child.stdin.write(`${JSON.stringify({ version: 1, requestId: randomUUID(), command: 'cancel', targetRequestId: requestId })}\n`);
        }
      };
      const cleanupAbort = signal ? () => signal.removeEventListener('abort', abort) : undefined;
      signal?.addEventListener('abort', abort, { once: true });
      this.pending.set(requestId, { requestId, captureSessionId, resolve, reject, timer, onEvent, cleanupAbort });
      child.stdin.write(`${JSON.stringify({ version: 1, requestId, command, ...(captureSessionId ? { captureSessionId } : {}), ...values })}\n`, (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.pending.delete(requestId);
        cleanupAbort?.();
        reject(error);
      });
    });
  }

  private receive(chunk: Buffer) {
    this.stdoutChunks.push(chunk);
    this.stdoutBytes += chunk.byteLength;
    while (true) {
      if (this.pendingHeaderLength === null) {
        if (this.stdoutBytes < 4) return;
        const prefix = this.readBytes(4);
        const headerLength = prefix.readUInt32BE(0);
        if (headerLength < 2 || headerLength > 1_048_576) {
          this.fail(new Error('ScreenCaptureKit helper sent an invalid header length'));
          return;
        }
        this.pendingHeaderLength = headerLength;
      }
      if (!this.pendingHeader) {
        if (this.stdoutBytes < this.pendingHeaderLength) return;
        try {
          this.pendingHeader = JSON.parse(this.readBytes(this.pendingHeaderLength).toString('utf8')) as HelperHeader;
        } catch {
          this.fail(new Error('ScreenCaptureKit helper sent invalid JSON metadata'));
          return;
        }
      }
      const payloadLength = Number(this.pendingHeader.payloadLength ?? 0);
      if (!Number.isSafeInteger(payloadLength) || payloadLength < 0 || payloadLength > 128 * 1024 * 1024) {
        this.fail(new Error('ScreenCaptureKit helper sent an invalid payload length'));
        return;
      }
      if (this.stdoutBytes < payloadLength) return;
      const header = this.pendingHeader;
      const payload = this.readBytes(payloadLength);
      this.pendingHeaderLength = null;
      this.pendingHeader = null;
      this.dispatch(header, payload);
    }
  }

  private readBytes(length: number) {
    if (length === 0) return Buffer.alloc(0);
    const first = this.stdoutChunks[0];
    if (first.byteLength === length) {
      this.stdoutChunks.shift();
      this.stdoutBytes -= length;
      return first;
    }
    if (first.byteLength > length) {
      const result = first.subarray(0, length);
      this.stdoutChunks[0] = first.subarray(length);
      this.stdoutBytes -= length;
      return result;
    }
    const result = Buffer.allocUnsafe(length);
    let offset = 0;
    while (offset < length) {
      const current = this.stdoutChunks[0];
      const consumed = Math.min(current.byteLength, length - offset);
      current.copy(result, offset, 0, consumed);
      offset += consumed;
      if (consumed === current.byteLength) this.stdoutChunks.shift();
      else this.stdoutChunks[0] = current.subarray(consumed);
    }
    this.stdoutBytes -= length;
    return result;
  }

  private dispatch(header: HelperHeader, payload: Buffer) {
    if (!header.requestId) return;
    const pending = this.pending.get(header.requestId);
    if (!pending) return;
    if (!matchesPendingResponse(pending, header)) return;
    if (header.kind === 'event') {
      if (header.name) pending.onEvent?.(header.name);
      return;
    }
    clearTimeout(pending.timer);
    pending.cleanupAbort?.();
    this.pending.delete(header.requestId);
    if (header.kind !== 'response' || !header.ok) {
      pending.reject(new Error(header.error || 'ScreenCaptureKit helper request failed'));
      return;
    }
    pending.resolve({ header, payload });
  }

  private supportedSystem() {
    if (process.platform !== 'darwin') return false;
    const major = Number.parseInt(this.options.systemVersion.split('.')[0] ?? '', 10);
    return Number.isFinite(major) && major >= 14;
  }

  private rejectPending(error: Error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.cleanupAbort?.();
      pending.reject(error);
    }
    this.pending.clear();
  }

  private recycleHelper() {
    const child = this.child;
    this.child = null;
    this.healthy = false;
    this.excludedApplicationFound = false;
    this.helperPid = undefined;
    this.displays = [];
    if (!child || child.killed) return;
    child.stdin.write(`${JSON.stringify({ version: 1, requestId: randomUUID(), command: 'dispose' })}\n`);
    setTimeout(() => { if (!child.killed) child.kill(); }, 100).unref();
  }

  private fail(error: Error) {
    this.lastError = error.message;
    this.healthy = false;
    this.excludedApplicationFound = false;
    this.helperPid = undefined;
    this.displays = [];
    this.health.setState('unhealthy');
    this.rejectPending(error);
    const child = this.child;
    this.child = null;
    if (child && !child.killed) child.kill('SIGKILL');
    if (this.disposing || this.restartTimer || !this.health.shouldAttempt() || !this.options.enabled() || !this.supportedSystem()) return;
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.helperRestarts++;
      void this.initialize().catch(() => { /* The Electron backend remains available. */ });
    }, 500);
    this.restartTimer.unref();
  }

  private openCircuit() {
    const child = this.child;
    this.child = null;
    this.healthy = false;
    this.excludedApplicationFound = false;
    this.helperPid = undefined;
    this.displays = [];
    if (child && !child.killed) child.kill('SIGKILL');
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    if (this.circuitProbeTimer || this.disposing) return;
    const openUntil = this.health.snapshot().circuitOpenUntil ?? Date.now() + 30_000;
    this.circuitProbeTimer = setTimeout(() => {
      this.circuitProbeTimer = null;
      if (!this.health.beginProbe()) return;
      this.helperRestarts++;
      void this.initialize().then(() => this.health.probeSucceeded()).catch((error: unknown) => {
        const failure = error instanceof Error ? error : new Error('ScreenCaptureKit health probe failed');
        this.health.probeFailed(failure.message);
        this.openCircuit();
      });
    }, Math.max(0, openUntil - Date.now()));
    this.circuitProbeTimer.unref();
  }
}
