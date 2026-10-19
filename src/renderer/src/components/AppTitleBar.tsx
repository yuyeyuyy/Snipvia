import { Icon } from './Icon';
import { Button, IconButton } from './ui/Button';

export function AppTitleBar({ settingsActive, sidebarCollapsed, onSettings, onToggleSidebar, onSearch, onFeedback }: {
  settingsActive: boolean;
  sidebarCollapsed: boolean;
  onSettings: () => void;
  onToggleSidebar: () => void;
  onSearch: () => void;
  onFeedback: () => void;
}) {
  const toggleLabel = sidebarCollapsed ? '展开菜单栏' : '收起菜单栏';
  return <header className={`app-titlebar${window.snipvia.platform === 'darwin' ? ' mac-titlebar' : ''}`} aria-label="窗口标题栏">
    <div className="app-titlebar-content">
      <div className="titlebar-brand"><span className="brand-icon"><Icon name="brand" size={20} /></span><span className="brand-name">截然</span></div>
      <IconButton icon="sidebar" label={toggleLabel} className="titlebar-button sidebar-toggle" aria-controls="app-sidebar" aria-expanded={!sidebarCollapsed} onClick={onToggleSidebar} />
      <div className="titlebar-actions" role="toolbar" aria-label="全局操作">
        <Button variant="quiet" className="titlebar-button titlebar-feedback" onClick={onFeedback}>反馈</Button>
        <IconButton icon="search" label="快捷导航" title={window.snipvia.platform === 'darwin' ? '快捷导航（⌘K）' : '快捷导航（Ctrl+K）'} className="titlebar-button" onClick={onSearch} />
        <IconButton icon="settings" label="模型与设置" title="设置" className={`titlebar-button${settingsActive ? ' active' : ''}`} aria-current={settingsActive ? 'page' : undefined} onClick={onSettings} />
      </div>
    </div>
  </header>;
}
