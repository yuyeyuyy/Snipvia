import type { EditingIntent } from '../../shared/agent/editing';
import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ToolError, throwIfAborted, toolFailure } from './ToolError';
import { ToolRegistry } from './ToolRegistry';
import { WorkspaceService, type WorkspaceGrant } from './WorkspaceService';
import type { ToolCall, ToolLifecycleEvent, ToolResult } from './types/tool';
import type { FileChangeService, PreparedFileChange } from './FileChangeService';
import { PermissionManager, type PermissionCallOptions, type PermissionSession } from './PermissionManager';
import type { NotebookWriter } from './notes/NotebookWriter';
import type { CommandRunner } from './commands/CommandRunner';

const callSchema = z.strictObject({
  id: z.string().min(1).max(128),
  name: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  input: z.unknown()
});

export interface ToolExecutionOptions extends PermissionCallOptions {
  proposalScope?: object;
  propose?: (scope: object | undefined, intent: EditingIntent, signal: AbortSignal) => Promise<unknown>;
  noteScope?: object;
  commandScope?: object;
  workspace?: WorkspaceGrant;
  onRunning?: () => void;
  signal?: AbortSignal;
  /** Trusted caller may lower, but not raise, the executor's timeout limit. */
  timeoutMs?: number;
}

export class ToolExecutor {
  private readonly active = new Map<string, AbortController>();
  private readonly timeoutMs: number;
  private readonly permissions: PermissionManager;

  get maxTimeoutMs(): number { return this.timeoutMs; }

