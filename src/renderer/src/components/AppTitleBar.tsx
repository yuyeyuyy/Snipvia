import { Icon } from './Icon';
import { IconButton } from './ui/Button';

export function AppTitleBar({ settingsActive, sidebarCollapsed, onSettings, onToggleSidebar, onSearch }: {
  settingsActive: boolean;
  sidebarCollapsed: boolean;
  onSettings: () => void;
  onToggleSidebar: () => void;
  onSearch: () => void;
}) {
  const toggleLabel = sidebarCollapsed ? '展开菜单栏' : '收起菜单栏';
  return <header className={`app-titlebar${window.snipvia.platform === 'darwin' ? ' mac-titlebar' : ''}`} aria-label="窗口标题栏">
    <div className="app-titlebar-content">
      <div className="titlebar-brand"><span className="brand-icon"><Icon name="brand" size={20} /></span><span className="brand-name">截然</span></div>
      <IconButton icon="sidebar" label={toggleLabel} className="titlebar-button sidebar-toggle" aria-controls="app-sidebar" aria-expanded={!sidebarCollapsed} onClick={onToggleSidebar} />
      <div className="titlebar-actions" role="toolbar" aria-label="全局操作">
        <IconButton icon="search" label="快捷导航" title={window.snipvia.platform === 'darwin' ? '快捷导航（⌘K）' : '快捷导航（Ctrl+K）'} className="titlebar-button" onClick={onSearch} />
        <IconButton icon="settings" label="模型与设置" title="设置" className={`titlebar-button${settingsActive ? ' active' : ''}`} aria-current={settingsActive ? 'page' : undefined} onClick={onSettings} />
      </div>
    </div>
  </header>;
}
