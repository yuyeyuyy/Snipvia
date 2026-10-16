import { describe, expect, it } from 'vitest';
import { hasActiveAccess } from '../../src/shared/account-protocol';
import type { AccountState } from '../../src/shared/account';
import { screenshotChatAccessError } from '../../src/shared/screenshot-chat-access';

const now = 1_800_000_000_000;
function member(): AccountState {
  return { configured: true, connection: 'connected', registrationOpen: true, sessionPresent: true, remembered: true, error: null,
    user: { id: 'synthetic-user', email: 'member@example.test', emailVerified: true, role: 'user', status: 'active', access: { state: 'trial', expiresAt: now + 1 } } };
}
describe('截图对话会员资格', () => {
  it.each(['none', 'pending', 'expired'] as const)('拒绝 %s，即使截止时间尚未到', state => {
    const account = member(); account.user!.access.state = state;
    expect(screenshotChatAccessError(account, now)).toContain('联系管理员');
  });
  it.each(['trial', 'paid'] as const)('%s 在到期前允许，到期时立即拒绝', state => {
    const account = member(); account.user!.access.state = state;
    expect(screenshotChatAccessError(account, now)).toBeNull();
    expect(screenshotChatAccessError(account, now + 1)).toContain('联系管理员');
    account.user!.access.expiresAt = null;
    expect(screenshotChatAccessError(account, now)).not.toBeNull();
  });
  it('允许明确的永久资格，拒绝损坏的永久期限', () => {
    expect(hasActiveAccess({ state: 'permanent', expiresAt: null }, now)).toBe(true);
    expect(hasActiveAccess({ state: 'permanent', expiresAt: now + 1 }, now)).toBe(false);
  });
  it('离线缓存不能授权截图对话', () => {
    const account = member(); account.connection = 'unavailable';
    expect(screenshotChatAccessError(account, now)).toContain('验证会员资格');
  });
  it('未登录不能靠残留用户信息获得资格', () => {
    const account = member(); account.sessionPresent = false;
    expect(screenshotChatAccessError(account, now)).toContain('请先登录');
  });
  it.each(['disabled', 'deleted'] as const)('拒绝 %s 账号', status => {
    const account = member(); account.user!.status = status;
    expect(screenshotChatAccessError(account, now)).not.toBeNull();
  });
  it('管理员也需要资格，未验证邮箱不能获得资格', () => {
    const account = member(); account.user!.role = 'admin'; account.user!.access.state = 'none';
    expect(screenshotChatAccessError(account, now)).not.toBeNull();
    account.user!.access.state = 'trial'; account.user!.emailVerified = false;
    expect(screenshotChatAccessError(account, now)).not.toBeNull();
  });
});
