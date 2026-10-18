import { useEffect, useState } from 'react';
import type { PublicPredictionSettings } from '../../../shared/prediction-settings';
import { jevModels } from '../../../shared/prediction-settings';
import { Button, Input, Select } from '../components/ui/Button';
import { Dialog } from '../components/ui/Dialog';

export function PredictionSettings() {
  const [settings, setSettings] = useState<PublicPredictionSettings | null>(null);
  const [model, setModel] = useState<(typeof jevModels)[number]>('jev-1.14.0');
  const [key, setKey] = useState('');
  const [clearKey, setClearKey] = useState(false);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  useEffect(() => {
    let active = true;
    void window.snipvia.prediction.get().then(result => {
      if (!active) return;
      if (result.ok) setSettings(result.value); else setStatus(result.error);
    });
    return () => { active = false; };
  }, []);
  async function save(enabled: boolean, configure = false) {
    if (!settings) return;
    setSaving(true); setStatus('');
    try {
      const result = await window.snipvia.prediction.save({ enabled, model: configure ? model : settings.model,
        ...(configure && (clearKey || key) ? { apiKey: clearKey ? '' : key } : {}) });
      if (!result.ok) { setStatus(result.error); return; }
      setSettings(result.value); setKey(''); setClearKey(false); setOpen(false);
      setStatus(result.value.enabled && result.value.hasApiKey ? '已启用 Jev 图片预测' : '已使用对话模型预测');
    } catch { setStatus('Jev 配置保存失败，请重试'); } finally { setSaving(false); }
  }
  return <div className="preference-subsection" aria-labelledby="jev-settings-title">
    <h3 id="jev-settings-title">预测模型</h3>
    <div className="preference-card">
      <div className="preference-row">
        <div className="preference-copy"><strong>Jev 图片预测（可选）</strong><span>{settings?.error ? 'Jev 配置不可用；请先恢复配置文件，其他本地功能仍可使用。' : !settings ? '正在读取预测配置…' : settings.enabled && settings.hasApiKey
          ? `使用 ${settings.model} 判断分支；命中后由对话模型继续执行。`
          : '当前使用对话模型预测；未配置 Jev Key 时自动使用对话模型。'}</span></div>
        <label className="config-checkbox"><input type="checkbox" aria-label="启用 Jev 图片预测" checked={settings?.enabled ?? false}
          disabled={saving || !settings?.hasApiKey || !!settings.error} onChange={event => void save(event.target.checked)} /><span /></label>
      </div>
      <div className="preference-row">
        <div className="preference-copy"><strong>Jev 配置</strong><span>直接向 TypeSafe 发送选中截图与分支条件；图片能力为实验性功能，可能产生 API 费用。</span></div>
        <Button className="preference-action" disabled={!settings || !!settings.error || saving} onClick={() => {
          setModel(settings!.model); setKey(''); setClearKey(false); setStatus(''); setOpen(true);
        }}>配置 Jev…</Button>
      </div>
    </div>
    {settings?.error && <p className="preference-status" role="alert">{settings.error}</p>}
    {status && <p className="preference-status" role="status">{status}</p>}
    {open && settings && <Dialog className="settings-modal provider-config-modal" label="配置 Jev 图片预测" onClose={() => { if (!saving) { setOpen(false); setKey(''); } }}>
      <div className="modal-header"><div><strong>配置 Jev 图片预测</strong><small>只用于判断分支，后续执行沿用对话模型</small></div><Button variant="quiet" disabled={saving} aria-label="关闭 Jev 配置" onClick={() => { setOpen(false); setKey(''); }}>关闭</Button></div>
      <form onSubmit={event => { event.preventDefault(); void save(!clearKey, true); }}>
        <div className="provider-config-scroll"><fieldset disabled={saving} className="provider-config-fields">
          <div className="config-row"><div className="preference-copy"><strong>模型</strong><span>使用原生图片接口，不经过 Snipvia 服务器。</span></div>
            <Select aria-label="Jev 模型" value={model} disabled={saving} onChange={event => setModel(event.target.value as typeof model)}>
              {jevModels.map(id => <option key={id} value={id}>{id}</option>)}
            </Select>
          </div>
          <div className="config-row"><div className="preference-copy"><strong>Jev API Key</strong><span>{settings.hasApiKey ? '已保存密钥；留空保持不变。' : '在 TypeSafe 官方控制台创建自己的 Key。'}</span></div>
            <Input aria-label="Jev API Key" type="password" autoComplete="off" value={key} disabled={saving || clearKey} onChange={event => setKey(event.target.value)} placeholder="输入 Jev API Key" />
          </div>
          {settings.hasApiKey && <div className="config-row compact"><div className="preference-copy"><strong>删除 Jev Key</strong><span>删除后使用对话模型预测，不影响对话模型 Key。</span></div>
            <label className="config-checkbox"><input type="checkbox" aria-label="删除 Jev Key" checked={clearKey} disabled={saving} onChange={event => setClearKey(event.target.checked)} /><span /></label></div>}
          <p className="notice">Key 使用系统凭据保护独立加密保存。只有明确开始预测才发送裁剪图；Jev 只决定分支，日程与笔记仍按原流程确认。请求失败会提示并等待你重试，不自动调用另一家模型。</p>
          <Button type="button" variant="quiet" onClick={() => { void window.snipvia.prediction.openConsole().then(result => { if (!result.ok) setStatus(result.error); }); }}>前往 TypeSafe 官网获取 Key ↗</Button>
          {status && <p className="preference-status" role="alert">{status}</p>}
        </fieldset></div>
        <div className="modal-footer"><Button type="button" disabled={saving} onClick={() => { setOpen(false); setKey(''); }}>取消</Button>
          <Button type="submit" variant="primary" className="primary" disabled={saving || (!clearKey && !key && !settings.hasApiKey)}>{clearKey ? '删除并使用对话模型' : '保存并启用'}</Button></div>
      </form>
    </Dialog>}
  </div>;
}
