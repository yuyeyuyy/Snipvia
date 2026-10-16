import { z } from 'zod';
import type { Result } from './contracts';

export const accountEmailSchema = z.string().trim().toLowerCase().pipe(z.email('请输入有效的邮箱地址').max(254));
export const accountCodeRequestSchema = z.object({ email: accountEmailSchema }).strict();
export const accountSignInSchema = z.object({
  email: accountEmailSchema, otp: z.string().trim().regex(/^\d{6}$/, '请输入邮件中的 6 位数字验证码')
}).strict();
export const accountUserSchema = z.object({
  id: z.string(), email: z.email(), emailVerified: z.boolean(), role: z.enum(['user', 'admin']),
  status: z.enum(['active', 'disabled', 'deleted']),
  access: z.object({ state: z.enum(['none', 'pending', 'trial', 'paid', 'permanent', 'expired']), expiresAt: z.number().nullable() })
});
export type AccountUser = z.infer<typeof accountUserSchema>;
export interface AccountState {
  configured: boolean;
  connection: 'connected' | 'unavailable' | 'unconfigured';
  registrationOpen: boolean | null;
  user: AccountUser | null;
  sessionPresent: boolean;
  remembered: boolean;
  error: string | null;
}
export interface AccountCodeSent { retryAt: number; developmentCode: string | null }
export interface AccountAPI {
  get(): Promise<Result<AccountState>>;
  sendCode(value: { email: string }): Promise<Result<AccountCodeSent>>;
  signIn(value: { email: string; otp: string }): Promise<Result<AccountState>>;
  signOut(): Promise<Result<{ remoteSignedOut: boolean }>>;
  onChanged(callback: (state: AccountState) => void): () => void;
}
