import { z } from 'zod';
import { agentNotePathSchema, type NoteChangeIntent } from '../../../shared/agent/note-writing';
import { defineNotebookTool, type ToolRegistry } from '../ToolRegistry';

export function registerNotebookTools(registry: ToolRegistry) {
  const content = z.string().min(1).max(256 * 1024);
  registry.register(defineNotebookTool({
    name: 'write_note', description: '在当前选择的笔记本创建或追加 Markdown 学习笔记。AI 可以提出修改，但写入前必须展示完整差异并等待用户逐次确认；用户拒绝或取消时不得声称已保存。create 不能覆盖已有笔记，append 只能补充已存在的笔记。仅使用已存在的父目录，未创建主题目录时写入笔记本根目录。尊重用户不记录的要求。',
    schema: z.strictObject({ path: agentNotePathSchema, mode: z.enum(['create', 'append']), content }),
    prepare: input => ({ kind: input.mode, path: input.path, content: input.content })
  }));
  registry.register(defineNotebookTool({
    name: 'edit_note', description: '修改当前选择笔记本中的已有 Markdown。先读取目标文件，用唯一匹配的 SEARCH/REPLACE 更新知识点，保留其他内容。不能删除文件、访问隐藏目录或附件。必须先等待用户确认完整差异，成功写入后才能声称已编辑。',
    schema: z.strictObject({ path: agentNotePathSchema, edits: z.array(z.strictObject({ search: z.string().min(1).max(256 * 1024), replace: z.string().max(256 * 1024) })).min(1).max(20) }),
    prepare: input => ({ kind: 'edit', ...input }) as NoteChangeIntent
  }));
}
