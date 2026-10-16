import { Icon } from './Icon';
import { IconButton } from './ui/Button';

export function AppTitleBar({ signedIn, accountActive, settingsActive, sidebarCollapsed, onAccount, onSettings, onToggleSidebar, onSearch }: {
  signedIn: boolean;
  accountActive: boolean;
  settingsActive: boolean;
  sidebarCollapsed: boolean;
  onAccount: () => void;
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
        <button className={`titlebar-button${signedIn ? '' : ' titlebar-login'}${accountActive ? ' active' : ''}`} aria-label="账号与登录" title={signedIn ? '账号' : '登录 / 注册'} aria-current={accountActive ? 'page' : undefined} onClick={onAccount}>
          {signedIn ? <Icon name="user" size={19} /> : <span>登录</span>}
        </button>
        <IconButton icon="settings" label="模型与设置" title="设置" className={`titlebar-button${settingsActive ? ' active' : ''}`} aria-current={settingsActive ? 'page' : undefined} onClick={onSettings} />
      </div>
    </div>
  </header>;
}
