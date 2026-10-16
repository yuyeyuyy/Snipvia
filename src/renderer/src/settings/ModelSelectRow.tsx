import { useEffect, useRef, useState } from 'react';
import { modelScopeSchema, type ModelCatalogResult, type ModelScope } from '../../../shared/models';
import { providerFor } from '../../../shared/providers';
import { Icon } from '../components/Icon';
import { Button, Input, Select } from '../components/ui/Button';

export function ModelSelectRow({ scope, apiKey, selectedModel, onSelect }: {
  scope: ModelScope; apiKey?: string; selectedModel: string; onSelect(model: string): void;
}) {
  const [listing, setListing] = useState<{ identity: string; catalog: ModelCatalogResult } | null>(null);
  const [status, setStatus] = useState<{ identity: string; message: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [manual, setManual] = useState(false);
  // Identity includes the unsaved key; never render or persist it. Old responses cannot cross scopes.
  const identity = JSON.stringify([scope.provider, scope.endpoint, apiKey]);
  const current = useRef(identity); current.current = identity;
  const sequence = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const valid = modelScopeSchema.safeParse(scope).success;
  const catalog = listing?.identity === identity ? listing.catalog : null;
  const message = status?.identity === identity ? status.message : '';
  const models = (catalog?.models ?? []).filter(model => model.capabilities.vision === 'supported');
  const preferred = providerFor(scope.provider).models.map(model => model.id);
  models.sort((a, b) => {
    const rank = (id: string) => preferred.includes(id) ? preferred.indexOf(id) : preferred.length;
    return rank(a.id) - rank(b.id) || a.name.localeCompare(b.name);
  });
  const selectedKnown = models.some(model => model.id === selectedModel);
  const showManual = manual || (!selectedKnown && (scope.provider === 'custom' || (!!selectedModel && (!!catalog || !preferred.includes(selectedModel)))));

  async function load(refresh: boolean) {
    clearTimeout(timer.current);
    if (!valid) return;
    const seq = ++sequence.current;
    const target = identity;
    setLoading(true); setStatus(null);
    try {
      const result = await window.snipvia.models.list({ ...scope, apiKey, refresh });
      if (seq !== sequence.current || current.current !== target) return;
      if (result.ok) {
        setListing({ identity: target, catalog: result.value });
        setStatus({ identity: target, message: result.value.warning ?? (refresh ? '模型列表已更新' : '') });
      } else setStatus({ identity: target, message: result.error });
    } catch {
      if (seq === sequence.current && current.current === target) setStatus({ identity: target, message: '获取模型列表失败，请重试。' });
    } finally { if (seq === sequence.current && current.current === target) setLoading(false); }
  }

  useEffect(() => { setManual(false); }, [scope.provider, scope.endpoint]);

  useEffect(() => {
    setLoading(valid);
    timer.current = setTimeout(() => void load(false), 500);
    return () => { clearTimeout(timer.current); sequence.current++; };
    // Query only when credentials/scope change, not when selecting a model.
  }, [identity, valid]);

  return <>
    <div className="config-row model-select-row">
      <label htmlFor="provider-model"><strong>模型</strong><span>仅列出已确认支持图片理解的模型</span></label>
      <div className="model-select-field">
        <div className="model-select-controls">
          <Button type="button" className={`model-refresh ${loading ? 'is-loading' : ''}`} aria-label="刷新模型列表" title="刷新模型列表" disabled={loading || !valid} onClick={() => void load(true)}><Icon name="refresh" size={17} /></Button>
          <Select id="provider-model" aria-label="选择模型" value={showManual ? '__custom__' : selectedKnown ? selectedModel : ''} onChange={event => {
            const custom = event.target.value === '__custom__';
            setManual(custom); onSelect(custom ? '' : event.target.value);
          }}>
            <option value="" disabled>{loading ? '正在获取模型…' : models.length ? '选择图片理解模型' : '暂无已确认的图片模型'}</option>
            {models.map(model => <option key={model.id} value={model.id}>{model.id}</option>)}
            <option value="__custom__">手动填写模型 ID…</option>
          </Select>
        </div>
        <span className="model-select-status" role="status" aria-live="polite">{loading ? '正在获取模型列表…' : message}</span>
      </div>
    </div>
    {showManual && <div className="config-row">
      <label htmlFor="provider-model-name"><strong>模型名称</strong><span>填写模型或接入点 ID；请确认该接口支持图片输入</span></label>
      <Input id="provider-model-name" aria-label="模型名称" required value={selectedModel} onChange={event => onSelect(event.target.value)} placeholder="输入模型 ID 或 ep- 接入点" />
    </div>}
  </>;
}
