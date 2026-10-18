import { useEffect, useState } from 'react';
import type { ThemeMode } from '../../../shared/appearance';
import { Select } from '../components/ui/Button';

export function AppearanceSettings() {
  const [theme, setTheme] = useState(() => window.snipvia.appearance.current());
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    const unsubscribe = window.snipvia.appearance.onChanged(setTheme);
    setTheme(window.snipvia.appearance.current());
    return unsubscribe;
  }, []);
  async function change(mode: ThemeMode) {
    setSaving(true); setError('');
    try {
      const result = await window.snipvia.appearance.set(mode);
      if (result.ok) setTheme(result.value);
      else setError(result.error);
    } catch { setError('外观设置保存失败，请重试。'); }
    finally { setSaving(false); }
  }
  async function changeFont(size: number) {
    setSaving(true); setError('');
    try {
      const result = await window.snipvia.appearance.setChatFontSize(size);
      if (result.ok) setTheme(result.value); else setError(result.error);
    } catch { setError('字号保存失败，请重试。'); }
    finally { setSaving(false); }
  }
  return <section className="preference-section" aria-labelledby="appearance-settings-title">
    <h2 tabIndex={-1} id="appearance-settings-title">外观</h2>
    <div className="preference-card"><div className="preference-row">
      <div className="preference-copy"><strong>主题</strong><span>{theme.mode === 'system' ? `跟随系统 · 当前为${theme.resolved === 'dark' ? '深色' : '浅色'}` : '所有窗口同步使用此主题'}</span></div>
      <Select className="preference-select" aria-label="外观主题" value={theme.mode} disabled={saving} onChange={(event) => void change(event.target.value as ThemeMode)}>
        <option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option>
      </Select>
    </div><div className="preference-row">
      <div className="preference-copy"><strong>AI 对话字号</strong><span>调整对话正文、代码和输入文字，不影响笔记正文与界面控件</span></div>
      <Select className="preference-select" aria-label="AI 对话字号" value={theme.chatFontSize ?? 15} disabled={saving} onChange={event => void changeFont(Number(event.target.value))}>
        {Array.from({ length: 13 }, (_, index) => index + 12).map(size => <option key={size} value={size}>{size} px{size === 15 ? '（默认）' : ''}</option>)}
      </Select>
    </div></div>
    {error && <p className="error-text" role="alert">{error}</p>}
  </section>;
}
