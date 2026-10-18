import type { AgentDiffView, AgentRunView, AgentStepView } from '../../../shared/agent/execution';
import type { AgentEvent } from '../types/agent';
import type { ToolResult } from '../types/tool';
import { utf8Prefix } from '../web/operation';
import { collectWebSources } from './WebSourceCollector';
import { noteChangeSchema } from '../../../shared/agent/note-writing';

const labels: Record<string, string> = {
  read_edit_context: '读取编辑上下文', propose_note_change: '编辑笔记', propose_branch_changes: '生成分支修改建议',
  read_file: '读取文件', list_directory: '查看目录', search_files: '搜索文件', write_file: '写入文件', edit_file: '编辑文件',
  web_search: '搜索网页', fetch_url: '读取网页', read_web_chunk: '继续读取网页', run_command: '执行命令', run_script: '运行脚本', write_note: '编辑笔记', edit_note: '编辑笔记'
};
function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function detail(args: string, name: string): string {
  try {
    const value = record(JSON.parse(args));
    return String(name === 'run_script' ? value.language ?? '' : name === 'search_files' ? value.keyword ?? value.name ?? value.glob ?? value.path ?? '' : value.path ?? value.query ?? value.url ?? value.command ?? '').slice(0, 500);
  } catch { return '正在检查参数'; }
}
function summary(name: string, result: ToolResult): string {
  if (!result.success) return result.error.code === 'APPROVAL_DENIED' ? '已拒绝，未执行' : result.error.message.slice(0, 500);
  const output = record(result.output);
  if (output.truncated) return '已完成 · 结果已截断';
  if (name === 'read_file' && typeof output.byteLength === 'number') return output.byteLength < 1024 ? `${output.byteLength} B` : `${(output.byteLength / 1024).toFixed(1)} KB`;
  if (name === 'web_search' && Array.isArray(output.results)) return `找到 ${output.results.length} 条结果`;
  if (name === 'search_files' && Array.isArray(output.matches)) return `找到 ${output.matches.length} 个文件`;
  if (name === 'list_directory' && Array.isArray(output.entries)) return `${output.entries.length} 个项目`;
  if (name === 'run_command' || name === 'run_script') return `退出码 ${output.exitCode ?? '未知'}${typeof output.stdout === 'string' && output.stdout.trim() ? ` · ${output.stdout.trim().slice(-240)}` : ''}`;
  if (name === 'write_file' || name === 'edit_file') return '文件已更新';
  if ((name === 'write_note' || name === 'edit_note') && typeof output.added === 'number' && typeof output.removed === 'number') return `+${output.added} −${output.removed}`;
  if (name === 'fetch_url' && typeof output.title === 'string' && output.title.trim()) return output.title.trim().slice(0, 120);
  return '已完成';
}
/** Only explicit UI data and provider-filtered response text leave Main. */
export class ExecutionPresenter {
  readonly diffs = new Map<string, AgentDiffView>();
  private toolTurn = false;
  private readonly pageHosts = new Map<string, string>();
  constructor(readonly view: AgentRunView) {}
  accept(event: AgentEvent): boolean {
    if (event.runId !== this.view.runId || event.sequence <= this.view.sequence || this.view.finished) return false;
    this.view.sequence = event.sequence;
    if (event.type === 'context_prepared' || event.type === 'step_completed') return false;
    if (event.type === 'assistant_delta') {
      if (this.toolTurn || !event.text) return false;
      this.view.answer = (this.view.answer ?? '') + event.text;
      this.view.answerStreaming = true;
      return true;
    }
    if (event.type === 'tool_call_delta') {
      this.toolTurn = true;
      const changed = !!this.view.answer;
      this.view.answer = undefined; this.view.answerStreaming = false;
      return changed;
    }
    if (event.type === 'llm_started' || event.type === 'run_started') {
      this.toolTurn = false; this.view.answer = undefined; this.view.answerStreaming = false;
      this.view.state = 'thinking';
    }
    else if (event.type === 'llm_completed') {
      for (const call of event.response.toolCalls ?? []) if (call.name !== 'todo_write') this.ensureStep(call.id, call.name, call.arguments);
      if (event.response.toolCalls?.length) {
        this.toolTurn = true; this.view.answer = undefined; this.view.answerStreaming = false;
        this.view.state = 'tool_pending';
      }
      else return false; // A final answer is published only after Runtime validates/completes the turn.
    } else if (event.type === 'context_compacting' || event.type === 'context_compacted') {
      this.view.compacting = event.type === 'context_compacting';
    } else if (event.type === 'todo_updated') {
      this.view.todos = structuredClone(event.todos);
    } else if ((event.type === 'tool_started' && event.call.name === 'todo_write') || (event.type === 'tool_completed' && event.name === 'todo_write')) {
      return false; // Planning is shown as the todo list, not as a tool row.
    } else if (event.type === 'tool_started') {
      const step = this.ensureStep(event.call.id, event.call.name, event.call.arguments);
      step.executionId = event.executionId; step.state = 'tool_pending'; this.view.state = 'tool_pending';
    } else if (event.type === 'tool_running') {
      const step = this.view.steps.find((item) => item.executionId === event.executionId);
      if (step) step.state = 'tool_running'; this.view.state = 'tool_running';
    } else if (event.type === 'permission_request') {
      const step = this.view.steps.find((item) => item.executionId === event.request.toolCallId);
      if (!step) return false;
      const request = event.request;
      step.state = 'permission_required'; this.view.state = 'permission_required';
      step.permission = { requestId: request.requestId, risk: request.risk, target: request.target, workspacePath: request.workspacePath,
        description: `${request.reasons.join('；')}。${request.scopeDescription}`, expiresAt: request.expiresAt,
        argumentsText: request.argumentsText?.slice(0, 8000), command: request.command ? request.target : undefined,
        allowedDecisions: request.allowedDecisions.filter((value): value is 'allow_once' | 'allow_session' | 'deny' => value !== 'always_allow') };
      if (request.preview) {
        const { path, diff } = request.preview;
        const lines = diff.split('\n');
        step.diff = { path, added: lines.filter((line) => line.startsWith('+') && !line.startsWith('+++')).length,
          removed: lines.filter((line) => line.startsWith('-') && !line.startsWith('---')).length };
        const bounded = utf8Prefix(diff, 512 * 1024);
        this.diffs.set(step.id, { path, diff: bounded, truncated: bounded !== diff });
        // Retain a bounded set of review artifacts; UI can report an expired older preview.
        while ([...this.diffs.values()].reduce((total, item) => total + Buffer.byteLength(item.diff), 0) > 2 * 1024 * 1024) this.diffs.delete(this.diffs.keys().next().value!);
      }
    } else if (event.type === 'permission_resolved') {
      const step = this.view.steps.find((item) => item.permission?.requestId === event.requestId);
      if (step) {
        step.permission = undefined;
        step.state = ['allow_once', 'allow_session', 'always_allow'].includes(event.outcome) ? 'tool_pending' : event.outcome === 'cancelled' ? 'cancelled' : 'tool_error';
        step.summary = event.outcome === 'deny' ? '已拒绝，未执行' : undefined;
      }
    } else if (event.type === 'tool_completed') {
      const step = this.ensureStep(event.callId, event.name, '{}');
      step.state = event.result.success ? 'tool_success' : event.result.error.code === 'ABORTED' ? 'cancelled' : 'tool_error';
      step.permission = undefined; step.summary = summary(event.name, event.result); step.durationMs = event.result.metadata?.durationMs;
      if (event.result.success) this.view.sources = collectWebSources(this.view.sources ?? [], event.name, event.result.output);
      if (event.result.success && ['write_note', 'edit_note', 'propose_note_change'].includes(event.name)) {
        const parsed = noteChangeSchema.safeParse(event.name === 'propose_note_change' ? record(event.result.output).noteChange : event.result.output);
        if (parsed.success) {
          this.view.noteChanges ??= [];
          const index = this.view.noteChanges.findIndex(change => change.id === parsed.data.id);
          if (index >= 0) this.view.noteChanges[index] = parsed.data; else this.view.noteChanges.push(parsed.data);
        }
      }
      if (['run_command', 'run_script'].includes(event.name)) {
        for (const change of event.noteChanges ?? []) {
          const parsed = noteChangeSchema.safeParse(change); if (!parsed.success) continue;
          this.view.noteChanges ??= [];
          const index = this.view.noteChanges.findIndex(value => value.id === parsed.data.id);
          if (index >= 0) this.view.noteChanges[index] = parsed.data; else this.view.noteChanges.push(parsed.data);
        }
      }
      if (event.result.success && event.name === 'fetch_url') {
        const output = record(event.result.output);
        const metadata = record(output.metadata);
        const host = webHost(output.url);
        if (host && typeof metadata.contentId === 'string') this.pageHosts.set(metadata.contentId, host);
      }
      this.view.state = step.state;
    } else if (event.type === 'run_finished') {
      this.view.state = event.status === 'completed' ? 'completed' : event.status === 'cancelled' ? 'cancelled' : 'tool_error';
      // The service marks finished only after saving; Stop must not race a new run with persistence.
      this.view.notice = event.status === 'completed' ? undefined : event.message;
      this.view.answerStreaming = false;
      for (const step of this.view.steps) if (['tool_pending', 'permission_required', 'tool_running'].includes(step.state)) {
        step.state = event.status === 'cancelled' ? 'cancelled' : 'tool_error'; step.permission = undefined;
        step.summary = event.status === 'cancelled' ? '已停止' : '未完成';
      }
    } else return false;
    return true;
  }
  private ensureStep(id: string, name: string, args: string): AgentStepView {
    let step = this.view.steps.find((item) => item.id === id);
    if (!step) {
      step = { id, toolName: name, title: labels[name] ?? (name.startsWith('mcp_') ? '调用外部工具' : '调用工具'), detail: detail(args, name) || name, state: 'tool_pending' };
      try {
        const value = record(JSON.parse(args));
        if (name === 'fetch_url') step.webTarget = webHost(value.url);
        if (name === 'web_search' && typeof value.query === 'string') step.webTarget = value.query.replace(/[\r\n\t]+/g, ' ').slice(0, 200);
        if (name === 'read_web_chunk' && typeof value.contentId === 'string') step.webTarget = this.pageHosts.get(value.contentId);
      } catch { /* Malformed arguments are handled by ToolExecutor. */ }
      this.view.steps.push(step);
    }
    return step;
  }
}

function webHost(value: unknown): string | undefined {
  try { const url = new URL(String(value)); return ['https:', 'http:'].includes(url.protocol) ? url.hostname : undefined; }
  catch { return undefined; }
}
