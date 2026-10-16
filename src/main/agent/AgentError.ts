import type { AgentErrorCode } from './types/agent';

export class AgentError extends Error {
  constructor(readonly code: AgentErrorCode, message: string) { super(message); this.name = 'AgentError'; }
}

export function checkAgentAbort(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason instanceof AgentError ? signal.reason : new AgentError('CANCELLED', 'Agent 已由用户取消');
}
