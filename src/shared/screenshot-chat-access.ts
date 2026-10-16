import { hasActiveAccess } from './account-protocol';
import type { AccountState } from './account';

export const screenshotMembershipMessage = '截图对话需要有效的会员资格，请联系管理员开通。普通截图、标注、复制和保存仍可使用。';

export function screenshotChatAccessError(state: AccountState, now = Date.now()): string | null {
  if (!state.user || !state.sessionPresent) return `请先登录账号。${screenshotMembershipMessage}`;
  if (state.connection !== 'connected') return '暂时无法验证会员资格，请检查网络后重试或联系管理员。普通截图仍可使用。';
  if (!state.user.emailVerified || state.user.status !== 'active' || !hasActiveAccess(state.user.access, now)) return screenshotMembershipMessage;
  return null;
}

export class ScreenshotChatAccessError extends Error {}
