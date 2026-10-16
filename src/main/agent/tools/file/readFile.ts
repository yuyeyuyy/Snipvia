import { z } from 'zod';
import { defineTool } from '../../ToolRegistry';

export const readFileTool = defineTool({
  name: 'read_file',
  description: '读取已授权 workspace 内的 UTF-8 文本文件。path 使用相对路径，不跟随符号链接；超出 maxBytes 时返回错误。',
  permission: 'workspace:read',
  schema: z.strictObject({
    path: z.string().min(1).max(4096),
    maxBytes: z.number().int().min(1).max(1024 * 1024).default(256 * 1024)
  }),
  async execute(input, context) {
    return { success: true, output: await context.workspace.readText(input.path, input.maxBytes) };
  }
});
