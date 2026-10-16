import { ToolRegistry } from './ToolRegistry';
import { registerReadOnlyTools } from './registerReadOnlyTools';
import { writeFileTool } from './tools/file/writeFile';
import { editFileTool } from './tools/file/editFile';

export function registerFileTools(registry: ToolRegistry): void {
  registerReadOnlyTools(registry);
  registry.register(writeFileTool);
  registry.register(editFileTool);
}
