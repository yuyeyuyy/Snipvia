import { describe, expect, it } from 'vitest';
import { agentActivity, isInlineWebStep, timelineSteps } from '../../src/renderer/src/agent/activity';
import type { AgentRunView, AgentStepView } from '../../src/shared/agent/execution';

const step: AgentStepView = { id: 'search', toolName: 'web_search', title: '搜索网页', detail: 'Electron capture', webTarget: 'Electron capture', state: 'tool_running' };
const run = (changes: Partial<AgentRunView> = {}): AgentRunView => ({ runId: 'run', captureId: 'capture', question: 'task', messageIndex: 0,
  sequence: 0, saved: false, state: 'thinking', finished: false, steps: [], ...changes });
describe('Agent live status line', () => {
  it('目录与笔记写入显示正在查看、正在编辑', () => {
    const directory = { ...step, toolName: 'list_directory', detail: '.', webTarget: undefined };
    expect(agentActivity(run({ state: 'tool_running', steps: [directory] }))?.label).toBe('正在查看目录');
    const write = { ...step, toolName: 'write_note', detail: '算法/二分.md' };
    expect(agentActivity(run({ state: 'tool_running', steps: [write] }))?.label).toBe('正在编辑 算法/二分.md');
    expect(agentActivity(run({ state: 'completed', finished: true, steps: [write] }))).toBeNull();
  });
  it('replaces thinking with the actual query or host and hides status during answer streaming', () => {
    expect(agentActivity(run())?.label).toBe('正在思考');
    expect(agentActivity(run({ state: 'tool_running', steps: [step] }))).toEqual({ label: '正在联网搜索 Electron capture', web: true });
    const fetched = { ...step, toolName: 'fetch_url', webTarget: 'steamcommunity.com' };
    expect(agentActivity(run({ state: 'tool_running', steps: [fetched] }))?.label).toBe('正在读取 steamcommunity.com');
    expect(agentActivity(run({ steps: [{ ...step, state: 'tool_success' }] }))?.label).toBe('正在思考');
    expect(agentActivity(run({ answerStreaming: true, answer: '正文' }))).toBeNull();
    expect(agentActivity(run({ state: 'completed', finished: true, answer: '正文' }))).toBeNull();
  });
  it('keeps permission review pending, selects the active tool, and labels cancellation', () => {
    expect(isInlineWebStep(step)).toBe(true);
    expect(isInlineWebStep({ ...step, toolName: 'read_file' })).toBe(false);
    expect(isInlineWebStep({ ...step, permission: { requestId: 'p', risk: 'REVIEW', target: 'x', workspacePath: '', description: '', expiresAt: 1, allowedDecisions: ['deny'] } })).toBe(false);
    const pending = { ...step, id: 'later', webTarget: 'later', state: 'tool_pending' as const };
    expect(agentActivity(run({ state: 'tool_running', steps: [step, pending] }))?.label).toBe('正在联网搜索 Electron capture');
    expect(agentActivity(run({ state: 'cancelled', finished: true }))?.label).toBe('已停止');
  });
  it('文件读取、搜索和未知工具共用状态，权限与错误不冒充成功', () => {
    expect(agentActivity(run({ state: 'tool_running', steps: [{ ...step, toolName: 'search_files', detail: '二分', webTarget: undefined }] }))?.label).toBe('正在搜索文件 二分');
    expect(agentActivity(run({ state: 'tool_running', steps: [{ ...step, toolName: 'read_file', detail: '算法.md' }] }))?.label).toBe('正在读取文件 算法.md');
    const other = { ...step, toolName: 'future_tool', title: '检查任务' };
    expect(agentActivity(run({ state: 'tool_running', steps: [other] }))?.label).toBe('正在检查任务');
    expect(agentActivity(run({ state: 'permission_required', steps: [other] }))?.label).toBe('等待你的确认');
    const script = { ...step, toolName: 'run_script', title: '运行脚本', detail: 'python', state: 'permission_required' as const,
      permission: { requestId: 'p', risk: 'DANGEROUS' as const, target: 'print(1)', workspacePath: '', description: '', expiresAt: 1, allowedDecisions: ['deny' as const], command: 'print(1)' } };
    expect(agentActivity(run({ state: 'permission_required', steps: [script] }))?.label).toBe('等待你确认：运行脚本');
    expect(agentActivity(run({ state: 'tool_error', steps: [{ ...other, state: 'tool_error' }] }))?.label).toBe('操作未完成，正在处理');
  });
  it('联网失败不进入时间线也不显示失败状态，其他失败仍保留', () => {
    const failedSearch = { ...step, id: 'a', state: 'tool_error' as const, summary: '域名包含非公网或无效地址，已阻止请求' };
    const failedFetch = { ...step, id: 'b', toolName: 'fetch_url', state: 'tool_error' as const };
    const okSearch = { ...step, id: 'c', state: 'tool_success' as const };
    const failedNote = { ...step, id: 'd', toolName: 'edit_note', title: '编辑笔记', state: 'tool_error' as const };
    const running = { ...step, id: 'e', toolName: 'read_file' };
    expect(timelineSteps([failedSearch, failedFetch, okSearch, failedNote, running]).map((item) => item.id)).toEqual(['c', 'd']);
    expect(agentActivity(run({ state: 'tool_error', steps: [failedSearch] }))).toEqual({ label: '正在思考', web: false });
  });
});
