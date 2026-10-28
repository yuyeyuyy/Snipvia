import type { NativeImage, Rectangle } from 'electron';

export type CaptureBackendName = 'electron' | 'screen-capture-kit';
export type CapturedFrameFormat = 'bgra' | 'jpeg';

export type CaptureDisplay = {
  id: string;
  bounds: Rectangle;
  size: { width: number; height: number };
  scaleFactor: number;
};

export type CapturedFrame = {
  width: number;
  height: number;
  scaleFactor: number;
  displayId: string;
  capturedAt: number;
  buffer?: Buffer;
  format: CapturedFrameFormat;
  bytesPerRow?: number;
  original?: { png(rect: Rectangle, signal: AbortSignal): Promise<Buffer>; release(): void };
  image?: NativeImage;
  preview?: {
    bytes: Buffer;
    mimeType: 'image/jpeg';
    transport: 'jpeg-95';
  };
};

export type CaptureBackendRequest = {
  display: CaptureDisplay;
  performanceSessionId: string;
  mainWindowWasVisible: boolean;
  retainOriginal?: boolean;
  signal?: AbortSignal;
};

export interface CaptureBackend {
  readonly name: CaptureBackendName;
  initialize(): Promise<void>;
  isAvailable(): Promise<boolean>;
  captureDisplay(request: CaptureBackendRequest): Promise<CapturedFrame>;
  invalidateDisplays(): Promise<void>;
  dispose(): Promise<void>;
  shouldAttemptCapture?(): boolean;
  availabilityReason?(): string;
}

export type CaptureEngineResult = {
  frame: CapturedFrame;
  backend: CaptureBackendName;
  fallbackUsed: boolean;
  fallbackReason?: string;
};
