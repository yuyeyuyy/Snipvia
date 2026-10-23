import { useEffect, useState } from 'react';
import type { Result, ScreenPermissionInfo } from '../../../shared/contracts';

const statusText: Record<ScreenPermissionInfo['status'], string> = {
  granted: '已授权', denied: '尚未授权', 'not-determined': '等待首次授权', restricted: '被系统限制', unknown: '状态未知'
};

export function ScreenPermissionCard({ onChange }: { onChange?(info: ScreenPermissionInfo): void }) {
  const [info, setInfo] = useState<ScreenPermissionInfo | null>(null);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');

  async function refresh() {
    const result = await window.snipvia.permissions.screen();
    if (result.ok) { setInfo(result.value); setError(''); onChange?.(result.value); }
    else setError(result.error);
  }
  async function act(action: Promise<Result<void>>, success: string) {
    const result = await action;
    if (result.ok) { setError(''); setFeedback(success); }
    else { setError(result.error); setFeedback(''); }
  }
  useEffect(() => {
    void refresh();
    const onFocus = () => { void refresh(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  if (info && !info.supported) return null;
  const stableDevelopment = !!info?.development && info.applicationName === '截然 Dev.app';
  return <section className="permission-card" aria-label="录屏权限">
    <div className="permission-heading"><strong>录屏权限</strong><span className={`permission-status ${info?.status ?? 'unknown'}`}>{info ? statusText[info.status] : '正在检查…'}</span></div>
    {info?.status === 'granted' ? <p>系统已授权，可以使用截图与标注。{stableDevelopment ? '源码更新继续运行 pnpm dev，不需要重新添加权限。' : info.development ? '若 macOS 要求重启，请退出 Electron 欢迎页，在项目终端停止旧进程后重新运行 pnpm dev。' : '若 macOS 要求重启，请重新打开 Snipvia.app。'}</p> : <>
      <p>首次截图时 macOS 会请求授权。若此前已拒绝，系统不会重复弹出授权框，需要在「系统设置 → 隐私与安全性 → 录屏与系统录音」中打开。</p>
      {info && <>
        <p>列表中应查找 <strong>{info.applicationName}</strong>{info.development && !stableDevelopment ? '（当前开发模式以 Electron 运行）' : ''}。{stableDevelopment ? '当前开发应用使用临时签名，macOS 不会自动把它加入列表。点击“在 Finder 中选中”，把已选中的应用直接拖入录屏列表并打开开关；无需浏览文件夹。' : '若列表中没有，请点「添加」，在文件选择器按 ⌘⇧G，粘贴下方路径后选择该应用。'}</p>
        {!stableDevelopment && <code className="permission-path">{info.applicationPath}</code>}
        <div className="permission-actions">
          <button type="button" className="primary" onClick={() => void act(window.snipvia.permissions.openScreenSettings(), '已打开录屏设置')}>打开录屏设置</button>
          {stableDevelopment && <button type="button" className="secondary" onClick={() => void act(window.snipvia.permissions.revealApplication(), '已在 Finder 中选中截然 Dev.app')}>在 Finder 中选中</button>}
          {!stableDevelopment && <>
            <button type="button" className="secondary" onClick={() => void act(window.snipvia.permissions.copyApplicationPath(), '已复制应用路径')}>复制应用路径</button>
            <button type="button" className="secondary" onClick={() => void act(window.snipvia.permissions.revealApplication(), '已在 Finder 中显示应用')}>在 Finder 中显示</button>
          </>}
        </div>
        <p className="permission-footnote">{info.development
          ? stableDevelopment
            ? '开发权限固定绑定到“~/Applications/截然 Dev.app”。完成这一次授权后，普通源码修改和重新启动不会改变权限主体；只有升级 Electron 运行时才需要重新授权。'
            : '开发版授权绑定到 Electron.app。macOS 的“退出并重新打开”可能只打开 Electron 欢迎页；关闭该页，在项目终端按 Ctrl+C 停止旧进程，再运行 pnpm dev。不要从 Finder 单独打开 Electron.app。'
          : '授权与 Snipvia.app 绑定。授权后按系统提示退出并重新打开同一个 Snipvia.app。'}</p>
      </>}
    </>}
    <button type="button" className="text-button" onClick={() => void refresh()}>重新检查权限</button>
    {(feedback || error) && <div className={error ? 'permission-feedback error-text' : 'permission-feedback'} role={error ? 'alert' : 'status'}>{error || feedback}</div>}
  </section>;
}
