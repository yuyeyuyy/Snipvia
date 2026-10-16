import { ToolRegistry } from './ToolRegistry';
import { readFileTool } from './tools/file/readFile';
import { listDirectoryTool } from './tools/file/listDirectory';
import { searchFilesTool } from './tools/file/searchFiles';

export function registerReadOnlyTools(registry: ToolRegistry): void {
  registry.register(readFileTool);
  registry.register(listDirectoryTool);
  registry.register(searchFilesTool);
}
