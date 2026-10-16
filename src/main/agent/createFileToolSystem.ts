import { registerEditingTools } from './editing/registerEditingTools';
import { ToolRegistry } from './ToolRegistry';
import { ToolExecutor } from './ToolExecutor';
import { WorkspaceService } from './WorkspaceService';
import { FileChangeService } from './FileChangeService';
import { PermissionManager, type FileApprovalPrompt, type PermissionManagerOptions } from './PermissionManager';
import { registerFileTools } from './registerFileTools';
import type { NotebookWriter } from './notes/NotebookWriter';
import { registerNotebookTools } from './notes/registerNotebookTools';
import { CommandRunner } from './commands/CommandRunner';
import { registerCommandTools } from './commands/registerCommandTools';
import type { CommandSandbox } from './commands/ProcessSandbox';
import type { ToolPermission } from './types/tool';

export function createFileToolSystem(options?: FileApprovalPrompt | (PermissionManagerOptions & { protectedDirectories?: string[]; readOnly?: boolean; editing?: boolean; commands?: { protectedPaths: string[]; sandbox?: CommandSandbox }; notebookWriter?: (workspaces: WorkspaceService) => NotebookWriter })) {
  const allowed: ToolPermission[] | undefined = typeof options === 'object' && options.readOnly ? ['workspace:read', 'network:read'] : undefined;
  if (allowed && typeof options === 'object') { if (options.editing) allowed.push('conversation:propose'); if (options.notebookWriter) allowed.push('notebook:write'); if (options.commands && options.notebookWriter) allowed.push('workspace:execute'); }
  const registry = new ToolRegistry(allowed);
  const workspaces = new WorkspaceService(typeof options === 'object' ? options.protectedDirectories : undefined);
  const permissions = new PermissionManager(options);
  const changes = new FileChangeService(workspaces, permissions);
  registerFileTools(registry);
  if (typeof options === 'object' && options.editing) registerEditingTools(registry);
  const noteWriter = typeof options === 'object' ? options.notebookWriter?.(workspaces) : undefined;
  if (noteWriter) registerNotebookTools(registry);
  const commandRunner = typeof options === 'object' && options.commands && noteWriter ? new CommandRunner({ workspaces, notes: noteWriter, ...options.commands }) : undefined;
  if (commandRunner) registerCommandTools(registry);
  const executor = new ToolExecutor(registry, workspaces, { fileChanges: changes, permissions, noteWriter, commandRunner });
  return { registry, workspaces, changes, executor, permissions, noteWriter, commandRunner };
}
