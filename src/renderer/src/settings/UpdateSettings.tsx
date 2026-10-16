import { useEffect, useState } from 'react';
import type { UpdateState } from '../../../shared/updates';
import { Button } from '../components/ui/Button';
import { Icon } from '../components/Icon';
import { MarkdownMessage } from '../chat/MarkdownMessage';

export function UpdateSettings() {
  const [state, setState] = useState<UpdateState | null>(null);
  const [requestError, setRequestError] = useState('');

  useEffect(() => {
    let active = true;
    let changed = false;
    const stop = window.snipvia.updates.onChanged(value => { changed = true; if (active) setState(value); });
    void window.snipvia.updates.current().then(result => {
      if (!active || changed) return;
      if (result.ok) setState(result.value);
      else setRequestError(result.error);
    });
    return () => { active = false; stop(); };
  }, []);

  async function check() {
    setRequestError('');
    const result = await window.snipvia.updates.check();
    if (result.ok) setState(result.value);
    else setRequestError(result.error);
  }

  const checking = state?.status === 'checking';
  const downloading = state?.status === 'downloading';
  const downloaded = state?.status === 'downloaded';
  const installing = state?.status === 'installing';
  const available = !!state && ['available', 'downloading', 'downloaded', 'installing'].includes(state.status);
  const error = requestError || state?.error;
  const message = error || (checking ? '正在检查新版本…' : downloading ? `正在下载 v${state.latestVersion} · ${state.downloadProgress ?? 0}%`
    : downloaded ? `v${state.latestVersion} 已下载，重启时校验并安装` : installing ? '正在保存笔记并准备重启更新…' : available ? `发现新版本 v${state.latestVersion}`
    : state?.status === 'up-to-date' ? `当前 v${state.currentVersion} 无需更新` : '启动后在后台检查正式版本');
  return <div className="preference-row update-settings-row">
    <div className="preference-copy">
      <strong>软件更新</strong>
      <span className="update-status" role={error ? 'alert' : 'status'}>
        {(error || available) && <Icon name={error ? 'info' : 'arrow'} size={13} />}
        {!error && state?.status === 'up-to-date' && <span aria-hidden="true">✓</span>}
        {message}
      </span>
      {state?.checkedAt && !checking && <span>最近检查：{new Date(state.checkedAt).toLocaleString()}</span>}
      {available && state.downloadUnavailableReason && <span>{state.downloadUnavailableReason}</span>}
      {downloading && <progress className="update-download-progress" aria-label="更新下载进度" max={100} value={state.downloadProgress ?? 0} />}
    </div>
    <div className="update-settings-actions">
      {available && <Button onClick={() => { void window.snipvia.updates.openRelease().then(result => { if (!result.ok) setRequestError(result.error); }); }}>查看新版本</Button>}
      {available && !downloaded && !installing && <Button disabled={!state.downloadSupported || downloading} onClick={() => {
        setRequestError(''); void window.snipvia.updates.download().then(result => { if (result.ok) setState(result.value); else setRequestError(result.error); });
      }}>{downloading ? '下载中…' : '下载更新'}</Button>}
      {(downloaded || installing) && <Button disabled={installing} onClick={() => {
        setRequestError(''); void window.snipvia.updates.restartAndInstall().then(result => { if (result.ok) setState(result.value); else setRequestError(result.error); });
      }}>{installing ? '准备重启…' : '重启并更新'}</Button>}
      <Button className="preference-action" disabled={checking || downloading || downloaded || installing} aria-label="检查更新" onClick={() => void check()}>{checking ? '检查中…' : '检查更新'}</Button>
    </div>
    {available && <section className="update-release-notes" aria-label={`v${state.latestVersion} 更新说明`}>
      <h3>更新说明</h3>
      {state.releaseNotes ? <div className="update-release-notes-body" tabIndex={0} aria-label="更新说明内容">
        <MarkdownMessage content={state.releaseNotes} onError={setRequestError} />
      </div> : <p>此版本未提供更新说明，可点击「查看新版本」访问发布页。</p>}
    </section>}
  </div>;
}
