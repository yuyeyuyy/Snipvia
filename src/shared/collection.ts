import { z } from 'zod';
import type { ScreenshotItem } from './screenshot';
import type { Result } from './contracts';
export const collectionOrderSchema = z.strictObject({ ids: z.array(z.string().uuid()).max(32), revision: z.number().int().nonnegative() });
export type CollectionSnapshot = { id: string; createdAt: number; updatedAt: number; revision: number; items: ScreenshotItem[]; count: number };
export type ShelfFeedback = { kind: 'fly' | 'count'; duration: number; thumbnail?: string; source?: { x: number; y: number; width: number; height: number }; target?: { x: number; y: number; width: number; height: number } };
export type ShelfState = { presentation: number; feedback?: ShelfFeedback; collection: CollectionSnapshot; expanded: boolean; hidden: boolean; performanceSessionId?: string };
export type CollectionAPI = {
  current(): Promise<Result<ShelfState>>;
  rendered(presentation: number): Promise<Result<boolean>>;
  reducedMotion(value: boolean): Promise<Result<void>>;
  toggle(): Promise<Result<void>>;
  collapse(): Promise<Result<void>>;
  hide(): Promise<Result<void>>;
  remove(id: string): Promise<Result<ShelfState>>;
  reorder(value: { ids: string[]; revision: number }): Promise<Result<ShelfState>>;
  clear(): Promise<Result<ShelfState>>;
  thumbnail(id: string): Promise<Result<string>>;
  preview(id: string): Promise<Result<void>>;
  image(id: string): Promise<Result<{ bytes: Uint8Array; mimeType: string }>>;
  copyMerged(value: { ids: string[]; revision: number; options: import('./collection-output').MergeOptions; png: Uint8Array }): Promise<Result<void>>;
  export(value: { ids: string[]; revision: number }): Promise<Result<{ count: number; directory: string } | null>>;
  onChanged(callback: (value: ShelfState) => void): () => void;
};
export function shelfBounds(workArea: { x: number; y: number; width: number; height: number }, expanded: boolean) {
  const width = Math.min(expanded ? 420 : 184, workArea.width), height = Math.min(expanded ? 540 : 58, workArea.height);
  return { x: Math.max(workArea.x, workArea.x + workArea.width - width - 16), y: workArea.y + Math.min(16, Math.max(0, workArea.height - height)), width, height };
}
