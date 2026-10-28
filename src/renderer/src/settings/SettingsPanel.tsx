import { useEffect, useState } from 'react';
import type { LoginItemState } from '../../../shared/contracts';
import type { CapturePreferences } from '../../../shared/capture-preferences';
import { version } from '../../../../package.json';
import { Button } from '../components/ui/Button';
import { AppearanceSettings } from './AppearanceSettings';
import { UpdateSettings } from './UpdateSettings';
import { ShortcutRecorder } from './ShortcutRecorder';
import { LegacyDataPanel } from './LegacyDataPanel';
import { ScreenPermissionCard } from '../permissions/ScreenPermissionCard';
import { ShelfSettings } from './ShelfSettings';
import './settings.css';
import './v2-settings.css';

export function SettingsPanel({ settings, onSaved }: { settings: CapturePreferences; onSaved(value: CapturePreferences): void }) {
  const [loginItem, setLoginItem] = useState<LoginItemState | null>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  useEffect(() => { void window.snipvia.settings.loginItem().then(result => { if (result.ok) setLoginItem(result.value); else setStatus(result.error); }); }, []);
  async function saveShortcut(key: keyof CapturePreferences, value: string) {
    setSaving(true); setStatus('');
    try {
      const result = await window.snipvia.settings.saveShortcuts({ ...settings, [key]: value });
      if (!result.ok) { setStatus(result.error); return false; }
      onSaved(result.value); setStatus('快捷键已生效'); return true;
    } catch { setStatus('快捷键保存失败，原设置已保留'); return false; }
    finally { setSaving(false); }
  }
  return <section className="settings-panel settings-preferences v2-preferences" aria-labelledby="settings-heading">
    <header className="preferences-header"><div><h1 id="settings-heading">设置</h1><p>轻量截图，随手编辑。更改会自动保存。</p></div></header>
    <section className="preference-section" aria-labelledby="general-settings-title">
      <h2 id="general-settings-title">通用</h2><div className="preference-card">
        <div className="preference-row"><div className="preference-copy"><strong>开机启动</strong><span>{loginItem?.description ?? '登录后在菜单栏运行'}</span></div>
          <label className="config-checkbox"><input type="checkbox" aria-label="开机启动" checked={loginItem?.enabled ?? false} disabled={!loginItem?.supported || saving} onChange={event => {
            setSaving(true); void window.snipvia.settings.setLoginItem(event.target.checked).then(result => { if (result.ok) setLoginItem(result.value); else setStatus(result.error); }).finally(() => setSaving(false));
          }} /><span /></label></div>
        <div className="preference-row"><div className="preference-copy"><strong>菜单栏</strong><span>关闭设置窗口后，仍可通过菜单栏或快捷键截图</span></div><span className="preference-value">持续可用</span></div>
      </div><AppearanceSettings />
    </section>
    <section className="preference-section" aria-labelledby="shortcuts-settings-title">
      <h2 id="shortcuts-settings-title">快捷键</h2><div className="preference-card">
        <div className="preference-row"><div className="preference-copy"><strong>快速截图</strong><span>框选后立即复制到剪贴板，不弹出窗口；沿用旧截图快捷键</span></div><ShortcutRecorder label="设置截图快捷键" value={settings.shortcut} disabled={saving} onCommit={value => saveShortcut('shortcut', value)} onInvalid={setStatus} /></div>
        <div className="preference-row"><div className="preference-copy"><strong>截图与标注</strong><span>框选后标注、复制、保存或贴图；沿用原普通截图快捷键</span></div><ShortcutRecorder label="设置普通截图快捷键" value={settings.editorShortcut} disabled={saving} onCommit={value => saveShortcut('editorShortcut', value)} onInvalid={setStatus} /></div>
        <div className="preference-row"><div className="preference-copy"><strong>收集截图</strong><span>框选后加入右上角收纳区，不影响已有截图</span></div><ShortcutRecorder label="设置收集截图快捷键" value={settings.collectShortcut} disabled={saving} onCommit={value => saveShortcut('collectShortcut', value)} onInvalid={setStatus} /></div>
        <div className="preference-row"><div className="preference-copy"><strong>展开 / 切换收纳区</strong><span>重新打开隐藏的收纳区，保留截图与顺序</span></div><ShortcutRecorder label="设置收纳区快捷键" value={settings.collectionShortcut} disabled={saving} onCommit={value => saveShortcut('collectionShortcut', value)} onInvalid={setStatus} /></div>
        <div className="preference-row"><div className="preference-copy"><strong>清空收纳区</strong><span>先显示确认框，再移除未导出的临时图片</span></div><ShortcutRecorder label="设置清空收纳区快捷键" value={settings.clearCollectionShortcut} disabled={saving} onCommit={value => saveShortcut('clearCollectionShortcut', value)} onInvalid={setStatus} /></div>
      </div><p className="notice">快捷键占用时会提示并保留原配置。外部目标 Ctrl+Shift+1 仅预留，尚未启用；原续聊快捷键不再注册。</p>
    </section>
    <section className="preference-section" aria-labelledby="capture-settings-title"><h2 id="capture-settings-title">截图</h2>
      <div className="preference-card"><div className="preference-row"><div className="preference-copy"><strong>开始截图</strong><span>当前屏幕框选；编辑和导出使用选区的原始像素</span></div><div className="settings-row-actions"><Button onClick={() => { void window.snipvia.capture.start('quick').then(result => { if (!result.ok) setStatus(result.error); }); }}>快速截图</Button><Button onClick={() => { void window.snipvia.capture.start('collect').then(result => { if (!result.ok) setStatus(result.error); }); }}>收集截图</Button><Button onClick={() => { void window.snipvia.collection.toggle(); }}>打开收纳区</Button><Button onClick={() => { void window.snipvia.capture.start('edit').then(result => { if (!result.ok) setStatus(result.error); }); }}>截图与标注</Button></div></div>
      <div className="preference-row"><div className="preference-copy"><strong>图片格式与质量</strong><span>标注和导出保留选区原始分辨率；预览不影响保存质量</span></div><span className="preference-value">原图输出</span></div></div>
      <ScreenPermissionCard />
    </section>
    <ShelfSettings />
    <section className="preference-section" aria-labelledby="storage-settings-title"><h2 id="storage-settings-title">存储</h2>
      <div className="preference-card"><div className="preference-row"><div className="preference-copy"><strong>本地数据目录</strong><span>截图保存在本机；升级保留原有记录和笔记</span></div><Button onClick={() => { void window.snipvia.storage.reveal().then(result => { if (!result.ok) setStatus(result.error); }); }}>打开数据目录</Button></div>
      <LegacyDataPanel /></div>
      <p className="notice">截图与编辑不需要模型、API Key 或网络。旧模型配置与加密凭据原位保留，本版不解密或调用。</p>
    </section>
    <section className="preference-section" aria-labelledby="schedule-settings-title"><h2 id="schedule-settings-title">日程</h2><div className="preference-card"><div className="preference-row"><div className="preference-copy"><strong>Schedule</strong><span>Coming Soon · 已有日程可在「存储 → 查看旧记录」只读查看</span></div><span className="preference-value">暂未开放</span></div></div></section>
    <section className="preference-section" aria-labelledby="about-settings-title"><h2 id="about-settings-title">关于</h2><div className="preference-card">
      <div className="preference-row"><div className="preference-copy"><strong>截然 · Snipvia V2</strong><span>Phase 2 · 极速截图与连续收纳开发版</span></div><span className="preference-value">v{version}</span></div><UpdateSettings />
    </div></section>
    {status && <p className="preference-status" role="status">{status}</p>}
  </section>;
}
