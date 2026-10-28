import { z } from 'zod';
import type { ScreenshotItem } from './screenshot';
import type { Result } from './contracts';
import { defaultShelfSize, type ShelfSize, type ShelfPreferences } from './shelf-preferences';
export const collectionOrderSchema = z.strictObject({ ids: z.array(z.string().uuid()).max(32), revision: z.number().int().nonnegative() });
export type CollectionSnapshot = { id: string; createdAt: number; updatedAt: number; revision: number; items: ScreenshotItem[]; count: number };
export type ShelfRect = { x: number; y: number; width: number; height: number };
export type ShelfFeedback = { kind: 'count'; duration: number } | { kind: 'fly'; id: string; duration: number; thumbnail: string; source: ShelfRect; target: ShelfRect };
export type ShelfPreview = { id: string; source: ShelfRect; target: ShelfRect; closing: boolean };
export type ShelfEdge = 'shown' | 'docking' | 'docked' | 'revealing';
export type ShelfState = { preferences: ShelfPreferences; edge: ShelfEdge; wide: boolean; preview?: ShelfPreview; viewport: { width: number; height: number }; size: ShelfSize; presentation: number; feedback?: ShelfFeedback; collection: CollectionSnapshot; expanded: boolean; hidden: boolean; suspended: boolean; performanceSessionId?: string };
export type CollectionAPI = {
  current(): Promise<Result<ShelfState>>;
  configure(value: ShelfPreferences): Promise<Result<ShelfState>>;
  widen(): Promise<Result<ShelfState>>;
  reveal(): Promise<Result<void>>;
  edgeFinished(presentation: number): Promise<Result<boolean>>;
  openPreview(value: { id: string; source: ShelfRect }): Promise<Result<void>>;
  closePreview(): Promise<Result<void>>;
  previewFinished(presentation: number): Promise<Result<boolean>>;
  resize(value: ShelfSize & { commit?: boolean }): Promise<Result<ShelfState>>;
  interaction(active: boolean): Promise<Result<void>>;
  feedbackFinished(presentation: number): Promise<Result<boolean>>;
  hitRegions(regions: ShelfRect[]): Promise<Result<void>>;
  rendered(presentation: number): Promise<Result<boolean>>;
  reducedMotion(value: boolean): Promise<Result<void>>;
  toggle(): Promise<Result<void>>;
  collapse(): Promise<Result<void>>;
  hide(): Promise<Result<void>>;
  remove(id: string): Promise<Result<ShelfState>>;
  reorder(value: { ids: string[]; revision: number }): Promise<Result<ShelfState>>;
  clear(): Promise<Result<ShelfState>>;
  copy(id: string): Promise<Result<void>>;
  startDrag(value: { id: string; revision: number }): Promise<Result<void>>;
  thumbnail(id: string): Promise<Result<string>>;
  preview(id: string): Promise<Result<void>>;
  image(id: string): Promise<Result<{ bytes: Uint8Array; mimeType: string }>>;
  copyAll(value: { revision: number }): Promise<Result<void>>;
  copyMerged(value: { ids: string[]; revision: number; options: import('./collection-output').MergeOptions; png: Uint8Array }): Promise<Result<void>>;
  export(value: { ids: string[]; revision: number }): Promise<Result<{ count: number; directory: string } | null>>;
  onChanged(callback: (value: ShelfState) => void): () => void;
};
export function shelfBounds(workArea: { x: number; y: number; width: number; height: number }, size: ShelfSize = defaultShelfSize) {
  const width = Math.min(size.width, workArea.width), height = Math.min(size.height, workArea.height);
  return { x: Math.max(workArea.x, workArea.x + workArea.width - width - 16), y: workArea.y + Math.min(16, Math.max(0, workArea.height - height)), width, height };
}
export const shelfContentTop = 44;
export const shelfShadowGutter = 16;
export const shelfCardGap = 12;
export function shelfStackHeight(viewportHeight: number) { return Math.max(80, Math.min(460, viewportHeight - 100)); }

