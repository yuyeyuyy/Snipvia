import { z } from 'zod';
import { performanceSessionIdSchema } from './performance';

export const selectionSchema = z.object({
  x: z.number().finite().nonnegative(), y: z.number().finite().nonnegative(),
  width: z.number().finite().min(3), height: z.number().finite().min(3)
});
export const captureFinishSchema = z.object({ sessionId: performanceSessionIdSchema, selection: selectionSchema });
export type Selection = z.infer<typeof selectionSchema>;
export type PinnedCaptureState = { capture: import('./screenshot').ScreenshotPreview; performanceSessionId: string };
export type CaptureMode = import('./capture-mode').CaptureMode;
export type CaptureOverlaySession = { mode: CaptureMode; performanceSessionId: string; frameReady: boolean };
export type CaptureFrameTransport = 'data-url' | 'png-base64' | 'png-binary' | 'jpeg-90' | 'jpeg-95';
export type CaptureFramePayload = {
  performanceSessionId: string;
  width: number;
  height: number;
  visibilityRafCount: 1 | 2;
} & ({
  transport: 'data-url' | 'png-base64';
  mimeType: 'image/png';
  dataUrl: string;
} | {
  transport: 'png-binary' | 'jpeg-90' | 'jpeg-95';
  mimeType: 'image/png' | 'image/jpeg';
  bytes: Uint8Array;
});
export type CaptureFrameQuality = {
  meanAbsoluteError: number;
  peakSignalToNoiseRatio: number | null;
  maximumChannelError: number;
  sampledPixels: number;
};
export type CaptureBackendStatus = {
  runtimeScreenshots?: { items: number; bytes: number };
  preference: 'auto' | 'electron' | 'sck';
  screenCaptureKit: {
    available: boolean;
    healthy: boolean;
    helperPid?: number;
    helperPath: string;
    helperRestarts: number;
    displays: Array<{
      id: string;
      x: number;
      y: number;
      width: number;
      height: number;
      pixelWidth: number;
      pixelHeight: number;
      scaleFactor: number;
    }>;
    excludedApplicationFound: boolean;
    lastError?: string;
    state: 'starting' | 'ready' | 'degraded' | 'unhealthy' | 'restarting' | 'disabled';
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
  } | null;
  processes: Array<{
    pid: number;
    type: string;
    workingSetKb: number;
    privateBytesKb: number;
  }>;
};
export type ScreenPermissionInfo = {
  status: 'granted' | 'denied' | 'not-determined' | 'restricted' | 'unknown';
  applicationName: string;
  applicationPath: string;
  development: boolean;
  supported: boolean;
};
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
export type LoginItemState = { supported: boolean; enabled: boolean; description: string };

export type SnipviaAPI = import('./desktop-api').DesktopAPI;
