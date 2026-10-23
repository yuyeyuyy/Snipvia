import { useEffect, useState } from 'react';
import type { CapturePreferences } from '../../shared/capture-preferences';
import { AppShell } from './components/AppShell';
import { SettingsPanel } from './settings/SettingsPanel';
import { LoadingState } from './components/ui/LoadingState';
import { ScreenPermissionCard } from './permissions/ScreenPermissionCard';
import { Dialog } from './components/ui/Dialog';
import { Button } from './components/ui/Button';

export function App() {
  const [settings, setSettings] = useState<CapturePreferences | null>(null);
  const [error, setError] = useState('');
  const [permissionOpen, setPermissionOpen] = useState(false);
  useEffect(() => {
    let live = true;
    void window.snipvia.settings.get().then(result => { if (!live) return; if (result.ok) setSettings(result.value); else setError(result.error); });
    const stop = window.snipvia.settings.onChanged(setSettings);
    const stopErrors = window.snipvia.capture.onError(message => {
      setError(message);
      void window.snipvia.permissions.screen().then(result => { if (live && result.ok && result.value.supported && result.value.status !== 'granted') setPermissionOpen(true); });
    });
    return () => { live = false; stop(); stopErrors(); };
  }, []);
  return <AppShell>
    {error && <p className="error" role="alert">{error}<Button variant="quiet" aria-label="关闭错误提示" onClick={() => setError('')}>关闭</Button></p>}
    {settings ? <SettingsPanel settings={settings} onSaved={setSettings} /> : <LoadingState>正在读取设置…</LoadingState>}
    {permissionOpen && <Dialog label="录屏权限设置" onClose={() => setPermissionOpen(false)}><ScreenPermissionCard /><Button onClick={() => setPermissionOpen(false)}>关闭</Button></Dialog>}
  </AppShell>;
}
