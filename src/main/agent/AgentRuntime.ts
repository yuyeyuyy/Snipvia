import { randomUUID } from 'node:crypto';
import { AgentLoop } from './AgentLoop';
import type { AgentEvent, AgentRunRequest, AgentRunResult } from './types/agent';

export interface AgentSnapshot {
  runId: string;
  status: 'running' | AgentRunResult['status'];
  sequence: number;
  step: number;
  partialText: string;
  result?: AgentRunResult;
}

export class AgentRuntime {
  private readonly active = new Map<string, AbortController>();
  private readonly snapshots = new Map<string, AgentSnapshot>();

  constructor(private readonly loop: AgentLoop) {}

  start(request: AgentRunRequest, onEvent?: (event: AgentEvent) => void | Promise<void>) {
    const runId = randomUUID();
    const controller = new AbortController();
    const signal = request.signal ? AbortSignal.any([request.signal, controller.signal]) : controller.signal;
    this.active.set(runId, controller);
    const snapshot: AgentSnapshot = { runId, status: 'running', sequence: 0, step: 0, partialText: '' };
    this.snapshots.set(runId, snapshot);
    // Defer until the handle is returned, so callers can cancel from the first event.
    const result = Promise.resolve().then(() => this.loop.run({ ...request, signal }, { runId, onEvent: (event) => {
      snapshot.sequence = event.sequence;
      snapshot.step = event.step;
      if (event.type === 'step_started') snapshot.partialText = '';
      else if (event.type === 'assistant_delta') snapshot.partialText += event.text;
      else if (event.type === 'llm_completed') snapshot.partialText = event.response.content;
      else if (event.type === 'run_finished') snapshot.status = event.status;
      return onEvent?.(event);
    } })).then((finished) => {
      snapshot.result = structuredClone(finished);
      return finished;
    }).finally(() => {
      this.active.delete(runId);
      // Keep a bounded in-memory inspection history. No automatic replay or persistence.
      const completed = [...this.snapshots.values()].filter((entry) => entry.status !== 'running');
      for (const old of completed.slice(0, Math.max(0, completed.length - 20))) this.snapshots.delete(old.runId);
    });
    return { runId, result, cancel: () => this.cancel(runId) };
  }

  cancel(runId: string): void { this.active.get(runId)?.abort(); }
  cancelAll(): void { for (const controller of this.active.values()) controller.abort(); }
  getSnapshot(runId: string): AgentSnapshot | undefined {
    const snapshot = this.snapshots.get(runId);
    return snapshot ? structuredClone(snapshot) : undefined;
  }
}
