import { z } from 'zod';
import { branchOperationsSchema, noteProposalInputSchema } from '../../../shared/agent/editing';
import { defineEditingTool, type ToolRegistry } from '../ToolRegistry';

export function registerEditingTools(registry: ToolRegistry) {
  registry.register(defineEditingTool({ name: 'read_edit_context', description: '读取用户在当前对话明确选择的笔记或平面预测规则上下文。只读，不修改文件或配置。返回分块内容与 nextOffset，继续读取直到 complete；全文改写前必须完整读取。', schema: z.strictObject({ offset: z.number().int().min(0).max(1024 * 1024).optional() }), prepare: input => ({ kind: 'read', offset: input.offset }) }));
  registry.register(defineEditingTool({ name: 'propose_note_change', description: '在用户明确选择的 Markdown 上直接保存修改，无需逐次审批，并保留差异和撤销记录。先 read_edit_context；replace 为全文改写，edit 为唯一 SEARCH/REPLACE，append 为补充，create 仅用于新建笔记上下文。必须等待真实保存结果，失败或取消时如实报告，不得声称已写入。', schema: noteProposalInputSchema, prepare: change => ({ kind: 'note', change }) }));
  registry.register(defineEditingTool({ name: 'propose_branch_changes', description: '使用当前平面预测分支 Schema 提出创建、更新、移除自定义分支或调整所选规则顺序的候选操作。不会保存，必须由用户查看差异并确认。不能改变既有 ID、builtin、mode，也不能增加父子关系。', schema: z.strictObject({ operations: branchOperationsSchema }), prepare: input => ({ kind: 'branches', operations: input.operations }) }));
}
