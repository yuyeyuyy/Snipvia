import { useEffect, useState } from 'react';
import type { ShelfPreferences } from '../../../shared/shelf-preferences';
import { Button } from '../components/ui/Button';

function NumberPreference({ label, unit = 'px', value, min, max, disabled, save, onError }: { label: string; unit?: string; value: number; min: number; max: number; disabled: boolean; save(value: number): void; onError(value: string): void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return <div className="shelf-setting-field"><input className="shelf-setting-number" type="number" aria-label={label} min={min} max={max} step={1} value={draft} disabled={disabled}
    onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}
    onBlur={() => {
      const parsed = Number(draft);
      if (!draft.trim() || !Number.isInteger(parsed) || parsed < min || parsed > max) { setDraft(String(value)); onError(label + '应为 ' + min + '–' + max + ' 的整数'); return; }
      if (parsed !== value) save(parsed);
    }} /><span aria-hidden="true">{unit}</span></div>;
}
export function ShelfSettings() {
  const [value, setValue] = useState<ShelfPreferences | null>(null), [saving, setSaving] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    void window.snipvia.collection.current().then(r => { if (live) { if (r.ok) setValue(r.value.preferences); else setError(r.error); } });
    const off = window.snipvia.collection.onChanged(state => { if (live) setValue(state.preferences); });
    return () => { live = false; off(); };
  }, []);
  async function save(patch: Partial<ShelfPreferences>) {
    if (!value || saving) return;
    setSaving(true); setError('');
    try { const result = await window.snipvia.collection.configure({ ...value, ...patch }); if (!result.ok) setError(result.error); else setValue(result.value.preferences); }
    catch { setError('保存失败，原设置已保留'); }
    finally { setSaving(false); }
  }
  return <section className="preference-section" aria-labelledby="shelf-settings-title"><h3 id="shelf-settings-title">外观与尺寸</h3>
      {value && <><div className="preference-card">
        <div className="preference-row"><div className="preference-copy"><strong>收纳区宽度</strong><span>图片充分使用此宽度；自动适配当前屏幕工作区</span></div><NumberPreference label="收纳区宽度" value={value.width} min={280} max={960} disabled={saving} save={width => { void save({ width }); }} onError={setError} /></div>
        <div className="preference-row"><div className="preference-copy"><strong>展开高度</strong><span>默认占屏幕工作区的 3/4；内容超出后滚动浏览</span></div><select aria-label="展开高度模式" value={value.heightMode} disabled={saving} onChange={event => { void save({ heightMode: event.target.value as ShelfPreferences['heightMode'] }); }}><option value="screen">屏幕高度的 3/4</option><option value="fixed">自定义高度</option></select></div>
        {value.heightMode === 'fixed' && <div className="preference-row"><div className="preference-copy"><strong>自定义展开高度</strong><span>按此高度展开，不因图片少而缩短；不超出当前屏幕工作区</span></div><NumberPreference label="展开高度" value={value.height} min={300} max={1600} disabled={saving} save={height => { void save({ height }); }} onError={setError} /></div>}
        </div><h3 className="preference-subheading">自动收起</h3><div className="preference-card"><div className="preference-row"><div className="preference-copy"><strong>闲置时贴边收起</strong><span>鼠标离开后缩入右边缘，悬停小手柄即可拉出；复制、导出和预览期间保持展开</span></div><label className="config-checkbox"><input type="checkbox" aria-label="闲置时贴边收起" checked={value.autoHide} disabled={saving} onChange={event => { void save({ autoHide: event.target.checked }); }} /><span /></label></div>
        <div className="preference-row"><div className="preference-copy"><strong>收起等待时间</strong><span>鼠标离开后等待的毫秒数</span></div><NumberPreference label="收起等待时间" unit="ms" value={value.hideDelayMs} min={600} max={10000} disabled={saving} save={hideDelayMs => { void save({ hideDelayMs }); }} onError={setError} /></div>
        </div><h3 className="preference-subheading">合并输出</h3><div className="preference-card"><div className="preference-row"><div className="preference-copy"><strong>合并图片宽度</strong><span>只影响合并复制，不改变原图</span></div><select aria-label="合并图片宽度" value={value.mergeWidth} disabled={saving} onChange={event => { void save({ mergeWidth: Number(event.target.value) as ShelfPreferences['mergeWidth'] }); }}>{[800, 1600, 2048, 4096].map(width => <option key={width} value={width}>{width} px</option>)}</select></div>
        <div className="preference-row"><div className="preference-copy"><strong>合并图片间距</strong><span>合并长图中各图片之间的像素间距</span></div><NumberPreference label="合并图片间距" value={value.gap} min={0} max={64} disabled={saving} save={gap => { void save({ gap }); }} onError={setError} /></div>
      </div></>}
      <h3 className="preference-subheading">管理</h3><div className="preference-card"><div className="preference-row"><div className="preference-copy"><strong>清空当前收纳区</strong><span>需要确认；不删除已保存图片或旧记录</span></div><Button disabled={saving} onClick={() => { void window.snipvia.collection.clear().then(result => { if (!result.ok) setError(result.error); }); }}>清空收纳区…</Button></div>
    </div>{error && <p className="preference-status" role="status">{error}</p>}
  </section>;
}
