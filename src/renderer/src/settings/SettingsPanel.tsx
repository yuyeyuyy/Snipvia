import { useEffect, useState, type ReactNode, type KeyboardEvent } from 'react';
import type { LoginItemState } from '../../../shared/contracts';
import type { CapturePreferences } from '../../../shared/capture-preferences';
import { version } from '../../../../package.json';
import { Button } from '../components/ui/Button';
import { Icon, type IconName } from '../components/Icon';
import { AppearanceSettings } from './AppearanceSettings';
import { UpdateSettings } from './UpdateSettings';
import { ShortcutRecorder } from './ShortcutRecorder';
import { LegacyDataPanel } from './LegacyDataPanel';
import { ScreenPermissionCard } from '../permissions/ScreenPermissionCard';
import { ShelfSettings } from './ShelfSettings';
import { QuickTargetSettings } from './QuickTargetSettings';
import './settings.css';
import './v2-settings.css';

const pages = [
  { id: 'general', title: '通用', icon: 'settings', group: '偏好设置', description: '启动方式、日常使用与外观偏好。' },
  { id: 'shortcuts', title: '快捷键', icon: 'keyboard', group: '偏好设置', description: '用熟悉的组合键，完成截图与收纳。' },
  { id: 'capture', title: '截图', icon: 'capture', group: '截图工作流', description: '截图操作、图片质量与系统录屏权限。' },
  { id: 'quick-target', title: '快速切换', icon: 'switch', group: '截图工作流', description: '复制后，快速前往常用的应用和网页。' },
  { id: 'shelf', title: '收纳区', icon: 'collection', group: '截图工作流', description: '让截图按你习惯的大小展示、收起与输出。' },
  { id: 'storage', title: '存储', icon: 'folder', group: '应用', description: '管理本地文件，安全查看与导出旧版记录。' },
  { id: 'about', title: '关于', icon: 'info', group: '应用', description: '版本信息与软件更新。' }
] as const satisfies readonly { id: string; title: string; icon: IconName; group: string; description: string }[];
type PageId = typeof pages[number]['id'];
const groups = [...new Set(pages.map(page => page.group))];

/** Keep panels mounted so changing categories does not discard drafts or async state. */
function SettingsPage({ id, active, children }: { id: PageId; active: PageId; children: ReactNode }) {
  return <div id={'settings-page-' + id} className="settings-page" hidden={id !== active}>{children}</div>;
}