  constructor(
    private readonly registry: ToolRegistry,
    private readonly workspaces: WorkspaceService,
    private readonly options: { timeoutMs?: number; onEvent?: (event: ToolLifecycleEvent) => void; fileChanges?: FileChangeService; permissions?: PermissionManager; noteWriter?: NotebookWriter; commandRunner?: CommandRunner } = {}
  ) {
    this.timeoutMs = options.timeoutMs ?? 10_000;
    if (options.permissions && options.fileChanges && options.permissions !== options.fileChanges.permissions) {
      throw new ToolError('INVALID_INPUT', '工具与文件修改必须使用同一权限服务');
    }
    this.permissions = options.permissions ?? options.fileChanges?.permissions ?? new PermissionManager();
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 60_000) {
      throw new ToolError('INVALID_INPUT', '工具超时上限必须在 1–60000ms 之间');
    }
  }

  createPermissionSession(): PermissionSession { return this.permissions.createSession(); }
  endPermissionSession(session: PermissionSession): void { this.permissions.endSession(session); }

  cancel(toolCallId: string): void {
    this.active.get(toolCallId)?.abort(new ToolError('ABORTED', '工具调用已取消'));
  }

  cancelAll(): void {
    for (const controller of this.active.values()) controller.abort(new ToolError('ABORTED', '工具调用已取消'));
  }

  async execute(call: ToolCall, options: ToolExecutionOptions = {}): Promise<ToolResult> {
    return this.executeCall(call, options);
  }

  /** Main-only Undo entry. It uses the same preview, confirmation and conflict checks. */
  async undo(undoId: string, options: ToolExecutionOptions): Promise<ToolResult> {
    return this.executeCall({ id: randomUUID(), name: 'undo_file_change', input: {} }, options, undoId);
  }

  private async executeCall(call: ToolCall, options: ToolExecutionOptions, undoId?: string): Promise<ToolResult> {
    const started = performance.now();
    const parsed = callSchema.safeParse(call);
    if (!parsed.success) return toolFailure(new ToolError('INVALID_INPUT', '工具调用格式无效'));
    const { id, name } = parsed.data;
    const withMetadata = (result: ToolResult): ToolResult => ({
      ...result, metadata: { durationMs: performance.now() - started, toolCallId: id, toolName: name }
    });
    if (this.active.has(id)) return withMetadata(toolFailure(new ToolError('CALL_IN_PROGRESS', '同一工具调用正在执行')));
    const controller = new AbortController();
    this.active.set(id, controller);
    this.emit({ type: 'started', toolCallId: id, toolName: name });
    const cleanups: Array<() => void> = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    let result: ToolResult;
    try {
      if (undoId !== undefined) this.registry.assertPermissionEnabled('workspace:write');
      const input: unknown = structuredClone(parsed.data.input);
      const tool = undoId !== undefined ? undefined : this.registry.resolve(name);
      const timeoutMs = options.timeoutMs ?? this.timeoutMs;
      if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > this.timeoutMs) {
        throw new ToolError('INVALID_INPUT', '工具超时不能超过配置上限');
      }
      const forward = (signal: AbortSignal | undefined, reason?: ToolError) => {
        if (!signal) return;
        const abort = () => controller.abort(reason ?? signal.reason);
        if (signal.aborted) abort();
        else {
          signal.addEventListener('abort', abort, { once: true });
          cleanups.push(() => signal.removeEventListener('abort', abort));
        }
      };
      forward(options.signal, new ToolError('ABORTED', '工具调用已取消'));
      throwIfAborted(controller.signal);
      const isExternal = tool?.permission === 'external:execute';
      const isNotebook = tool?.permission === 'notebook:write';
      const isCommand = tool?.permission === 'workspace:execute';
      const isProposal = tool?.permission === 'conversation:propose';
      const isWeb = tool?.permission === 'network:read' || isExternal || isProposal;
      if (!isWeb && !isNotebook || options.workspace) forward(this.workspaces.revocationSignal(options.workspace));
      if (options.session) forward(this.permissions.sessionSignal(options.session));
      throwIfAborted(controller.signal);
      const workspace = isWeb || isNotebook || isCommand ? undefined : this.workspaces.createAccess(options.workspace!, controller.signal);
      const interrupted = new Promise<never>((_resolve, reject) => {
        const abort = () => {
          try { throwIfAborted(controller.signal); } catch (error) { reject(error); }
        };
        controller.signal.addEventListener('abort', abort, { once: true });
        cleanups.push(() => controller.signal.removeEventListener('abort', abort));
      });
      // Permission review has a separate timeout. Cancellation must remain handled while awaiting it.
      void interrupted.catch(() => {});
      const armTimer = () => { timer = setTimeout(() => controller.abort(new ToolError('TIMEOUT', '工具执行超时')), timeoutMs); };
      let value: ToolResult;
      if (tool?.permission === 'conversation:propose') {
        if (!options.proposalScope || !options.propose) throw new ToolError('PERMISSION_DENIED', '没有本轮编辑授权');
        const intent = tool.prepare(input); armTimer(); options.onRunning?.();
        value = { success: true, output: await Promise.race([options.propose(options.proposalScope, intent, controller.signal), interrupted]) };
        throwIfAborted(controller.signal);
      } else if (tool?.permission === 'workspace:execute') {
        const runner = this.options.commandRunner;
        if (!runner) throw new ToolError('PERMISSION_DENIED', '当前未开放命令执行');
        const intent = tool.prepare(input);
        // Validate first, then ask. Literal read/organize commands are SAFE and skip the
        // prompt; scripts and other commands wait here. Review time does not consume the
        // execution timeout, and the sandbox still enforces the notebook boundary.
        await this.permissions.authorize({ toolCallId: id, toolName: name, input, permission: tool.permission,
          workspaceId: options.workspace?.id ?? 'notebook', workspacePath: options.workspace ? this.workspaces.displayPath(options.workspace) : '',
          workspaceIdentity: options.workspace ? this.workspaces.permissionIdentity(options.workspace) : undefined }, controller.signal, options);
        throwIfAborted(controller.signal);
        armTimer();
        try { options.onRunning?.(); } catch { /* Presentation cannot grant a scope. */ }
        // The runner owns OS isolation, scope checks and child termination. Wait
        // for its actual result so partial writes survive Stop / timeout.
        value = await runner.run(options.commandScope, intent, controller.signal, timeoutMs);
      } else if (tool?.permission === 'notebook:write') {
        const writer = this.options.noteWriter;
        if (!writer) throw new ToolError('PERMISSION_DENIED', '当前未开放笔记自动写入');
        const intent = tool.prepare(input);
        armTimer(); try { options.onRunning?.(); } catch { /* UI cannot change commit authorization. */ }
        // Main's notebook capability authorizes this narrow path. Never race an
        // atomic commit against Stop or lose its actual successful outcome.
        value = { success: true, output: await writer.apply(options.noteScope, intent, controller.signal, { ...options, toolCallId: id, beforeReview: () => { clearTimeout(timer); timer = undefined; }, afterReview: armTimer }) };
      } else if (tool?.permission === 'workspace:read' || tool?.permission === 'network:read' || tool?.permission === 'external:execute') {
        if (tool.permission === 'external:execute') tool.parseInput(input);
        await this.permissions.authorize({ toolCallId: id, toolName: name, input, permission: tool.permission,
          external: tool.permission === 'external:execute' ? tool.external : undefined,
          workspaceId: options.workspace?.id ?? (isExternal ? 'external-tool' : 'public-web'), workspacePath: options.workspace ? this.workspaces.displayPath(options.workspace) : '',
          workspaceIdentity: options.workspace ? this.workspaces.permissionIdentity(options.workspace) : undefined }, controller.signal, options);
        armTimer();
        const execution = Promise.resolve().then(() => {
          throwIfAborted(controller.signal);
          try { options.onRunning?.(); } catch { /* UI observers cannot affect execution. */ }
          if (tool.permission === 'external:execute') return tool.invoke(input, Object.freeze({ toolCallId: id, signal: controller.signal }));
          return tool.permission === 'network:read'
            ? tool.invoke(input, Object.freeze({ toolCallId: id, signal: controller.signal, scope: options.session ?? options.workspace ?? Object.freeze({}) }))
            : tool.invoke(input, Object.freeze({ toolCallId: id, signal: controller.signal, workspace: workspace! }));
        });
        value = await Promise.race([execution, interrupted]);
        throwIfAborted(controller.signal);
      } else {
        armTimer();
        const changes = this.options.fileChanges;
        if (!changes) throw new ToolError('APPROVAL_REQUIRED', '尚未配置文件修改审批服务');
        const preparing: Promise<PreparedFileChange> = undoId !== undefined
          ? changes.prepareUndo(undoId, options.workspace!, id, controller.signal)
          : changes.prepare(tool!.prepare(input), options.workspace!, id, controller.signal);
        const plan = await Promise.race([preparing, interrupted]);
        clearTimeout(timer);
        timer = undefined;
        // User review has its own bounded timeout; it must not consume the 10s filesystem budget.
        const receipt = await changes.approve(plan, controller.signal, { ...options, toolName: name });
        armTimer();
        // Unlike reads, do not race a commit syscall: report its actual outcome even if cancel arrives.
        // Keep a rejection handler attached to the earlier interruption promise during commit.
        void interrupted.catch(() => {});
        try { options.onRunning?.(); } catch { /* UI observers cannot affect execution. */ }
        value = { success: true, output: await changes.commit(plan, receipt, controller.signal) };
      }
      if (!value || typeof value.success !== 'boolean' ||
          (value.success ? !('output' in value) : !value.error?.code || typeof value.error.message !== 'string')) {
        throw new ToolError('INVALID_RESULT', '工具返回格式无效');
      }
      result = value;
    } catch (error) {
      result = toolFailure(error);
    } finally {
      if (timer) clearTimeout(timer);
      for (const cleanup of cleanups) cleanup();
      this.active.delete(id);
      // Retained contexts lose their capability when the call finishes, too.
      if (!controller.signal.aborted) controller.abort(new ToolError('ABORTED', '工具调用已结束'));
    }
    result = withMetadata(result);
    this.emit({ type: 'completed', toolCallId: id, toolName: name, success: result.success,
      errorCode: result.success ? undefined : result.error.code, durationMs: result.metadata!.durationMs });
    return result;
  }

  private emit(event: ToolLifecycleEvent): void {
    // Lifecycle observers must not change execution or expose file contents by default.
    try { this.options.onEvent?.(event); } catch { /* Keep diagnostics isolated. */ }
  }
}
