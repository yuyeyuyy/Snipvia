import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ToolResult } from '../types/tool';
import { ToolError, throwIfAborted, toolFailure } from '../ToolError';
import type { NotebookWriter } from '../notes/NotebookWriter';
import type { WorkspaceService } from '../WorkspaceService';
import { isInsideWorkspace } from '../policies/pathPolicy';
import { NativeCommandSandbox, executeSandboxedProcess, shellQuote, type CommandSandbox, type ProcessOutput } from './ProcessSandbox';
import { inspectCommandFiles, commandNoteChanges } from './CommandFiles';
import type { NoteChangeSummary } from '../../../shared/agent/note-writing';

export type CommandIntent = { cwd: string; timeoutMs: number } & ({ kind: 'command'; command: string } | { kind: 'script'; language: 'javascript' | 'python' | 'shell'; code: string });
export interface CommandOutput extends ProcessOutput { noteChanges: NoteChangeSummary[]; changesTruncated: boolean; createdDirectories: string[]; removedDirectories: string[]; notice?: string }

export class CommandRunner {
  private active = false;
  constructor(private readonly deps: { workspaces: WorkspaceService; notes: NotebookWriter; protectedPaths: string[]; sandbox?: CommandSandbox }) {}
  async run(scope: object | undefined, intent: CommandIntent, signal: AbortSignal, remainingMs: number): Promise<ToolResult<CommandOutput>> {
    if (this.active) return toolFailure(new ToolError('CALL_IN_PROGRESS', '已有命令正在执行'));
    this.active = true; let scratch: string | undefined;
    try {
      const authorized = await this.deps.notes.prepareCommand(scope, signal);
      const root = await this.deps.workspaces.processDirectory(authorized.grant, '.', signal);
      for (const protectedPath of this.deps.protectedPaths) {
        const absolute = await realpath(protectedPath).catch(() => path.resolve(protectedPath));
        if (isInsideWorkspace(root, absolute) || isInsideWorkspace(absolute, root)) throw new ToolError('PERMISSION_DENIED', '笔记本与应用保护目录重合，不能执行命令');
      }
      const cwd = await this.deps.workspaces.processDirectory(authorized.grant, intent.cwd, signal);
      const before = await inspectCommandFiles(root, signal, true);
      scratch = await realpath(await mkdtemp(path.join(tmpdir(), 'snipvia-command-')));
      const limit = Math.min(intent.timeoutMs, remainingMs), cpuSeconds = Math.max(1, Math.ceil(limit / 1000));
      const raw = intent.kind === 'command' ? intent.command : intent.language === 'javascript' ? `${shellQuote(process.execPath)} --max-old-space-size=256 --input-type=module -`
        : intent.language === 'python' ? 'python3 -E -s -' : '/bin/bash -s';
      const command = `ulimit -t ${cpuSeconds} || exit 125; ulimit -f 32768 || exit 125; ulimit -n 128 || exit 125;\n${raw}`;
      const backend = this.deps.sandbox ?? new NativeCommandSandbox();
      const plan = await backend.prepare({ command, cwd, root, scratch, protectedPaths: this.deps.protectedPaths, readOnly: authorized.readOnly, signal, id: randomUUID() });
      let executed: ProcessOutput;
      try { throwIfAborted(signal); executed = await executeSandboxedProcess(plan, cwd, intent.kind === 'script' ? intent.code : '', signal, limit); }
      finally { await plan.cleanup(); }
      // Cancellation forbids new execution, but cannot erase a file already written by a child.
      let observed: Pick<CommandOutput, 'noteChanges' | 'changesTruncated' | 'createdDirectories' | 'removedDirectories'> = { noteChanges: [], changesTruncated: false, createdDirectories: [], removedDirectories: [] }, notice: string | undefined;
      try { observed = commandNoteChanges(this.deps.notes, scope!, before, await inspectCommandFiles(root, new AbortController().signal, false)); }
      catch { observed.changesTruncated = true; notice = '命令已结束，但未能完整核对文件变更，请刷新笔记本检查。'; }
      this.deps.notes.notifyCommand(scope!);
      const output: CommandOutput = { ...executed, ...observed, ...(notice ? { notice } : {}) };
      if (executed.cancelled) return { success: false, output, error: { code: 'ABORTED', message: '命令已停止；已经发生的文件变更不会自动撤销' } };
      if (executed.timedOut) return { success: false, output, error: { code: 'TIMEOUT', message: '命令执行超时，进程已终止' } };
      if (executed.outputLimit) return { success: false, output, error: { code: 'RESPONSE_TOO_LARGE', message: '命令输出超过上限，进程已终止' } };
      if (executed.exitCode !== 0) return { success: false, output, error: { code: 'COMMAND_FAILED', message: `命令退出码 ${executed.exitCode ?? executed.signal ?? '未知'}，请根据输出处理错误` } };
      return { success: true, output };
    } catch (error) { return toolFailure(error); }
    finally { if (scratch) await rm(scratch, { recursive: true, force: true }).catch(() => {}); this.active = false; }
  }
}
