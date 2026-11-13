import { z } from 'zod';
import { defaultCapturePreferences } from './capture-preferences';
export const captureModeSchema = z.enum(['quick', 'collect', 'edit']);
export type CaptureMode = z.infer<typeof captureModeSchema>;
export type CaptureSession = { id: string; mode: CaptureMode; signal: AbortSignal };
export type CaptureResult<T> = { sessionId: string; value: T };

// Default command map. CapturePreferencesStore preserves existing custom bindings.
export const reservedCaptureShortcuts = [
  { id: 'quick', proposed: defaultCapturePreferences.shortcut, available: true },
  { id: 'quick-external', proposed: 'CommandOrControl+Shift+1', available: false },
  { id: 'collect', proposed: defaultCapturePreferences.collectShortcut, available: true },
  { id: 'open-collection', proposed: defaultCapturePreferences.collectionShortcut, available: true },
  { id: 'clear-collection', proposed: defaultCapturePreferences.clearCollectionShortcut, available: true },
  { id: 'edit', proposed: defaultCapturePreferences.editorShortcut, available: true }
] as const;

export function normalizeCaptureMode(value: unknown): CaptureMode {
  // Old IPC callers retain a local capture path; no AI or conversation is created.
  if (value === 'ai' || value === undefined) return 'quick';
  if (value === 'standard') return 'edit';
  return captureModeSchema.parse(value);
}
