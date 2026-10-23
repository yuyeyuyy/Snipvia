import { z } from 'zod';
const accelerator = z.string().trim().min(1).max(100);
export function acceleratorIdentity(value: string, platform: NodeJS.Platform) {
  const aliases: Record<string, string> = { ctrl: 'control', cmd: 'command', cmdorctrl: platform === 'darwin' ? 'command' : 'control', commandorcontrol: platform === 'darwin' ? 'command' : 'control', option: 'alt', super: platform === 'darwin' ? 'command' : 'super' };
  return value.toLowerCase().split('+').map(part => aliases[part] ?? part).sort().join('+');
}
export const capturePreferencesSchema = z.strictObject({
  shortcut: accelerator,
  editorShortcut: accelerator,
  collectShortcut: accelerator.default('Control+2'),
  collectionShortcut: accelerator.default('Control+Shift+2'),
  clearCollectionShortcut: accelerator.default('Alt+2')
}).refine(value => new Set(Object.values(value)).size === 5, '截图快捷键不能相同');
export const capturePreferencesInputSchema = z.strictObject({
  shortcut: accelerator, editorShortcut: accelerator, collectShortcut: accelerator.optional(),
  collectionShortcut: accelerator.optional(), clearCollectionShortcut: accelerator.optional()
});
export type CapturePreferences = z.infer<typeof capturePreferencesSchema>;
export type CapturePreferencesInput = Pick<CapturePreferences, 'shortcut' | 'editorShortcut'> & Partial<CapturePreferences>;
export const captureShortcutKeys = ['shortcut', 'editorShortcut', 'collectShortcut', 'collectionShortcut', 'clearCollectionShortcut'] as const;
export function extendCapturePreferences(input: CapturePreferencesInput): CapturePreferences {
  const value = { ...input };
  const used = new Set([value.shortcut, value.editorShortcut].map(key => acceleratorIdentity(key, process.platform)));
  for (const [key, fallback] of [['collectShortcut', 'Control+2'], ['collectionShortcut', 'Control+Shift+2'], ['clearCollectionShortcut', 'Alt+2']] as const) {
    if (value[key]) { used.add(acceleratorIdentity(value[key]!, process.platform)); continue; }
    const options = [fallback, fallback.replace('Control+', 'Control+Alt+'), 'Control+Alt+Shift+' + (key === 'clearCollectionShortcut' ? '4' : key === 'collectionShortcut' ? '5' : '6')];
    const free = options.find(option => !used.has(acceleratorIdentity(option, process.platform)));
    if (!free) throw new Error('新增快捷键与原配置冲突，请先调整原配置');
    value[key] = free; used.add(acceleratorIdentity(free, process.platform));
  }
  return capturePreferencesSchema.parse(value);
}
