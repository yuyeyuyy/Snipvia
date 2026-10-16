import {
  defaultPredictionBranches,
  type PredictionBranch,
  type PredictionTrigger,
  type ScreenshotAction,
  type ScreenshotActionId,
  type ScreenshotAnalysis,
  type ScreenshotContentType
} from '../../shared/screenshot-understanding';

function actionFromBranch(branch: PredictionBranch): ScreenshotAction {
  return {
    id: branch.id,
    label: branch.label,
    runningLabel: branch.runningLabel,
    prompt: branch.prompt,
    ...(branch.mode !== 'ai' ? { local: true } : {})
  };
}

export const screenshotActions: readonly ScreenshotAction[] = [
  ...defaultPredictionBranches.map(actionFromBranch),
  {
    id: 'translate', label: '翻译', runningLabel: '正在翻译…',
    prompt: 'Translate the meaningful text in the screenshot into Simplified Chinese. Preserve structure and technical terms.'
  },
  { id: 'ocr', label: '提取文字', runningLabel: '正在提取文字…', prompt: '', local: true },
  { id: 'ask-ai', label: '向 AI 提问', runningLabel: '等待你的问题', prompt: '' }
] as const;

const actionByContentType: Record<ScreenshotContentType, ScreenshotActionId> = {
  error: 'explain-error',
  code: 'explain-code',
  text: 'ask-ai',
  table: 'ask-ai',
  ui: 'ask-ai',
  question: 'answer-question',
  unknown: 'ask-ai'
};

export class AutoActionRouter {
  getAutoAction(analysis: ScreenshotAnalysis, branches: PredictionBranch[] = defaultPredictionBranches): ScreenshotAction {
    if (analysis.matchedBranchId !== undefined) {
      const branch = branches.find((candidate) => candidate.id === analysis.matchedBranchId && candidate.enabled);
      if (!branch || analysis.confidence < 0.65 || (branch.mode === 'schedule' && !analysis.signals?.hasSchedule)) return this.getAction('ask-ai', branches);
      return actionFromBranch(branch);
    }
    const contentAction = this.resolvePrediction(analysis.confidence < 0.65 ? 'unknown' : analysis.contentType, branches);
    const scheduleAction = analysis.signals?.hasSchedule ? this.resolvePrediction('schedule', branches) : null;
    return scheduleAction && scheduleAction.id !== 'ask-ai' ? scheduleAction : contentAction;
  }

  getAction(id: ScreenshotActionId, branches: PredictionBranch[] = defaultPredictionBranches): ScreenshotAction {
    if (id.startsWith('custom:') || defaultPredictionBranches.some((branch) => branch.id === id)) {
      const branch = branches.find((candidate) => candidate.id === id && candidate.enabled);
      if (!branch) throw new Error('该截图操作已关闭或不存在');
      return actionFromBranch(branch);
    }
    const action = screenshotActions.find((candidate) => candidate.id === id);
    if (!action) throw new Error(`未知截图操作：${id}`);
    return action;
  }

  resolvePrediction(trigger: PredictionTrigger, branches: PredictionBranch[]): ScreenshotAction {
    const enabled = branches.filter((branch) => branch.enabled && branch.trigger === trigger);
    const branch = enabled.find((candidate) => !candidate.builtin) ?? enabled[0];
    return branch ? actionFromBranch(branch) : this.getAction('ask-ai', branches);
  }

  availableActions(branches: PredictionBranch[]): ScreenshotAction[] {
    return [
      ...branches.filter((branch) => branch.enabled).map(actionFromBranch),
      ...screenshotActions
        .filter((action) => !defaultPredictionBranches.some((branch) => branch.id === action.id))
        .map((action) => ({ ...action }))
    ];
  }

  recommendedActionId(contentType: ScreenshotContentType): ScreenshotActionId {
    return actionByContentType[contentType];
  }
}

export const autoActionRouter = new AutoActionRouter();
