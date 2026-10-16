import { z } from 'zod';
import { defineFileMutationTool } from '../../ToolRegistry';

export const editFileTool = defineFileMutationTool({
  name: 'edit_file',
  description: '使用 SEARCH / REPLACE 提议局部修改现有 UTF-8 文件。edits 按顺序应用；每个 search 必须非空且唯一匹配（含空白）。支持 LF/CRLF 输入并保留原文件换行。生成完整 diff，经用户确认或匹配已明确授权的相同变更后提交，冲突时拒绝覆盖。',
  schema: z.strictObject({
    path: z.string().min(1).max(4096),
    edits: z.array(z.strictObject({ search: z.string().min(1).max(64 * 1024), replace: z.string().max(64 * 1024) })).min(1).max(32)
  }),
  prepare: (input) => ({ kind: 'edit', ...input })
});