export function SettingsPanel({ settings, onSaved }: { settings: CapturePreferences; onSaved(value: CapturePreferences): void }) {
  const [page, setPage] = useState<PageId>('general');
  const [loginItem, setLoginItem] = useState<LoginItemState | null>(null);
  const [saving, setSaving] = useState(false);
  const [statuses, setStatuses] = useState<Partial<Record<PageId, string>>>({});
  const status = statuses[page] ?? '';
  function setStatus(message: string) { setStatuses(values => ({ ...values, [page]: message })); }
  const current = pages.find(item => item.id === page)!;
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
  function navigateWithKeyboard(event: KeyboardEvent<HTMLElement>) {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next].focus(); buttons[next].click();
  }
  return <section className="settings-panel settings-preferences v2-preferences" aria-label="设置中心">
    <aside className="settings-sidebar">
      <nav className="settings-navigation" aria-label="设置分类" onKeyDown={navigateWithKeyboard}>
        {groups.map(group => <div className="settings-nav-group" key={group}>
          <p className="settings-nav-group-label">{group}</p>
          {pages.filter(item => item.group === group).map(item => <Button variant="quiet" key={item.id} aria-current={page === item.id ? 'page' : undefined} aria-controls={'settings-page-' + item.id} onClick={() => setPage(item.id)}>
            <Icon name={item.icon} size={18} /><span>{item.title}</span>
          </Button>)}
        </div>)}
      </nav>
      <p className="settings-save-hint"><Icon name="check" size={13} />更改会自动保存</p>
    </aside>
    <div className="settings-content">
      <header className="preferences-header"><h2 id="settings-page-heading">{current.title}</h2><p>{current.description}</p></header>
      <SettingsPage id="general" active={page}>
        <section className="preference-section" aria-labelledby="general-settings-title">
          <h3 id="general-settings-title">启动与运行</h3><div className="preference-card">
            <div className="preference-row"><div className="preference-copy"><strong>开机启动</strong><span>{loginItem?.description ?? '登录后在菜单栏运行'}</span></div>
              <label className="config-checkbox"><input type="checkbox" aria-label="开机启动" checked={loginItem?.enabled ?? false} disabled={!loginItem?.supported || saving} onChange={event => {
                setSaving(true); void window.snipvia.settings.setLoginItem(event.target.checked).then(result => { if (result.ok) setLoginItem(result.value); else setStatus(result.error); }).finally(() => setSaving(false));
              }} /><span /></label></div>
            <div className="preference-row"><div className="preference-copy"><strong>菜单栏</strong><span>关闭设置窗口后，仍可通过菜单栏或快捷键截图</span></div><span className="preference-value">持续可用</span></div>
          </div>
        </section>
        <AppearanceSettings />
      </SettingsPage>
      <SettingsPage id="shortcuts" active={page}>
        <section className="preference-section" aria-labelledby="shortcuts-settings-title">
          <h3 id="shortcuts-settings-title">截图操作</h3><div className="preference-card">
            <div className="preference-row"><div className="preference-copy"><strong>快速截图</strong><span>框选后立即复制到剪贴板</span></div><ShortcutRecorder label="设置截图快捷键" value={settings.shortcut} disabled={saving} onCommit={value => saveShortcut('shortcut', value)} onInvalid={setStatus} /></div>
            <div className="preference-row"><div className="preference-copy"><strong>截图与标注</strong><span>框选后标注、复制、保存或贴图</span></div><ShortcutRecorder label="设置普通截图快捷键" value={settings.editorShortcut} disabled={saving} onCommit={value => saveShortcut('editorShortcut', value)} onInvalid={setStatus} /></div>
            <div className="preference-row"><div className="preference-copy"><strong>收集截图</strong><span>框选后加入右上角收纳区</span></div><ShortcutRecorder label="设置收集截图快捷键" value={settings.collectShortcut} disabled={saving} onCommit={value => saveShortcut('collectShortcut', value)} onInvalid={setStatus} /></div>
          </div>
          <h3 className="preference-subheading">收纳操作</h3><div className="preference-card">
            <div className="preference-row"><div className="preference-copy"><strong>展开 / 切换收纳区</strong><span>重新打开隐藏的收纳区，保留截图与顺序</span></div><ShortcutRecorder label="设置收纳区快捷键" value={settings.collectionShortcut} disabled={saving} onCommit={value => saveShortcut('collectionShortcut', value)} onInvalid={setStatus} /></div>
            <div className="preference-row"><div className="preference-copy"><strong>清空收纳区</strong><span>确认后移除未导出的临时图片</span></div><ShortcutRecorder label="设置清空收纳区快捷键" value={settings.clearCollectionShortcut} disabled={saving} onCommit={value => saveShortcut('clearCollectionShortcut', value)} onInvalid={setStatus} /></div>
          </div><p className="notice">点击右侧组合键进行修改；按 Esc 取消。快捷键被占用时会保留原配置。</p>
        </section>
      </SettingsPage>
      <SettingsPage id="capture" active={page}>
        <section className="preference-section" aria-labelledby="capture-settings-title"><h3 id="capture-settings-title">截图操作</h3>
          <div className="preference-card"><div className="preference-row"><div className="preference-copy"><strong>开始截图</strong><span>在当前屏幕框选想要保留的区域</span></div><div className="settings-row-actions"><Button onClick={() => { void window.snipvia.capture.start('quick').then(result => { if (!result.ok) setStatus(result.error); }); }}>快速截图</Button><Button onClick={() => { void window.snipvia.capture.start('collect').then(result => { if (!result.ok) setStatus(result.error); }); }}>收集截图</Button><Button onClick={() => { void window.snipvia.collection.toggle(); }}>打开收纳区</Button><Button onClick={() => { void window.snipvia.capture.start('edit').then(result => { if (!result.ok) setStatus(result.error); }); }}>截图与标注</Button></div></div>
          <div className="preference-row"><div className="preference-copy"><strong>图片格式与质量</strong><span>标注和导出保留选区原始分辨率，预览不影响保存质量</span></div><span className="preference-value">原图输出</span></div></div>
          <ScreenPermissionCard />
        </section>
      </SettingsPage>
      <SettingsPage id="quick-target" active={page}><QuickTargetSettings /></SettingsPage>
      <SettingsPage id="shelf" active={page}><ShelfSettings /></SettingsPage>
      <SettingsPage id="storage" active={page}>
        <section className="preference-section" aria-labelledby="storage-settings-title"><h3 id="storage-settings-title">本地文件</h3>
          <div className="preference-card"><div className="preference-row"><div className="preference-copy"><strong>本地数据目录</strong><span>打开截然存放本地数据的文件夹</span></div><Button onClick={() => { void window.snipvia.storage.reveal().then(result => { if (!result.ok) setStatus(result.error); }); }}>打开数据目录</Button></div></div>
          <h3 className="preference-subheading">旧版兼容</h3><div className="preference-card"><LegacyDataPanel /></div>
          <p className="notice">截图与编辑不需要模型、API Key 或网络。旧模型配置与加密凭据原位保留，本版不解密或调用。</p>
        </section>
      </SettingsPage>
      <SettingsPage id="about" active={page}>
        <section className="preference-section" aria-labelledby="about-settings-title"><h3 id="about-settings-title">应用信息</h3><div className="preference-card">
          <div className="preference-row"><div className="settings-about-brand"><Icon name="brand" size={32} /><div className="preference-copy"><strong>截然 · Snipvia</strong><span>轻量截图，随手编辑，连续收纳。</span></div></div><span className="preference-value">v{version}</span></div><UpdateSettings />
        </div></section>
        <section className="preference-section" aria-labelledby="schedule-settings-title"><h3 id="schedule-settings-title">后续功能</h3><div className="preference-card"><div className="preference-row"><div className="preference-copy"><strong>日程</strong><span>Coming Soon · 已有日程可在「存储 → 查看旧记录」只读查看</span></div><span className="preference-value">暂未开放</span></div></div></section>
      </SettingsPage>
      {status && <p className="preference-status" role="status">{status}</p>}
    </div>
  </section>;
}
