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
  } else if (location.hash === '#shelf') {
    document.documentElement.classList.add('shelf-window');
    await import('./design/base.css');
    await import('./design/controls.css');
    Component = (await import('./collection/ScreenshotShelf')).ScreenshotShelf;
  } else if (location.hash === '#pin') {
    document.documentElement.classList.add('floating-window');
    const [, module] = await Promise.all([
      import('./capture/pinned-window.css'),
      import('./capture/PinnedCapture')
    ]);
    Component = module.PinnedCapture;
  } else {
    await import('./design/base.css');
    await import('./design/controls.css');
    await import('./design/app-shell.css');
    Component = (await import('./App')).App;
  }
  createRoot(document.getElementById('root')!).render(<React.StrictMode><Component /></React.StrictMode>);
}

void bootstrap();
