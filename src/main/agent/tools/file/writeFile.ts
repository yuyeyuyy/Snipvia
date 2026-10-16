import { z } from 'zod';
import { defineFileMutationTool } from '../../ToolRegistry';

export const writeFileTool = defineFileMutationTool({
  name: 'write_file',
  description: '提议创建或完整替换 workspace 内的 UTF-8 文件。生成 diff，经用户确认或匹配已明确授权的相同变更后才写入；父目录必须已存在。局部修改请使用 edit_file。',
  schema: z.strictObject({ path: z.string().min(1).max(4096), content: z.string().max(256 * 1024) }),
  prepare: (input) => ({ kind: 'write', ...input })
});
