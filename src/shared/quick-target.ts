import { z } from 'zod';
import type { Result } from './contracts';

const label = z.string().trim().min(1).max(40);
export const quickTargetId = z.uuid();
const localPath = z.string().min(1).max(4096).refine(value => ![...value].some(character => character.charCodeAt(0) < 32), '应用路径无效');
export const quickTargetUrl = z.string().trim().max(2048).transform((value, context) => {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error();
    return url.toString();
  } catch { context.addIssue({ code: 'custom', message: '请输入不含账号密码的 HTTP(S) 网址' }); return z.NEVER; }
});
export const quickTargetSchema = z.discriminatedUnion('kind', [
  z.strictObject({ id: quickTargetId, kind: z.literal('application'), label, path: localPath, bundleId: z.string().min(1).max(255) }),
  z.strictObject({ id: quickTargetId, kind: z.literal('website'), label, url: quickTargetUrl, mode: z.enum(['open', 'existing-tab']).optional(), match: z.enum(['origin', 'exact']).optional(), focusInput: z.boolean().optional() })
]);
export const quickTargetPreferencesSchema = z.strictObject({
  schemaVersion: z.literal(1), enabled: z.boolean(), durationMs: z.number().int().min(2000).max(15000),
  launchApplications: z.boolean(), targets: z.array(quickTargetSchema).max(8)
}).refine(value => new Set(value.targets.map(target => target.id)).size === value.targets.length, '目标 ID 不能重复');
export type QuickTarget = z.infer<typeof quickTargetSchema>;
export type QuickTargetPreferences = z.infer<typeof quickTargetPreferencesSchema>;
export const defaultQuickTargetPreferences: QuickTargetPreferences = { schemaVersion: 1, enabled: false, durationMs: 4000, launchApplications: false, targets: [] };
export const quickTargetConfigureSchema = z.strictObject({ enabled: z.boolean(), durationMs: z.number().int().min(2000).max(15000), launchApplications: z.boolean(), order: z.array(quickTargetId).max(8) });
export const quickTargetWebsiteSchema = z.strictObject({ label, url: quickTargetUrl });
export const quickTargetBrowserSchema = z.strictObject({ id: quickTargetId, mode: z.enum(['open', 'existing-tab']), match: z.enum(['origin', 'exact']), focusInput: z.boolean() });
export const quickTargetPermissionSchema = z.enum(['automation', 'accessibility']);
export type QuickTargetPermissions = { supported: boolean; chromeRunning: boolean; automation: 'granted' | 'required' | 'denied'; accessibility: boolean };
export type QuickTargetChoice = { id: string; title: string; detail: string };
export type QuickTargetActivation = { kind: 'done' } | { kind: 'manual'; message: string } | { kind: 'choose'; choices: QuickTargetChoice[] };
export const quickTargetRenameSchema = z.strictObject({ id: quickTargetId, label });
export const quickTargetPresentationSchema = z.strictObject({ presentationId: z.number().int().positive() });
export const quickTargetActivateSchema = quickTargetPresentationSchema.extend({ targetId: quickTargetId, choiceId: quickTargetId.optional() });
export const quickTargetInteractionSchema = quickTargetPresentationSchema.extend({ active: z.boolean() });
export type QuickTargetView = { id: string; kind: QuickTarget['kind']; label: string; detail: string; icon?: string; websiteIcon?: 'chatgpt' | 'deepseek'; browserIcon?: string; browser?: { mode: 'open' | 'existing-tab'; match: 'origin' | 'exact'; focusInput: boolean } };
export type QuickTargetSettingsState = { enabled: boolean; durationMs: number; launchApplications: boolean; targets: QuickTargetView[]; applicationSupported: boolean; warning: string };
export type QuickTargetState = { presentationId: number; visible: boolean; busy: boolean; error: string; targets: QuickTargetView[]; notice?: string; choices?: QuickTargetChoice[]; choiceTargetId?: string };
export type QuickTargetArea = { x: number; y: number; width: number; height: number };
export function quickTargetBounds(area: QuickTargetArea, count: number) {
  const width = Math.max(1, Math.min(area.width, Math.max(200, Math.min(8, Math.max(1, count)) * 74 + 40)));
  const columns = Math.max(1, Math.floor((width - 40) / 74));
  const height = Math.max(1, Math.min(area.height, 68 + Math.ceil(Math.max(1, count) / columns) * 74));
  return { x: Math.round(area.x + (area.width - width) / 2), y: Math.round(area.y + Math.min(12, Math.max(0, area.height - height))), width, height };
}
export type QuickTargetAPI = {
  onSettingsChanged(callback: (state: QuickTargetSettingsState) => void): () => void;
  settings(): Promise<Result<QuickTargetSettingsState>>;
  configure(value: z.infer<typeof quickTargetConfigureSchema>): Promise<Result<QuickTargetSettingsState>>;
  addApplication(): Promise<Result<QuickTargetSettingsState>>;
  addWebsite(value: z.infer<typeof quickTargetWebsiteSchema>): Promise<Result<QuickTargetSettingsState>>;
  configureBrowser(value: z.infer<typeof quickTargetBrowserSchema>): Promise<Result<QuickTargetSettingsState>>;
  permissions(): Promise<Result<QuickTargetPermissions>>;
  requestPermission(value: z.infer<typeof quickTargetPermissionSchema>): Promise<Result<QuickTargetPermissions>>;
  openPermissionSettings(value: z.infer<typeof quickTargetPermissionSchema>): Promise<Result<void>>;
  rename(value: z.infer<typeof quickTargetRenameSchema>): Promise<Result<QuickTargetSettingsState>>;
  remove(id: string): Promise<Result<QuickTargetSettingsState>>;
  current(): Promise<Result<QuickTargetState>>;
  activate(value: z.infer<typeof quickTargetActivateSchema>): Promise<Result<void>>;
  rendered(value: z.infer<typeof quickTargetPresentationSchema>): Promise<Result<boolean>>;
  interaction(value: z.infer<typeof quickTargetInteractionSchema>): Promise<Result<void>>;
  dismiss(value: z.infer<typeof quickTargetPresentationSchema>): Promise<Result<void>>;
  focus(): Promise<Result<boolean>>;
  onChanged(callback: (state: QuickTargetState) => void): () => void;
};
