import { Fragment, useEffect, useRef, useState } from 'react';
import type { Message } from '../../../shared/contracts';
import type { AgentDiffView, AgentRunView, AgentStepView } from '../../../shared/agent/execution';
import type { PermissionDecision } from '../../../shared/agent/permission';
import type { AgentExecutionController } from './useAgentExecution';
import { SourceAnswer } from './SourceReferences';
import { agentActivity, timelineSteps } from './activity';
import { NoteChanges } from './NoteChanges';
import './execution.css';
import { AgentNotebookButton } from './AgentNotebook';

function StateIcon({ state }: { state: AgentStepView['state'] }) {
  const busy = state === 'thinking' || state === 'tool_running';
  return <span className={`agent-state-icon ${busy ? 'spinning' : ''}`} aria-hidden="true">{busy ? '' : state === 'tool_success' || state === 'completed' ? '✓' : state === 'permission_required' ? '!' : state === 'tool_error' ? '×' : state === 'cancelled' ? '−' : '·'}</span>;
}
export function AgentActivityLine({ label, web = false, state = 'thinking' }: { label: string; web?: boolean; state?: AgentStepView['state'] }) {
  return <div className={`agent-run-status state-${state}`} role="status" title={label}>
    {web ? <svg className="agent-web-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="12" cy="12" r="9" /><ellipse cx="12" cy="12" rx="4" ry="9" /><path d="M3 12h18M5 7.5h14M5 16.5h14" /></svg> : <StateIcon state={state} />}
    <span>{label}</span>
  </div>;
}
function DiffDialog({ value, close }: { value: AgentDiffView; close(): void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  return <dialog ref={dialog} className="agent-diff-dialog" aria-label="文件修改差异" onCancel={close}>
    <header><div><strong>文件修改</strong><code>{value.path}</code></div><button onClick={close} aria-label="关闭差异">×</button></header>
    {value.truncated && <p role="status">预览内容过长，当前只显示前 512 KB。请拒绝并要求拆分修改后再确认。</p>}
    <pre tabIndex={0} aria-label="文件 diff">{value.diff.split('\n').length > 5000 ? value.diff : value.diff.split('\n').map((line, index) =>
      <span key={index} className={line.startsWith('+') ? 'diff-added' : line.startsWith('-') ? 'diff-removed' : undefined}>{line}{'\n'}</span>)}</pre>
  </dialog>;
}
function InlinePermission({ step, run, controller }: { step: AgentStepView; run: AgentRunView; controller: AgentExecutionController }) {
  const [submitting, setSubmitting] = useState(false); const [error, setError] = useState('');
  const [diff, setDiff] = useState<AgentDiffView | null>(null); const [loadingDiff, setLoadingDiff] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [expired, setExpired] = useState(false);
  const permission = step.permission!;
  useEffect(() => {
    setSubmitting(false); setExpired(false); setError(''); setReviewed(false);
    const timer = setTimeout(() => setExpired(true), Math.max(0, permission.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [permission.requestId]);
  async function decide(decision: Exclude<PermissionDecision, 'always_allow'>) {
    if (submitting || expired) return;
    setSubmitting(true); setError('');
    try { await controller.decide(run.runId, permission.requestId, decision); }
    catch (error) { setError(error instanceof Error ? error.message : '确认失败'); setSubmitting(false); }
  }
  async function viewDiff() {
    if (!controller.snapshot?.captureId) return;
    setLoadingDiff(true); setError('');
    try {
      const result = await window.snipvia.agent.diff(controller.snapshot.captureId, run.runId, step.id);
      if (result.ok) { setDiff(result.value); setReviewed(!result.value.truncated); } else setError(result.error);
    } catch { setError('无法读取修改预览'); }
    finally { setLoadingDiff(false); }
  }
  const script = step.toolName === 'run_script';
  const noteReview = step.toolName === 'write_note' || step.toolName === 'edit_note';
  const disabled = submitting || expired || !controller.snapshot?.canControl;
  // Non-modal and inside the timeline, like OpenCode: Enter never approves; Deny is first.
  return <div className={`agent-inline-permission risk-${permission.risk.toLowerCase()}`} role="group" aria-label="Agent 操作确认">
    <p>{script ? `Agent 希望运行此${step.detail ? ` ${languageLabel(step.detail)} ` : ''}脚本` : permission.command ? 'Agent 希望执行此命令' : step.diff ? 'Agent 希望修改此文件' : 'Agent 请求执行此操作'}</p>
    {permission.command && <pre aria-label={script ? '脚本内容' : '命令'}>{permission.command}</pre>}
    {step.diff && <div className="agent-diff-summary"><span className="removed">−{step.diff.removed} 行</span><span className="added">+{step.diff.added} 行</span>
      <button type="button" onClick={() => void viewDiff()} disabled={loadingDiff}>{loadingDiff ? '正在读取…' : '查看差异'}</button></div>}
    <ul className="agent-permission-reasons">{permission.description.split('；').filter(Boolean).slice(0, 4).map((reason, index) => <li key={index}>{reason.replace(/。.*$/, '')}</li>)}</ul>
    {permission.workspacePath && <p className="agent-working-directory">工作目录 <code>{permission.workspacePath}</code></p>}
    {permission.argumentsText && !permission.command && <details><summary>参数</summary><pre>{permission.argumentsText}</pre></details>}
    <div className="agent-inline-actions">
      <button type="button" disabled={disabled} onClick={() => void decide('deny')}>拒绝</button>
      {!permission.command && permission.allowedDecisions.includes('allow_session') && <button type="button" disabled={disabled} onClick={() => void decide('allow_session')}>本次会话允许</button>}
      {permission.allowedDecisions.includes('allow_once') && <button type="button" className="agent-allow" disabled={disabled || noteReview && !reviewed} onClick={() => void decide('allow_once')}>{permission.command ? '运行' : '允许一次'}</button>}
    </div>
    {noteReview && !reviewed && <small>查看完整差异后，确认本次笔记修改。</small>}
    {expired && <small>确认已过期，请重新发起任务。</small>}
    {!controller.snapshot?.canControl && <small>请在发起此任务的窗口中确认。</small>}
    {error && <p className="agent-card-error" role="alert">{error}</p>}
    {diff && <DiffDialog value={diff} close={() => setDiff(null)} />}
  </div>;
}
function languageLabel(value: string): string {
  return ({ javascript: 'JavaScript', python: 'Python', shell: 'Shell' } as Record<string, string>)[value] ?? value;
}
/** The part after the verb: a query, host, path or command, never raw page content. */
function stepTarget(step: AgentStepView): string {
  if (step.toolName === 'run_script') return languageLabel(step.detail);
  if (step.toolName === 'run_command') return `$ ${step.detail}`;
  if (step.toolName === 'web_search') return step.webTarget ? `“${step.webTarget}”` : '';
  if (['fetch_url', 'read_web_chunk'].includes(step.toolName)) return step.webTarget ?? '';
  return step.detail === step.toolName || step.detail === '.' ? '' : step.detail;
}
function stepMeta(step: AgentStepView): string {
  if (step.state === 'permission_required') return '等待确认';
  if (step.state === 'tool_running' || step.state === 'tool_pending') return '';
  const duration = step.durationMs !== undefined && step.durationMs >= 100 ? `${(step.durationMs / 1000).toFixed(1)}s` : '';
  const summary = step.state === 'tool_success' && step.summary !== '已完成' ? step.summary?.split('\n')[0] : '';
  return [summary, duration].filter(Boolean).join(' · ');
}
function TodoList({ todos }: { todos: NonNullable<AgentRunView['todos']> }) {
  const done = todos.filter(todo => todo.status === 'completed').length;
  return <div className="agent-todos" aria-label="任务计划">
    <div className="agent-todos-heading">计划 <span>{done}/{todos.length}</span></div>
    <ul>{todos.map((todo, index) => <li key={index} className={`todo-${todo.status}`}>
      <span className="agent-todo-mark" aria-hidden="true">{todo.status === 'completed' ? '✓' : todo.status === 'in_progress' ? '' : todo.status === 'cancelled' ? '−' : ''}</span>
      <span>{todo.content}</span>{todo.status === 'in_progress' && <span className="visually-hidden">（进行中）</span>}
    </li>)}</ul>
  </div>;
}
export function AgentTimeline({ run, controller }: { run: AgentRunView; controller: AgentExecutionController }) {
  const [expanded, setExpanded] = useState<boolean | null>(null);
  const steps = timelineSteps(run.steps);
  const failed = steps.filter(step => step.state === 'tool_error').length;
  if (!steps.length && !run.todos?.length) return null;
  // Expanded while working; folded into one summary row after the run, like OpenCode's finished parts.
  const open = expanded ?? !run.finished;
  return <div className="agent-timeline">
    {run.finished && steps.length > 0 && <button type="button" className="agent-timeline-toggle" aria-expanded={open} onClick={() => setExpanded(!open)}>
      <span aria-hidden="true">{open ? '▾' : '▸'}</span>已执行 {steps.length} 个步骤{failed ? ` · ${failed} 个未完成` : ''}
    </button>}
    {open && !!run.todos?.length && <TodoList todos={run.todos} />}
    {open && steps.length > 0 && <ol className="agent-parts">{steps.map(step => <li key={step.id} className={`agent-part state-${step.state}`} data-tool={step.toolName}>
      <div className="agent-part-row" title={step.summary}>
        <StateIcon state={step.state} />
        <span className="agent-part-title">{step.title}</span>
        <span className="agent-part-target">{stepTarget(step)}</span>
        <span className="agent-part-meta">{stepMeta(step)}</span>
      </div>
      {(step.state === 'tool_error' || step.state === 'cancelled') && step.summary && <p className="agent-part-error">{step.summary}</p>}
      {step.permission && controller.snapshot?.canControl && <InlinePermission key={step.permission.requestId} step={step} run={run} controller={controller} />}
    </li>)}</ol>}
  </div>;
}
function RunCard({ run, controller, compact, onError }: { run: AgentRunView; controller: AgentExecutionController; compact: boolean; onError(message: string): void }) {
  const className = compact ? 'quick-message' : 'message';
  const activity = agentActivity(run);
  return <>
    <article className={`${className} user`}><span>你</span><p>{run.question}</p></article>
    <article className={`${className} assistant agent-message`} data-agent-run={run.runId}>
      <span>截然 · Agent</span>
      <AgentTimeline run={run} controller={controller} />
      {activity && <AgentActivityLine {...activity} state={run.state} />}
      {run.notice && <p className="agent-run-notice" role={run.state === 'tool_error' ? 'alert' : undefined}>{run.notice}</p>}
      {(run.answer || run.finished && !!run.sources?.length) && <SourceAnswer content={run.answer} sources={run.sources} captureId={controller.snapshot?.captureId}
        answerClassName={`agent-answer${run.answerStreaming ? ' is-streaming' : ''}`} streaming={run.answerStreaming} onError={onError} />}
      {run.finished && !!run.noteChanges?.length && <NoteChanges changes={run.noteChanges} captureId={controller.snapshot?.captureId} onError={onError} />}
    </article>
  </>;
}
export function AgentChatMessages({ messages, controller, compact = false, onError }: { messages: Message[]; controller: AgentExecutionController; compact?: boolean; onError(message: string): void }) {
  const runs = controller.snapshot?.runs ?? []; const className = compact ? 'quick-message' : 'message';
  return <>{Array.from({ length: messages.length + 1 }, (_, index) => {
    const anchored = runs.filter((run) => run.messageIndex === index);
    const hidden = runs.some((run) => run.saved && (index === run.messageIndex || index === run.messageIndex + 1));
    const message = messages[index];
    return <Fragment key={index}>{anchored.map((run) => <RunCard key={run.runId} run={run} controller={controller} compact={compact} onError={onError} />)}
      {message && !hidden && <article className={`${className} ${message.role}`}><span>{message.role === 'user' ? '你' : `截然${message.model ? ` · ${message.model}` : ''}`}</span>{message.role === 'assistant' ? <><SourceAnswer content={message.content} sources={message.sources} captureId={controller.snapshot?.captureId} onError={onError} />{!!message.noteChanges?.length && <NoteChanges changes={message.noteChanges} captureId={controller.snapshot?.captureId} onError={onError} />}</> : <p>{message.content}</p>}</article>}
    </Fragment>;
  })}</>;
}
export function AgentComposerControls({ controller, disabled }: { controller: AgentExecutionController; disabled: boolean }) {
  return <div className="agent-composer-controls">
    <button type="button" className={`agent-mode ${controller.enabled ? 'selected' : ''}`} aria-pressed={controller.enabled} disabled={disabled || controller.busy} onClick={() => controller.setEnabled(!controller.enabled)}>Agent</button>
    {controller.enabled && <span className="agent-scope-hint">{controller.snapshot?.notebook ? '联网 · 笔记' : '联网 · 只读'}</span>}
    {controller.enabled && <AgentNotebookButton controller={controller} disabled={disabled} />}
  </div>;
}
