import { clipboard } from 'electron';

/** A random, non-sensitive nonce in the same atomic clipboard commit; never read image bytes. */
export const quickTargetClipboardType = 'web application/x.snipvia.quick-target';
/** Attach metadata in the same transaction as image bytes or native file references. */
export function quickTargetClipboardMetadata(marker?: string): Record<string, Blob> {
  return marker ? { [quickTargetClipboardType]: new Blob([marker], { type: 'application/x.snipvia.quick-target' }) } : {};
}
export async function clipboardMatchesQuickTarget(marker: string) {
  try {
    const items = await clipboard.read();
    const item = items.find(value => value.types.includes(quickTargetClipboardType));
    if (!item) return false;
    const data = await item.getType(quickTargetClipboardType);
    return data instanceof Blob && data.size === marker.length && await data.text() === marker;
  } catch { return false; }
}
