import { useEffect, useState } from 'react';
import { accountCodeRequestSchema, accountSignInSchema, type AccountState } from '../../../shared/account';
import './account.css';

const accessLabels = { none: '暂无资格', pending: '待激活', trial: '体验资格', paid: '订阅中', permanent: '永久资格', expired: '已到期' };
export function AccountPanel({ state, onChanged }: { state: AccountState | null; onChanged: (state: AccountState) => void }) {
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [sentEmail, setSentEmail] = useState('');
  const [retryAt, setRetryAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [developmentCode, setDevelopmentCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ error: boolean; message: string } | null>(null);
  const remaining = Math.max(0, Math.ceil((retryAt - now) / 1000));
  useEffect(() => {
    if (!retryAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [retryAt]);
  useEffect(() => {
    const refresh = () => { void window.snipvia.account.get().then((result) => { if (result.ok) onChanged(result.value); }); };
    refresh();
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [onChanged]);

  async function sendCode() {
    const input = accountCodeRequestSchema.safeParse({ email });
    if (!input.success) { setStatus({ error: true, message: '请输入有效的邮箱地址' }); return; }
    setBusy(true); setStatus(null); setDevelopmentCode(null);
    try {
      const result = await window.snipvia.account.sendCode(input.data);
      if (!result.ok) { setStatus({ error: true, message: result.error }); return; }
      setSentEmail(input.data.email); setOtp(''); setRetryAt(result.value.retryAt); setNow(Date.now());
      setDevelopmentCode(result.value.developmentCode);
      setStatus({ error: false, message: '验证码请求已提交，请检查邮箱和垃圾邮件。验证码 5 分钟内有效。' });
    } catch { setStatus({ error: true, message: '获取验证码失败，请重试' }); }
    finally { setBusy(false); }
  }
  async function signIn() {
    const input = accountSignInSchema.safeParse({ email, otp });
    if (!input.success) { setStatus({ error: true, message: '请输入有效的邮箱和邮件中的 6 位数字验证码' }); return; }
    if (input.data.email !== sentEmail) { setStatus({ error: true, message: '邮箱已修改，请重新获取验证码' }); return; }
    setBusy(true); setStatus(null);
    try {
      const result = await window.snipvia.account.signIn(input.data);
      if (result.ok) {
        onChanged(result.value); setOtp(''); setDevelopmentCode(null); setSentEmail('');
        setStatus({ error: false, message: '登录成功' });
      } else setStatus({ error: true, message: result.error });
    } catch { setStatus({ error: true, message: '登录失败，请重试' }); }
    finally { setBusy(false); }
  }
  async function signOut() {
    setBusy(true); setStatus(null);
    try {
      const result = await window.snipvia.account.signOut();
      if (result.ok) {
        setOtp(''); setDevelopmentCode(null); setSentEmail('');
        setStatus({ error: !result.value.remoteSignedOut, message: result.value.remoteSignedOut ? '已退出登录' : '已退出本机登录。网络不可用，服务器会话尚未撤销，将按有效期失效。' });
      } else setStatus({ error: true, message: result.error });
    } catch { setStatus({ error: true, message: '退出失败，请重试' }); }
    finally { setBusy(false); }
  }
  const user = state?.user;
  return <section className="settings-panel settings-preferences account-panel">
    <header className="settings-page-heading"><div><h1>账号</h1><p>{state?.registrationOpen === false ? '使用邮箱验证码登录已有账号。' : '使用邮箱验证码登录，首次验证后自动注册。'}</p></div></header>
    {user ? <>
      <section className="preference-section" aria-labelledby="account-title">
        <h2 id="account-title">当前账号</h2>
        <div className="preference-card">
          <div className="preference-row"><div className="preference-copy"><strong>邮箱</strong><span>{user.emailVerified ? '邮箱已验证' : '邮箱尚未验证'}</span></div><span className="account-value" data-testid="account-email">{user.email}</span></div>
          <div className="preference-row"><div className="preference-copy"><strong>登录状态</strong><span>{state.connection === 'unavailable' ? '连接中断，显示上次获取的信息；请重新检查' : state.remembered ? '登录凭据已加密保存，下次启动会自动恢复' : '当前设备的安全存储不可用，本次登录仅在应用运行期间有效'}</span></div><button className="preference-action" disabled={busy} onClick={() => void signOut()}>退出登录</button></div>
        </div>
      </section>
      <section className="preference-section" aria-labelledby="account-access-title">
        <h2 id="account-access-title">会员资格</h2>
        <div className="preference-card"><div className="preference-row"><div className="preference-copy"><strong>{accessLabels[user.access.state]}</strong><span>{user.access.expiresAt ? `有效期至 ${new Date(user.access.expiresAt).toLocaleString('zh-CN')}` : user.access.state === 'permanent' ? '长期有效，无需续期' : user.access.state === 'none' ? '可联系管理员领取体验资格' : '资格信息来自账号服务'}</span></div><span className="account-access-label">{state.connection === 'unavailable' ? '待更新' : '已同步'}</span></div></div>
      </section>
      <p className="account-hint">有效体验、订阅或永久资格可使用截图对话。暂无资格或已到期时，请联系管理员开通；普通截图、标注、复制和保存始终可用。</p>
    </> : <section className="preference-section" aria-labelledby="account-login-title">
      <h2 id="account-login-title">登录 / 注册</h2>
      {state?.registrationOpen === false && <p className="account-hint">当前仅开放已有账号登录，新用户请联系管理员。</p>}
      <form onSubmit={(event) => { event.preventDefault(); void signIn(); }}>
        <div className="preference-card">
          <div className="preference-row"><label className="preference-copy" htmlFor="account-email"><strong>邮箱地址</strong><span>接收一次性登录验证码</span></label><input id="account-email" type="email" autoComplete="email" maxLength={254} required className="account-input" placeholder="you@example.com" value={email} disabled={busy || !state?.configured} onChange={(event) => { setEmail(event.target.value); setDevelopmentCode(null); setOtp(''); }} /></div>
          <div className="preference-row"><label className="preference-copy" htmlFor="account-code"><strong>邮箱验证码</strong><span>填写邮件中的 6 位数字</span></label><div className="account-code-controls"><input id="account-code" className="account-input" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required placeholder="6 位验证码" value={otp} disabled={busy || !sentEmail} onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))} /><button type="button" className="preference-action" disabled={busy || remaining > 0 || !email.trim() || !state?.configured} onClick={() => void sendCode()}>{remaining > 0 ? `${remaining} 秒后重发` : '获取验证码'}</button></div></div>
        </div>
        <div className="account-submit"><span>无需设置密码，验证邮箱即可进入。</span><button className="primary" type="submit" disabled={busy || !sentEmail || !otp || !state?.configured}>{busy ? '处理中…' : '登录 / 注册'}</button></div>
      </form>
      {developmentCode && <p className="account-development" role="status">本机开发验证码：<code>{developmentCode}</code>（仅供 .test 邮箱联调，不会发送真实邮件）</p>}
    </section>}
    {state?.error && <p className="preference-status error" role="alert">{state.error}</p>}
    {!state?.configured && state && <p className="preference-status error" role="alert">账号服务暂未配置，请联系应用提供方。</p>}
    {status && <p className={`preference-status ${status.error ? 'error' : 'success'}`} role={status.error ? 'alert' : 'status'}>{status.message}</p>}
    <div className="account-footer"><span>{!state ? '正在读取账号…' : state.connection === 'connected' ? '账号服务已连接' : state.connection === 'unavailable' ? state.sessionPresent ? '登录凭据已保留，等待连接账号服务' : '账号服务暂不可用' : '账号服务未配置'}</span><button type="button" className="preference-action" disabled={busy || !state?.configured} onClick={async () => {
      setBusy(true); setStatus(null);
      try { const result = await window.snipvia.account.get(); if (result.ok) onChanged(result.value); else setStatus({ error: true, message: result.error }); }
      finally { setBusy(false); }
    }}>重新检查</button></div>
  </section>;
}
