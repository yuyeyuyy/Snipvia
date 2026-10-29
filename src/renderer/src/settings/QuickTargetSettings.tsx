import { useEffect, useState } from 'react';
import type { QuickTargetSettingsState, QuickTargetPermissions, QuickTargetView } from '../../../shared/quick-target';
import type { Result } from '../../../shared/contracts';
import { Button } from '../components/ui/Button';
import { QuickTargetIcon } from '../components/QuickTargetIcon';
import './quick-target-settings.css';

export function QuickTargetSettings() {
  const [state, setState] = useState<QuickTargetSettingsState | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [permissions, setPermissions] = useState<QuickTargetPermissions | null>(null), [permissionBusy, setPermissionBusy] = useState(false);
  const [addingWebsite, setAddingWebsite] = useState(false), [label, setLabel] = useState(''), [url, setUrl] = useState('');
  useEffect(() => {
    let live = true;
    const off = window.snipvia.quickTarget.onSettingsChanged(value => { if (live) setState(value); });
    void window.snipvia.quickTarget.settings().then(result => { if (live) { if (result.ok) setState(result.value); else setError(result.error); } }).catch(() => { if (live) setError('无法读取快速切换设置'); });
    void window.snipvia.quickTarget.permissions().then(result => { if (live && result.ok) setPermissions(result.value); }).catch(() => {});
    return () => { live = false; off(); };
  }, []);
  async function update(action: () => Promise<Result<QuickTargetSettingsState>>) {
    if (busy) return false;
    setBusy(true); setError('');
    try { const result = await action(); if (!result.ok) { setError(result.error); return false; } setState(result.value); return true; }
    catch { setError('设置未保存，请重试'); return false; }
    finally { setBusy(false); }
  }
  function configure(patch: Partial<Pick<QuickTargetSettingsState, 'enabled' | 'durationMs' | 'launchApplications'>>, order = state?.targets.map(target => target.id) ?? []) {
    if (!state) return;
    void update(() => window.snipvia.quickTarget.configure({ enabled: state.enabled, durationMs: state.durationMs, launchApplications: state.launchApplications, ...patch, order }));
  }
  async function permission(kind?: 'automation' | 'accessibility') {
    if (permissionBusy) return;
    setPermissionBusy(true); setError('');
    try {
      const result = await (kind ? window.snipvia.quickTarget.requestPermission(kind) : window.snipvia.quickTarget.permissions());
      if (result.ok) {
        setPermissions(result.value);
        if (kind === 'automation' && result.value.automation !== 'granted') setError('macOS 尚未授予控制 Chrome 的权限。请打开自动化设置，允许截然控制 Google Chrome；如果列表中没有截然，需要更新开发应用的权限用途声明后重试。');
        if (kind === 'accessibility' && !result.value.accessibility) setError('请在辅助功能设置中允许截然，返回后点击刷新权限。');
      } else setError(result.error);
    } catch { setError('无法读取权限，请重试'); }
    finally { setPermissionBusy(false); }
  }
  async function openPermissionSettings(kind: 'automation' | 'accessibility') {
    const result = await window.snipvia.quickTarget.openPermissionSettings(kind).catch(() => null);
    if (!result?.ok) setError(result && !result.ok ? result.error : '无法打开系统设置');
  }
  function browser(target: QuickTargetView, patch: Partial<NonNullable<QuickTargetView['browser']>>) {
    if (!target.browser) return;
    void update(() => window.snipvia.quickTarget.configureBrowser({ id: target.id, ...target.browser!, ...patch }));
  }
  function move(index: number, delta: number) {
    if (!state) return;
    const order = state.targets.map(target => target.id); [order[index], order[index + delta]] = [order[index + delta], order[index]]; configure({}, order);
  }
  return <section className="preference-section" aria-labelledby="quick-target-settings-title"><h3 id="quick-target-settings-title">显示与行为</h3>
    {state && <><div className="preference-card">
      <div className="preference-row"><div className="preference-copy"><strong>显示快速切换条</strong><span>快速截图或收纳区复制成功后，在屏幕顶部显示你选择的应用和网页；不会自动粘贴或发送</span></div><label className="config-checkbox"><input type="checkbox" aria-label="显示快速切换条" checked={state.enabled} disabled={busy || !!state.warning} onChange={event => configure({ enabled: event.target.checked })} /><span /></label></div>
      <div className="preference-row"><div className="preference-copy"><strong>显示时间</strong><span>鼠标悬停或键盘操作时暂停倒计时</span></div><select aria-label="快速切换显示时间" value={state.durationMs} disabled={busy} onChange={event => configure({ durationMs: Number(event.target.value) })}>{[2000, 4000, 6000, 10000, 15000].map(value => <option key={value} value={value}>{value / 1000} 秒</option>)}</select></div>
      <div className="preference-row"><div className="preference-copy"><strong>允许启动未运行的应用</strong><span>关闭时只切换已运行的应用；已有标签模式不会启动 Chrome 或新建标签</span></div><label className="config-checkbox"><input type="checkbox" aria-label="允许启动未运行的应用" checked={state.launchApplications} disabled={busy} onChange={event => configure({ launchApplications: event.target.checked })} /><span /></label></div>
      </div><h3 className="preference-subheading">常用目标</h3><div className="preference-card"><div className="preference-row"><div className="preference-copy"><strong>应用与网页</strong><span>最多 8 个，按这里的顺序显示。网页可选择打开网址，或复用 Chrome 普通标签</span></div><div className="settings-row-actions"><Button disabled={busy || state.targets.length >= 8 || !state.applicationSupported} onClick={() => { void update(() => window.snipvia.quickTarget.addApplication()); }}>添加应用…</Button><Button disabled={busy || state.targets.length >= 8} onClick={() => setAddingWebsite(value => !value)}>添加网页</Button></div></div>
      {!state.applicationSupported && <p className="quick-target-setting-note">{window.snipvia.platform === 'darwin' ? '应用切换组件尚未就绪，请重新启动或更新 Snipvia。' : '此阶段的本地应用切换仅支持 macOS；网页目标可继续使用。'}</p>}
      {state.targets.map((target, index) => <div className="quick-target-setting-group" key={target.id}><div className="preference-row quick-target-setting-row">
        <div className="quick-target-setting-identity"><QuickTargetIcon target={target} size={30} /><div className="preference-copy"><strong>{target.label}</strong><span>{target.detail}</span></div></div>
        <div className="settings-row-actions"><Button aria-label={'上移 ' + target.label} disabled={busy || index === 0} onClick={() => move(index, -1)}>↑</Button><Button aria-label={'下移 ' + target.label} disabled={busy || index === state.targets.length - 1} onClick={() => move(index, 1)}>↓</Button><Button aria-label={'移除 ' + target.label} disabled={busy} onClick={() => { void update(() => window.snipvia.quickTarget.remove(target.id)); }}>移除</Button></div>
      </div>
        {target.browser && <div className="quick-target-browser-options">
          <div className="preference-row"><div className="preference-copy"><strong>切换方式</strong><span>已有标签匹配到多项时会列出选择；不匹配隐身窗口</span></div><select aria-label={target.label + ' 切换方式'} disabled={busy} value={target.browser.mode} onChange={event => browser(target, { mode: event.target.value as 'open' | 'existing-tab' })}><option value="open">默认浏览器打开网址</option><option value="existing-tab" disabled={!state.applicationSupported}>Chrome 已有标签</option></select></div>
          {target.browser.mode === 'existing-tab' && <>
            <div className="preference-row"><div className="preference-copy"><strong>匹配范围</strong><span>同一网站允许选择不同会话；完整网址仅匹配添加时的地址</span></div><select aria-label={target.label + ' 匹配范围'} disabled={busy} value={target.browser.match} onChange={event => browser(target, { match: event.target.value as 'origin' | 'exact' })}><option value="origin">同一网站</option><option value="exact">完整网址</option></select></div>
            <div className="preference-row"><div className="preference-copy"><strong>聚焦消息输入框</strong><span>ChatGPT / DeepSeek：仅聚焦唯一可编辑文本区；无法确定时手动点击。需要辅助功能权限</span></div><label className="config-checkbox"><input type="checkbox" aria-label={target.label + ' 聚焦消息输入框'} checked={target.browser.focusInput} disabled={busy} onChange={event => browser(target, { focusInput: event.target.checked })} /><span /></label></div>
    </>}
        </div>}
      </div>)}
      {state.targets.length === 0 && <p className="quick-target-setting-note">添加目标后，开启上方开关。未配置时保持原来的直接复制行为。</p>}
      {addingWebsite && <form className="quick-target-website-form" onSubmit={event => { event.preventDefault(); void update(() => window.snipvia.quickTarget.addWebsite({ label, url })).then(saved => { if (saved) { setAddingWebsite(false); setLabel(''); setUrl(''); } }); }}>
        <label>名称<input aria-label="网页目标名称" value={label} maxLength={40} required placeholder="例如 ChatGPT" onChange={event => setLabel(event.target.value)} /></label>
        <label>网址<input aria-label="网页目标网址" value={url} maxLength={2048} type="url" required placeholder="https://…" onChange={event => setUrl(event.target.value)} /></label>
        <div className="settings-row-actions"><Button type="submit" disabled={busy}>添加</Button><Button disabled={busy} onClick={() => setAddingWebsite(false)}>取消</Button></div>
        <p>添加后可设置为 Chrome 已有标签；旧配置继续使用默认浏览器打开网址。</p>
      </form>}
      </div>{state.applicationSupported && <><h3 className="preference-subheading">权限与控制</h3><div className="preference-card">
        <div className="preference-row"><div className="preference-copy"><strong>Chrome 自动化权限</strong><span>{!permissions ? '正在读取权限…' : !permissions.chromeRunning ? '请先打开 Chrome，再授权控制已有标签' : permissions.automation === 'granted' ? '已授权：仅在你选择目标时读取匹配标签的地址和标题' : '需要在系统设置中允许控制 Chrome；截图后不会主动弹出授权框'}</span></div><div className="settings-row-actions"><Button disabled={permissionBusy || permissions?.automation === 'granted'} onClick={() => { void permission('automation'); }}>授权 Chrome…</Button><Button onClick={() => { void openPermissionSettings('automation'); }}>自动化设置…</Button><Button disabled={permissionBusy} onClick={() => { void permission(); }}>刷新权限</Button></div></div>
        <div className="preference-row"><div className="preference-copy"><strong>辅助功能权限</strong><span>{permissions?.accessibility ? '已授权；不会读取草稿、改写文本、粘贴或发送' : '可选：只用于聚焦消息输入框。授权后返回此处刷新权限'}</span></div><div className="settings-row-actions"><Button disabled={permissionBusy || permissions?.accessibility} onClick={() => { void permission('accessibility'); }}>授权辅助功能…</Button><Button onClick={() => { void openPermissionSettings('accessibility'); }}>辅助功能设置…</Button></div></div>
      </div></>}
    </>}
  {(error || state?.warning) && <p className="preference-status" role="alert">{error || state?.warning}</p>}</section>;
}
