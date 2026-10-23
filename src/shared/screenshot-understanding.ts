// V1 prediction rules retained only for lossless legacy settings compatibility.
import { z } from 'zod';

export const screenshotContentTypes = ['error', 'code', 'text', 'table', 'ui', 'question', 'unknown'] as const;
export const screenshotContentTypeSchema = z.enum(screenshotContentTypes);
export type ScreenshotContentType = z.infer<typeof screenshotContentTypeSchema>;

// Retired prediction IDs remain valid for saved conversation metadata.
export const screenshotActionIds = [
  'explain-error',
  'explain-code',
  'understand-text',
  'analyze-table',
  'analyze-ui',
  'answer-question',
  'describe-image',
  'create-schedule',
  'translate',
  'ocr',
  'ask-ai'
] as const;
export const customScreenshotActionIdSchema = z.string().regex(
  /^custom:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  '自定义预测分支 ID 无效'
);
export const screenshotActionIdSchema = z.union([z.enum(screenshotActionIds), customScreenshotActionIdSchema]);
export type ScreenshotActionId = z.infer<typeof screenshotActionIdSchema>;

export const predictionTriggerTypes = [...screenshotContentTypes, 'schedule'] as const;
export const predictionTriggerSchema = z.enum(predictionTriggerTypes);
export type PredictionTrigger = z.infer<typeof predictionTriggerSchema>;

export const defaultApplicableContent: Record<PredictionTrigger, string> = {
  error: '报错、异常、失败提示或错误堆栈。',
  code: '源代码、代码片段或编程实现。',
  text: '以普通文字、文章或说明为主的内容。',
  table: '表格、数据列表或统计报表。',
  ui: '软件或网页界面。',
  question: '需要回答的问题、题目或求助内容。',
  unknown: '无法归入其他类型的普通图片。',
  schedule: '包含明确日期或时间的会议、预约、行程、活动或截止提醒。'
};

export const predictionBranchSchema = z.object({
  id: screenshotActionIdSchema,
  trigger: predictionTriggerSchema,
  applicableContent: z.string().trim().min(1).max(1000).optional(),
  label: z.string().trim().min(1).max(40),
  runningLabel: z.string().trim().min(1).max(60),
  prompt: z.string().trim().max(4000),
  enabled: z.boolean(),
  builtin: z.boolean(),
  notebookId: z.string().uuid().nullable().optional(),
  mode: z.enum(['ai', 'ocr', 'schedule'])
}).superRefine((value, context) => {
  const custom = value.id.startsWith('custom:');
  if (custom && value.builtin) context.addIssue({ code: 'custom', message: '自定义分支不能标记为内置分支', path: ['builtin'] });
  if (custom && value.mode !== 'ai') context.addIssue({ code: 'custom', message: '自定义分支只支持 AI 操作', path: ['mode'] });
  if (value.mode === 'ai' && !value.prompt) context.addIssue({ code: 'custom', message: 'AI 预测分支需要执行指令', path: ['prompt'] });
});
export type PredictionBranch = z.infer<typeof predictionBranchSchema>;

export function predictionApplicableContent(branch: PredictionBranch): string {
  return branch.applicableContent ?? defaultApplicableContent[branch.trigger];
}

export function needsSemanticPrediction(branches: PredictionBranch[]): boolean {
  return branches.some((branch) => branch.enabled && predictionApplicableContent(branch) !== defaultApplicableContent[branch.trigger]);
}

export const defaultPredictionBranches: PredictionBranch[] = [
  {
    id: 'explain-error', trigger: 'error', label: '解释错误', runningLabel: '正在解释错误…', enabled: true, builtin: true, mode: 'ai',
    prompt: 'Explain what the error means. Identify the likely cause. Provide practical steps to fix it. Be concise.'
  },
  {
    id: 'explain-code', trigger: 'code', label: '解释代码', runningLabel: '正在理解代码…', enabled: true, builtin: true, mode: 'ai',
    prompt: 'Explain what this code does. Point out obvious problems if present. Be concise unless complexity requires detail.'
  },
  {
    id: 'answer-question', trigger: 'question', label: '回答问题', runningLabel: '正在回答问题…', enabled: true, builtin: true, mode: 'ai',
    prompt: 'Answer the question shown in the screenshot directly. Show essential reasoning when it helps.'
  },
  {
    id: 'create-schedule', trigger: 'schedule', label: '创建日程草稿', runningLabel: '正在识别日程…', enabled: true, builtin: true, mode: 'schedule', prompt: ''
  }
];

const retiredPredictionBranchIds = new Set<ScreenshotActionId>([
  'understand-text', 'analyze-table', 'analyze-ui', 'describe-image'
]);

export const predictionBranchListSchema = z.array(predictionBranchSchema).max(30).superRefine((branches, context) => {
  const ids = new Set<string>();
  for (const [index, branch] of branches.entries()) {
    if (ids.has(branch.id)) context.addIssue({ code: 'custom', message: '预测分支 ID 不能重复', path: [index, 'id'] });
    ids.add(branch.id);
  }
}).transform((branches) => branches.filter((branch) => !retiredPredictionBranchIds.has(branch.id)));
