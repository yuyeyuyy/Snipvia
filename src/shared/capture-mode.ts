import { z } from 'zod';
export const captureModeSchema = z.enum(['quick', 'collect', 'edit']);
export type CaptureMode = z.infer<typeof captureModeSchema>;
export type CaptureSession = { id: string; mode: CaptureMode; signal: AbortSignal };
export type CaptureResult<T> = { sessionId: string; value: T };

// Default command map. CapturePreferencesStore preserves existing custom bindings.
export const reservedCaptureShortcuts = [
  { id: 'quick', proposed: 'Control+1', available: true },
  { id: 'quick-external', proposed: 'Control+Shift+1', available: false },
  { id: 'collect', proposed: 'Control+2', available: true },
  { id: 'open-collection', proposed: 'Control+Shift+2', available: true },
  { id: 'clear-collection', proposed: 'Alt+2', available: true },
  { id: 'edit', proposed: 'Control+3', available: true }
] as const;

export function normalizeCaptureMode(value: unknown): CaptureMode {
  // Old IPC callers retain a local capture path; no AI or conversation is created.
  if (value === 'ai' || value === undefined) return 'quick';
  if (value === 'standard') return 'edit';
  return captureModeSchema.parse(value);
}
