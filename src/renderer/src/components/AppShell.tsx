import { useState, type ReactNode } from 'react';
import { Button } from './ui/Button';
import { FeedbackDialog } from './FeedbackDialog';
import { Icon } from './Icon';

const sections = [
  ['general', '通用'], ['shortcuts', '快捷键'], ['capture', '截图'], ['storage', '存储'], ['about', '关于']
];
export function AppShell({ children }: { children: ReactNode }) {
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  return <div className="app-shell settings-shell">
    <header className={'app-titlebar' + (window.snipvia.platform === 'darwin' ? ' mac-titlebar' : '')} aria-label="窗口标题栏">
      <div className="app-titlebar-content"><div className="titlebar-brand"><Icon name="brand" size={20} /><span>截然</span><span className="settings-titlebar-label">设置</span></div>
        <div className="titlebar-actions"><Button className="titlebar-feedback" variant="quiet" onClick={() => setFeedbackOpen(true)}>反馈</Button></div>
      </div>
    </header>
    <main><nav className="settings-navigation" aria-label="设置分类">{sections.map(([id, title]) => <Button variant="quiet" key={id} onClick={() => document.getElementById(id + '-settings-title')?.scrollIntoView({ block: 'start' })}>{title}</Button>)}</nav>{children}</main>
    {feedbackOpen && <FeedbackDialog onClose={() => setFeedbackOpen(false)} />}
  </div>;
}
