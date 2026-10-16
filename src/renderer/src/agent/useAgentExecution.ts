import { useEffect, useRef, useState } from 'react';
import type { AgentExecutionSnapshot } from '../../../shared/agent/execution';
import type { PermissionDecision } from '../../../shared/agent/permission';

export function useAgentExecution(captureId: string | undefined, refresh: () => void, onError: (message: string) => void) {
  const [snapshot, setSnapshot] = useState<AgentExecutionSnapshot | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [starting, setStarting] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const latest = useRef(snapshot); const id = useRef(captureId); id.current = captureId;
  const callbacks = useRef({ refresh, onError }); callbacks.current = { refresh, onError };
  const refreshed = useRef(new Set<string>());
  const accept = (value: AgentExecutionSnapshot) => {
    if (value.captureId !== id.current || (latest.current && latest.current.captureId === value.captureId && latest.current.revision > value.revision)) return;
    latest.current = value; setSnapshot(value);
    if (value.busy) setEnabled(true);
    for (const run of value.runs) if (run.finished && run.saved && !refreshed.current.has(run.runId)) {
      refreshed.current.add(run.runId); callbacks.current.refresh();
    }
  };
  useEffect(() => {
    let disposed = false;
    latest.current = null; setSnapshot(null); setStarting(false); setSelecting(false); setEnabled(true);
    if (!captureId) return;
    const receive = (value: AgentExecutionSnapshot) => { if (!disposed) accept(value); };
    const stop = window.snipvia.agent.onChanged(receive);
    void window.snipvia.agent.state(captureId).then((result) => { if (result.ok) receive(result.value); }).catch(() => { if (!disposed) callbacks.current.onError('无法读取 Agent 状态'); });
    return () => { disposed = true; stop(); };
  }, [captureId]);
  async function start(question: string) {
    if (!captureId || starting || latest.current?.busy) return false;
    setStarting(true);
    try {
      const result = await window.snipvia.agent.start(captureId, question);
      if (!result.ok) throw new Error(result.error);
      accept(result.value); return true;
    } catch (error) { callbacks.current.onError(error instanceof Error ? error.message : 'Agent 启动失败'); return false; }
    finally { if (id.current === captureId) setStarting(false); }
  }
  async function stop() {
    const run = latest.current?.runs.find((item) => !item.finished);
    if (!captureId || !run) return;
    try {
      const result = await window.snipvia.agent.stop(captureId, run.runId);
      if (!result.ok) callbacks.current.onError(result.error);
    } catch { callbacks.current.onError('停止请求失败，请重试'); }
  }
  async function selectNotebook(notebookId: string | null) {
    if (!captureId || selecting || latest.current?.busy) return false;
    setSelecting(true);
    try {
      const result = await window.snipvia.agent.selectNotebook(captureId, notebookId);
      if (!result.ok) throw new Error(result.error);
      accept(result.value); return true;
    } catch (error) { callbacks.current.onError(error instanceof Error ? error.message : '无法选择笔记，请重试'); return false; }
    finally { if (id.current === captureId) setSelecting(false); }
  }
  async function decide(runId: string, requestId: string, decision: Exclude<PermissionDecision, 'always_allow'>) {
    if (!captureId) throw new Error('截图已失效');
    const result = await window.snipvia.agent.decide(captureId, runId, requestId, decision);
    if (!result.ok) throw new Error(result.error);
  }
  return { captureId, snapshot: snapshot?.captureId === captureId ? snapshot : null, enabled, setEnabled, starting, selecting,
    busy: starting || !!(snapshot && snapshot.captureId === captureId && snapshot.busy), start, stop, selectNotebook, decide };
}
export type AgentExecutionController = ReturnType<typeof useAgentExecution>;
