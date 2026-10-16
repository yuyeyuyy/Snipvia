import { z } from 'zod';
import { defineTool } from '../../ToolRegistry';

export const listDirectoryTool = defineTool({
  name: 'list_directory',
  description: '查看 workspace 相对目录的直接子项，包含名称、相对路径和类型。path 默认为根目录；不递归、不跟随符号链接。',
  permission: 'workspace:read',
  schema: z.strictObject({
    path: z.string().min(1).max(4096).default('.'),
    maxEntries: z.number().int().min(1).max(1000).default(200)
  }),
  async execute(input, context) {
    return { success: true, output: await context.workspace.listDirectory(input.path, input.maxEntries) };
  }
});
