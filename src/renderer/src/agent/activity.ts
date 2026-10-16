import type { AgentRunView, AgentStepView } from '../../../shared/agent/execution';

export function isWebTool(name: string): boolean { return ['web_search', 'fetch_url', 'read_web_chunk'].includes(name); }
/**
 * Timeline rows: steps that already happened or need the user; the live action is the status
 * line. Failed web searches/reads are hidden: the model receives the error and retries or
 * answers without them, so they are noise to the user.
 */
export function timelineSteps(steps: AgentStepView[]): AgentStepView[] {
  return steps.filter((step) => step.state !== 'tool_pending' && step.state !== 'tool_running' &&
    !(step.state === 'tool_error' && isWebTool(step.toolName)));
}
export function isInlineWebStep(step: AgentStepView): boolean {
  return isWebTool(step.toolName) && !step.permission && !step.diff;
}

/** The live status line under the timeline: 正在思考 / 正在联网搜索 / 正在编辑 … No fabricated site for global search. */
export function agentActivity(run: AgentRunView): { label: string; web: boolean } | null {
  if (run.state === 'completed' || run.answerStreaming) return null;
  if (run.state === 'cancelled') return { label: '已停止', web: false };
  if (run.finished) return { label: '未完成', web: false };
  const step = run.steps.find((item) => item.state === 'tool_running' || item.state === 'permission_required')
    ?? run.steps.find((item) => item.state === 'tool_pending') ?? run.steps.at(-1);
  if (run.state === 'permission_required' || step?.permission) return { label: step?.permission ? `等待你确认：${step.title}` : '等待你的确认', web: false };
  if (run.compacting) return { label: '正在压缩较早的对话', web: false };
  if (run.state === 'thinking') return { label: '正在思考', web: false };
  if (step && ['run_command', 'run_script'].includes(step.toolName)) {
    if (step.state === 'tool_error') return { label: '命令未完成，正在处理', web: false };
    if (step.state === 'tool_success') return { label: '正在思考', web: false };
    const language = ({ javascript: 'JavaScript', python: 'Python', shell: 'Shell' } as Record<string, string>)[step.detail];
    return { label: step.toolName === 'run_command' ? '正在执行命令' : language ? `正在运行 ${language} 脚本` : '正在运行脚本', web: false };
  }
  if (step && ['write_note', 'edit_note'].includes(step.toolName)) return { label: step.state === 'tool_error' ? '笔记编辑未完成，正在处理' : step.state === 'tool_success' ? '正在思考' : `正在编辑 ${step.detail}`, web: false };
  if (step?.toolName === 'list_directory') return { label: step.state === 'tool_success' ? '正在思考' : step.state === 'tool_error' ? '目录读取未完成，正在处理' : step.detail === 'list_directory' || step.detail === '.' ? '正在查看目录' : `正在查看目录 ${step.detail}`, web: false };
  if (step && ['read_file', 'search_files'].includes(step.toolName)) {
    if (step.state === 'tool_error') return { label: '文件操作未完成，正在处理', web: false };
    if (step.state === 'tool_success') return { label: '正在思考', web: false };
    const detail = step.detail === step.toolName || step.detail === '.' ? '' : ` ${step.detail}`;
    return { label: `${step.toolName === 'read_file' ? '正在读取文件' : '正在搜索文件'}${detail}`, web: false };
  }
  if (step && isInlineWebStep(step)) {
    if (step.state === 'tool_error') return { label: '正在思考', web: false }; // Web failures stay silent.
    if (step.state === 'tool_success') return { label: '正在思考', web: false };
    const prefix = step.toolName === 'web_search' ? '正在联网搜索' : step.toolName === 'read_web_chunk' ? '正在继续读取' : '正在读取';
    return { label: `${prefix} ${step.webTarget || (step.toolName === 'web_search' ? '网页' : '网页内容')}`, web: true };
  }
  return { label: step ? step.state === 'tool_error' ? '操作未完成，正在处理' : step.state === 'tool_success' ? '正在思考' : `正在${step.title}` : '正在思考', web: false };
}
