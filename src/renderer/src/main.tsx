import React, { type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';

async function bootstrap() {
  let Component: ComponentType;
  if (location.hash === '#capture') {
    const [, module] = await Promise.all([
      import('./capture/capture-window.css'),
      import('./capture/CaptureOverlay')
    ]);
    Component = module.CaptureOverlay;
  } else if (location.hash === '#pin') {
    document.documentElement.classList.add('floating-window');
    const [, module] = await Promise.all([
      import('./capture/pinned-window.css'),
      import('./capture/PinnedCapture')
    ]);
    Component = module.PinnedCapture;
  } else {
    // The refined layout must be applied after the base styles, including in Vite development.
    await import('./style.css');
    await import('./refined.css');
    await import('./design/controls.css');
    await import('./design/app-shell.css');
    if (location.hash === '#agent-permission') {
      await import('./agent/file-approval.css');
      Component = (await import('./agent/AgentPermissionPanel')).AgentPermissionPanel;
    } else if (location.hash === '#quick-chat') {
      document.documentElement.classList.add('floating-window');
      Component = (await import('./chat/QuickChat')).QuickChat;
    } else {
      Component = (await import('./App')).App;
    }
  }
  createRoot(document.getElementById('root')!).render(<React.StrictMode><Component /></React.StrictMode>);
}

void bootstrap();
