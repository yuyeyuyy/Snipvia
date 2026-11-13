import { z } from 'zod';
const accelerator = z.string().trim().min(1).max(100);
// Electron resolves CommandOrControl to Command on macOS and Control elsewhere.
export const defaultCapturePreferences = {
  shortcut: 'CommandOrControl+1', editorShortcut: 'CommandOrControl+2',
  collectShortcut: 'CommandOrControl+3', collectionShortcut: 'CommandOrControl+4',
  clearCollectionShortcut: 'CommandOrControl+5'
} as const;
export function acceleratorIdentity(value: string, platform: NodeJS.Platform) {
  const aliases: Record<string, string> = { ctrl: 'control', cmd: 'command', cmdorctrl: platform === 'darwin' ? 'command' : 'control', commandorcontrol: platform === 'darwin' ? 'command' : 'control', option: 'alt', super: platform === 'darwin' ? 'command' : 'super' };
  return value.toLowerCase().split('+').map(part => aliases[part] ?? part).sort().join('+');
}
export const capturePreferencesSchema = z.strictObject({
  shortcut: accelerator,
  editorShortcut: accelerator,
  collectShortcut: accelerator.default(defaultCapturePreferences.collectShortcut),
  collectionShortcut: accelerator.default(defaultCapturePreferences.collectionShortcut),
  clearCollectionShortcut: accelerator.default(defaultCapturePreferences.clearCollectionShortcut)
}).refine(value => new Set(Object.values(value)).size === 5, '截图快捷键不能相同');
export const capturePreferencesInputSchema = z.strictObject({
  shortcut: accelerator, editorShortcut: accelerator, collectShortcut: accelerator.optional(),
  collectionShortcut: accelerator.optional(), clearCollectionShortcut: accelerator.optional()
});
export type CapturePreferences = z.infer<typeof capturePreferencesSchema>;
export type CapturePreferencesInput = Pick<CapturePreferences, 'shortcut' | 'editorShortcut'> & Partial<CapturePreferences>;
export const captureShortcutKeys = ['shortcut', 'editorShortcut', 'collectShortcut', 'collectionShortcut', 'clearCollectionShortcut'] as const;
export function extendCapturePreferences(input: CapturePreferencesInput, platform: NodeJS.Platform = process.platform): CapturePreferences {
  const value = { ...input };
  // Reserve every supplied binding before filling missing fields, including later ones.
  const used = new Set(captureShortcutKeys.flatMap(key => value[key] ? [acceleratorIdentity(value[key]!, platform)] : []));
  for (const [key, fallback] of [['collectShortcut', defaultCapturePreferences.collectShortcut], ['collectionShortcut', defaultCapturePreferences.collectionShortcut], ['clearCollectionShortcut', defaultCapturePreferences.clearCollectionShortcut]] as const) {
    if (value[key]) { used.add(acceleratorIdentity(value[key]!, platform)); continue; }
    const options = [fallback, fallback.replace('CommandOrControl+', 'CommandOrControl+Alt+'), 'CommandOrControl+Alt+Shift+' + (key === 'collectShortcut' ? '3' : key === 'collectionShortcut' ? '4' : '5')];
    const free = options.find(option => !used.has(acceleratorIdentity(option, platform)));
    if (!free) throw new Error('新增快捷键与原配置冲突，请先调整原配置');
    value[key] = free; used.add(acceleratorIdentity(free, platform));
  }
  return capturePreferencesSchema.parse(value);
}
