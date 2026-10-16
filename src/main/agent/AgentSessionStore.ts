import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import type { AgentMessage } from '../../shared/agent/message';
import { ContextManager } from './ContextManager';

export interface StoredAgentSession { history: AgentMessage[]; syncedMessages: number; notebookId?: string }
const fileSchema = z.strictObject({
  version: z.literal(1),
  history: z.array(z.unknown()).max(2000),
  syncedMessages: z.number().int().min(0).max(100_000),
  notebookId: z.string().uuid().optional()
});

/**
 * Full Agent transcripts (tool calls and results included) per conversation, so a reopened
 * conversation or a restarted app continues with real context instead of 12 plain messages.
 * Same sensitivity as local chat history; deleted together with the conversation.
 */
export class AgentSessionStore {
  private readonly context = new ContextManager();
  constructor(private readonly directory: string) {}

  load(conversationId: string): StoredAgentSession | undefined {
    try {
      const parsed = fileSchema.safeParse(JSON.parse(readFileSync(this.file(conversationId), 'utf8')));
      if (!parsed.success) return undefined;
      // Reuse the loop's own history validation: pairing, roles and size limits.
      return { history: this.context.validateHistory(parsed.data.history as AgentMessage[]), syncedMessages: parsed.data.syncedMessages,
        ...(parsed.data.notebookId ? { notebookId: parsed.data.notebookId } : {}) };
    } catch { return undefined; }
  }
  save(conversationId: string, session: StoredAgentSession): void {
    if (!session.history.length) { this.delete(conversationId); return; }
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const temporary = path.join(this.directory, `.${randomUUID()}.tmp`);
    writeFileSync(temporary, JSON.stringify({ version: 1, ...session }), { mode: 0o600 });
    renameSync(temporary, this.file(conversationId));
  }
  delete(conversationId: string): void { rmSync(this.file(conversationId), { force: true }); }
  clear(): void { rmSync(this.directory, { recursive: true, force: true }); }
  private file(conversationId: string): string { return path.join(this.directory, `${z.string().uuid().parse(conversationId)}.json`); }
}
