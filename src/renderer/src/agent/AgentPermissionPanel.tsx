import { useEffect, useState } from 'react';
import type { PermissionDecision, PermissionRequest } from '../../../shared/agent/permission';

const decisionLabels: Record<PermissionDecision, string> = {
  allow_once: '允许一次', allow_session: '本次会话允许', always_allow: '始终允许此操作', deny: '拒绝'
};
const riskLabels = { SAFE: '只读', REVIEW: '需要审核', DANGEROUS: '高风险' };

export function AgentPermissionPanel() {
  const [request, setRequest] = useState<PermissionRequest | null>(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [mode, setMode] = useState<'diff' | 'compare'>('diff');
  useEffect(() => {
    let disposed = false;
    const receive = (value: PermissionRequest) => { if (!disposed) setRequest(value); };
    const unsubscribe = window.snipvia.agentPermissions.onRequest(receive);
    void window.snipvia.agentPermissions.current().then(receive)
      .catch(() => { if (!disposed) setError('无法加载权限请求。请关闭此窗口，重新发起操作。'); });
    return () => { disposed = true; unsubscribe(); };
  }, []);
  async function decide(decision: PermissionDecision) {
    if (!request || submitting) return;
    setSubmitting(true);
    try { await window.snipvia.agentPermissions.decide(request.requestId, decision); }
    catch { setError('确认未完成、决策不允许或请求已过期，请重新发起操作。'); setSubmitting(false); }
  }
  async function clearRemembered() {
    if (submitting) return;
    setSubmitting(true);
    try { await window.snipvia.agentPermissions.clearRemembered(); }
    catch { setError('清除记住的权限失败，请重试。'); setSubmitting(false); }
  }
  const preview = request?.preview;
  return <main className="settings-preferences agent-permission-page">
    <header className="agent-permission-header"><div>
      <h1>{preview ? '确认文件修改' : 'Agent 权限确认'}</h1>
      <p>Agent 正在等待你的决定。关闭窗口等同拒绝。</p>
    </div>{request && <span className={`permission-risk permission-risk-${request.risk.toLowerCase()}`}>{riskLabels[request.risk]}</span>}</header>
    {error && <p role="alert">{error}</p>}
    {request ? <>
      <section className="preference-card permission-details" aria-label="权限详情">
        <div className="permission-row"><div><strong>操作</strong><p>{request.reasons.join('；')}</p></div><code>{request.toolName}</code></div>
        <div className="permission-row"><div><strong>工作区</strong><p>授权仅限这个工作区</p></div><span title={request.workspacePath}>{request.workspacePath}</span></div>
        <div className="permission-row"><div><strong>{request.command ? '命令' : '目标'}</strong><p>{preview ? `UTF-8${preview.utf8Bom ? ' BOM' : ''} · ${preview.newline} · ${preview.operation === 'delete' ? '删除' : preview.operation === 'create' ? '新建' : '修改'}` : '参数变化后重新确认'}</p></div><code>{request.target}</code></div>
      </section>
      {request.argumentsText && <details className="permission-arguments"><summary>查看完整参数</summary><pre>{request.argumentsText}</pre></details>}
      {preview && <section className="workspace-card file-approval-card" aria-label="文件修改预览">
        <header><strong>{preview.path}</strong><div className="file-approval-modes" aria-label="预览方式">
          <button aria-pressed={mode === 'diff'} onClick={() => setMode('diff')}>差异</button>
          <button aria-pressed={mode === 'compare'} onClick={() => setMode('compare')}>修改前后</button>
        </div></header>
        {mode === 'diff' ? <div className="file-diff" aria-label="文件 diff"><pre>{preview.diff}</pre></div> :
          <div className="file-compare">
            <section><h2>修改前</h2><pre>{preview.before ?? '（文件不存在）'}</pre></section>
            <section><h2>修改后</h2><pre>{preview.after ?? '（文件将被删除）'}</pre></section>
          </div>}
      </section>}
      <footer className="permission-footer">
        <p>{request.scopeDescription}{preview && ' 写入前会再次检查文件是否变化。'}</p>
        {request.risk === 'DANGEROUS' && <p className="permission-danger-note">高风险操作不能始终允许。会话授权也只适用于完全相同的操作。</p>}
        <div className="permission-actions">
          <button className="permission-clear" disabled={submitting} onClick={() => void clearRemembered()}>清除记住的权限</button>
          <div>{(['deny', 'allow_session', 'always_allow', 'allow_once'] as const)
            .filter((decision) => request.allowedDecisions.includes(decision) && !(request.risk === 'DANGEROUS' && decision === 'always_allow'))
            .map((decision) => <button key={decision} autoFocus={decision === 'deny'}
              className={decision === 'allow_once' ? 'primary' : undefined} disabled={submitting}
              onClick={() => void decide(decision)}>{decisionLabels[decision]}</button>)}</div>
        </div>
      </footer>
    </> : !error && <p>正在加载权限请求…</p>}
  </main>;
}
