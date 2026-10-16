import type { CommandRiskSummary, PermissionRisk } from '../../../shared/agent/permission';
import type { FileChangePreview } from '../../../shared/agent-file-change';
import type { ExternalToolIdentity, ToolPermission } from '../types/tool';
import { workspaceRelativePath } from '../policies/pathPolicy';
import { CommandRiskAnalyzer } from './CommandRiskAnalyzer';
import { assessNotebookCommand, assessNotebookScript } from './NotebookCommandPolicy';

/** Created only by trusted Main code, never accepted from permission IPC or the LLM. */
export interface PermissionTarget {
  toolCallId: string;
  toolName: string;
  workspaceId: string;
  workspacePath: string;
  workspaceIdentity?: string;
  permission?: ToolPermission;
  input: unknown;
  external?: ExternalToolIdentity;
  preview?: FileChangePreview;
}
export interface PermissionAssessment {
  risk: PermissionRisk;
  reasons: string[];
  target: string;
  blocked?: 'PATH_OUTSIDE_WORKSPACE' | 'PERMISSION_DENIED';
  command?: CommandRiskSummary;
}
const safe = new Set(['read_file', 'list_directory', 'search_files', 'web_search', 'fetch_url', 'read_web_chunk']);
const review = new Set(['write_file', 'edit_file', 'mkdir', 'move_file', 'undo_file_change']);
const fileTools = new Set(['read_file', 'list_directory', 'search_files', ...review, 'delete_file']);

export class PermissionPolicy {
  constructor(private readonly commands = new CommandRiskAnalyzer()) {}
  assess(target: PermissionTarget): PermissionAssessment {
    if (target.permission === 'external:execute' || target.external) {
      return { risk: 'DANGEROUS', target: target.external ? `${target.external.server} / ${target.external.tool}` : target.toolName,
        reasons: ['外部 MCP 进程可能访问本机文件、网络及账户；Snipvia 的工作区隔离不能约束该进程',
          '启动确认覆盖该配置的连接与自动重连；工具调用另行确认，服务端只读声明不降低权限，禁止永久授权'] };
    }
    const input = target.input && typeof target.input === 'object' && !Array.isArray(target.input)
      ? target.input as Record<string, unknown> : {};
    const paths: string[] = [];
    if (fileTools.has(target.toolName) || target.toolName === 'run_command' || target.permission?.startsWith('workspace:')) {
      for (const key of ['path', 'source', 'destination', 'cwd']) {
        if (typeof input[key] !== 'string') continue;
        try { paths.push(workspaceRelativePath(input[key])); }
        catch { return { risk: 'DANGEROUS', reasons: ['禁止通过权限确认绕过工作区边界'], target: input[key], blocked: 'PATH_OUTSIDE_WORKSPACE' }; }
      }
    }
    if (target.preview) {
      try { paths.push(workspaceRelativePath(target.preview.path)); }
      catch { return { risk: 'DANGEROUS', reasons: ['文件提案越出工作区'], target: target.preview.path, blocked: 'PATH_OUTSIDE_WORKSPACE' }; }
    }
    if (target.permission === 'workspace:execute') {
      // Sandboxed notebook execution: literal read/organize commands run directly,
      // scripts and everything else wait for the user. Never hard-blocked here because
      // the OS sandbox, not this static check, is the enforcement boundary.
      const script = target.toolName === 'run_script';
      const source = typeof input[script ? 'code' : 'command'] === 'string' ? String(input[script ? 'code' : 'command']) : '';
      const verdict = script ? assessNotebookScript(String(input.language ?? ''), source) : assessNotebookCommand(source);
      return { risk: verdict.risk, reasons: verdict.reasons, target: source || (script ? '无效脚本' : '无效命令'),
        command: { risk: verdict.risk, reasons: verdict.reasons, blocked: false } };
    }
    if (target.toolName === 'run_command') {
      const command = this.commands.analyze(typeof input.command === 'string' ? input.command : '');
      // run_command is always a privileged operation. Intrinsic command risk is additional information.
      return { risk: 'DANGEROUS', reasons: ['执行进程可访问当前用户的系统资源，必须确认', ...command.reasons],
        target: typeof input.command === 'string' ? input.command : '无效命令', command,
        ...(command.blocked ? { blocked: 'PERMISSION_DENIED' as const } : {}) };
    }
    const resource = [...new Set(paths)].join(' → ') || target.toolName;
    if (target.permission === 'network:read' && safe.has(target.toolName)) {
      return { risk: 'SAFE', target: resource, reasons: ['只读公网工具；仍执行网络地址、下载大小与会话范围检查'] };
    }
    if (target.preview?.operation === 'delete' || target.toolName === 'delete_file') {
      return { risk: 'DANGEROUS', target: resource, reasons: ['将删除文件，不能永久授权'] };
    }
    if (review.has(target.toolName) || target.permission === 'workspace:write') {
      return { risk: 'REVIEW', target: resource, reasons: ['将修改工作区中的文件'] };
    }
    // Trusted registered read-only extensions receive only the WorkspaceAccess read capability.
    if (safe.has(target.toolName) || target.permission === 'workspace:read') {
      return { risk: 'SAFE', target: resource, reasons: ['只读操作；仍受工作区及工具自身边界检查约束'] };
    }
    return { risk: 'DANGEROUS', target: resource, reasons: ['未知工具默认按高风险处理'] };
  }
}
