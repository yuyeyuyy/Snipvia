// Desktop HTTP compatibility contract; administrative models stay private.
export type AccessState = 'none' | 'pending' | 'trial' | 'paid' | 'permanent' | 'expired';
export interface AccessSummary { state: AccessState; expiresAt: number | null }
export function hasActiveAccess(access: AccessSummary, now = Date.now()): boolean {
  if (access.state === 'permanent') return access.expiresAt === null;
  return (access.state === 'trial' || access.state === 'paid') && access.expiresAt !== null
    && Number.isFinite(access.expiresAt) && access.expiresAt > now;
}
