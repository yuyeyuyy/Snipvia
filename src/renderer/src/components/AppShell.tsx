import { useState, type ReactNode } from 'react';
import { Button } from './ui/Button';
import { FeedbackDialog } from './FeedbackDialog';
import { Icon } from './Icon';

export function AppShell({ children }: { children: ReactNode }) {
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  return <div className="app-shell settings-shell">
    <header className={'app-titlebar' + (window.snipvia.platform === 'darwin' ? ' mac-titlebar' : '')} aria-label="窗口标题栏">
      <div className="app-titlebar-content"><div className="titlebar-brand"><Icon name="brand" size={20} /><span>截然</span><h1 className="settings-titlebar-label">设置</h1></div>
        <div className="titlebar-actions"><Button className="titlebar-feedback" variant="quiet" onClick={() => setFeedbackOpen(true)}>反馈</Button></div>
      </div>
    </header>
    <main>{children}</main>
    {feedbackOpen && <FeedbackDialog onClose={() => setFeedbackOpen(false)} />}
  </div>;
}