type ImageSize = { width: number; height: number };
export type ShelfCard = ShelfRect & { rotation: number };
/** Actual aspect-ratio rows; small source images may enlarge in the preview only. */
export function shelfLayout(images: ImageSize[], viewportWidth: number, expanded: boolean, maximumHeight = 660): { cards: ShelfCard[]; height: number } {
  const gutter = shelfShadowGutter, available = Math.max(1, viewportWidth - gutter * 2);
  if (expanded) {
    let y = gutter;
    const cards = images.map(image => {
      const scale = Math.min(available / image.width, Math.max(76, Math.min(520, maximumHeight - 100)) / image.height);
      const width = image.width * scale, height = image.height * scale, row = Math.max(76, height);
      const card = { x: (viewportWidth - width) / 2, y: y + (row - height) / 2, width, height, rotation: 0 };
      y += row + shelfCardGap;
      return card;
    });
    return { cards, height: Math.max(110, y - (images.length ? shelfCardGap : 0) + gutter) };
  }
  const top = images.at(-1) ?? { width: 4, height: 3 };
  const maximum = Math.max(120, Math.min(shelfStackHeight(maximumHeight), viewportWidth * 1.05, available * top.height / top.width + 24));
  const angles = [0, -4, 3, -6, 5], count = images.length;
  const cards = images.map((image, index) => {
    const depth = Math.min(4, count - 1 - index), rotation = angles[depth], radians = rotation * Math.PI / 180;
    // Every stack layer fills a consistent visual envelope, irrespective of its source dimensions.
    const maxW = Math.max(...angles.map(a => Math.abs(Math.cos(a * Math.PI / 180)) * image.width + Math.abs(Math.sin(a * Math.PI / 180)) * image.height));
    const maxH = Math.max(...angles.map(a => Math.abs(Math.sin(a * Math.PI / 180)) * image.width + Math.abs(Math.cos(a * Math.PI / 180)) * image.height));
    const scale = Math.min(Math.max(1, available - 16) / maxW, Math.max(1, maximum - 20) / maxH);
    const width = image.width * scale, height = image.height * scale;
    return { x: viewportWidth / 2 + 4 - depth * 2 - (width * Math.cos(radians) - height * Math.sin(radians)) / 2,
      y: gutter + maximum / 2 + depth * 4 - (width * Math.sin(radians) + height * Math.cos(radians)) / 2,
      width, height, rotation };
  });
  const bottoms = cards.slice(-5).map(card => {
    const a = card.rotation * Math.PI / 180;
    return card.y + Math.max(0, card.width * Math.sin(a), card.height * Math.cos(a), card.width * Math.sin(a) + card.height * Math.cos(a));
  });
  return { cards, height: Math.max(110, ...bottoms) + gutter };
}
export function shelfCardRect(image: ImageSize, viewportWidth: number, index: number, count: number, expanded: boolean, viewportHeight = 660): ShelfCard {
  return shelfLayout(Array.from({ length: count }, () => image), viewportWidth, expanded, viewportHeight).cards[index];
}
export function shelfWindowBounds(area: ShelfRect, size: ShelfSize, images: ImageSize[], expanded: boolean, wide = false, heightMode: ShelfPreferences['heightMode'] = 'fixed'): ShelfRect {
  const width = Math.min(area.width, wide ? Math.min(960, Math.round(size.width * 1.4)) : size.width);
  const expandedHeight = heightMode === 'screen' ? Math.round(area.height * .75) : size.height;
  const layout = shelfLayout(images, width, expanded, expanded ? expandedHeight : size.height);
  // Expansion opens the browsing viewport, even when only one photo is collected.
  const height = Math.min(area.height, expanded ? expandedHeight : Math.min(size.height, Math.ceil(layout.height + shelfContentTop + shelfShadowGutter)));
  return shelfBounds(area, { width, height });
}
export function shelfDockBounds(area: ShelfRect, visible: ShelfRect): ShelfRect {
  return { x: area.x + area.width - 22, y: Math.max(area.y, Math.min(area.y + area.height - 84, visible.y + visible.height / 2 - 42)), width: 22, height: Math.min(84, area.height) };
}
export function shelfPreviewTarget(image: ImageSize, area: ImageSize): ShelfRect {
  const scale = Math.min(Math.max(1, area.width - 96) / image.width, Math.max(1, area.height - 112) / image.height);
  const width = image.width * scale, height = image.height * scale;
  return { x: (area.width - width) / 2, y: (area.height - height) / 2, width, height };
}

export function shelfDropIndex(cards: ShelfCard[], y: number) {
  let closest = 0, distance = Infinity;
  cards.forEach((card, index) => { const d = Math.abs(y - (card.y + card.height / 2)); if (d < distance) { distance = d; closest = index; } });
  return closest;
}
