import { describe, expect, it, vi } from 'vitest';
import { ScreenshotAnalyzer, analyzeOcrSignals } from '../../src/main/analysis/screenshot-analyzer';
import { autoActionRouter } from '../../src/main/analysis/auto-action-router';
import { PredictionError } from '../../src/main/analysis/PredictionError';
import { defaultApplicableContent, defaultPredictionBranches, needsSemanticPrediction, predictionApplicableContent, predictionBranchSchema } from '../../src/shared/screenshot-understanding';

describe('screenshot analyzer', () => {
  it('always asks the user model, including confident local OCR', async () => {
    const classifyWithVision = vi.fn().mockResolvedValue({ contentType: 'code', confidence: 0.96, matchedBranchId: 'explain-code', signals: { hasSchedule: false } });
    const analyzer = new ScreenshotAnalyzer({ recognizeText: async () => ({ text: 'Error: meeting tomorrow 10:00', confidence: 0.99, lineCount: 1 }), classifyWithVision });
    const result = await analyzer.analyze({ image: 'selected-crop', width: 900, height: 600, predictionBranches: defaultPredictionBranches }, new AbortController().signal);
    expect(result.layer).toBe('vision'); expect(result.analysis.matchedBranchId).toBe('explain-code');
    expect(result.analysis.signals?.hasSchedule).toBe(false); expect(classifyWithVision).toHaveBeenCalledOnce();
  });
  it('keeps safe errors visible and never falls back to OCR actions', async () => {
    for (const error of [new PredictionError({ stage: 'vision', reason: 'auth', upstreamStatus: 401 }), new Error('PRIVATE_KEY_AND_IMAGE')]) {
      const result = await new ScreenshotAnalyzer({ recognizeText: async () => ({ text: 'TypeError: undefined', confidence: 1, lineCount: 1 }), classifyWithVision: async () => { throw error; } })
        .analyze({ image: 'crop', width: 100, height: 100, predictionBranches: defaultPredictionBranches }, new AbortController().signal);
      expect(result.predictionError).toBeDefined(); expect(result.predictionError).not.toContain('PRIVATE');
      expect(autoActionRouter.getAutoAction(result.analysis).id).toBe('ask-ai');
      if (error instanceof PredictionError) expect(result.predictionError).toContain('HTTP 401');
    }
  });
  it.each([
    ['TypeError: value is undefined\nError: request failed', 'error', 'explain-error'],
    ['function total(items) {\n  const sum = items.reduce((a, b) => a + b, 0);\n  return sum;\n}', 'code', 'explain-code'],
    ['为什么这个请求失败？应该怎么修？', 'question', 'answer-question'],
    ['Name  Count  Price\nApple  12  5.20\nPear   8   4.10\nTotal  20  9.30', 'table', 'ask-ai']
  ])('classifies strong OCR signals without a model: %s', (text, contentType, actionId) => {
    const candidate = analyzeOcrSignals(text, { width: 900, height: 600 });
    expect(candidate.contentType).toBe(contentType);
    expect(candidate.confidence).toBeGreaterThanOrEqual(0.78);
    expect(autoActionRouter.recommendedActionId(candidate.contentType)).toBe(actionId);
  });

  it('uses the vision layer only when local and OCR confidence are insufficient', async () => {
    const classifyWithVision = vi.fn().mockResolvedValue({ contentType: 'ui', confidence: 0.93, matchedBranchId: null, signals: { hasUI: true } });
    const analyzer = new ScreenshotAnalyzer({
      recognizeText: vi.fn().mockResolvedValue({ text: '', confidence: 0, lineCount: 0 }),
      classifyWithVision
    });
    const result = await analyzer.analyze({ image: 'fixture', width: 800, height: 600 }, new AbortController().signal);
    expect(classifyWithVision).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ layer: 'vision', analysis: { contentType: 'ui', confidence: 0.93, recommendedAction: 'ask-ai' } });
  });

  it('keeps the best local result if the classifier is unavailable', async () => {
    const analyzer = new ScreenshotAnalyzer({
      recognizeText: vi.fn().mockResolvedValue({ text: 'A short note', confidence: 0.9, lineCount: 1 }),
      classifyWithVision: vi.fn().mockRejectedValue(new Error('offline'))
    });
    const result = await analyzer.analyze({ image: 'fixture', width: 1000, height: 600 }, new AbortController().signal);
    expect(result.layer).toBe('fallback');
    expect(result.analysis.recommendedAction).toBe('ask-ai');
  });

  it('centralizes every default content mapping', () => {
    expect(['error', 'code', 'text', 'table', 'ui', 'question', 'unknown'].map((contentType) =>
      autoActionRouter.recommendedActionId(contentType as Parameters<typeof autoActionRouter.recommendedActionId>[0])))
      .toEqual(['explain-error', 'explain-code', 'ask-ai', 'ask-ai', 'ask-ai', 'answer-question', 'ask-ai']);
  });

  it.each(['text', 'table', 'ui', 'unknown'] as const)('waits for input for %s screenshots unless a custom branch matches', (trigger) => {
    expect(autoActionRouter.resolvePrediction(trigger, defaultPredictionBranches).id).toBe('ask-ai');
    const custom = {
      id: 'custom:786412d8-f0ea-470c-9211-2092994a85cc', trigger,
      label: '自定义处理', runningLabel: '正在处理…', prompt: 'Explain the selected details.',
      enabled: true, builtin: false, mode: 'ai' as const
    };
    expect(autoActionRouter.resolvePrediction(trigger, [...defaultPredictionBranches, custom]).id).toBe(custom.id);
    expect(autoActionRouter.resolvePrediction(trigger, [...defaultPredictionBranches, { ...custom, enabled: false }]).id).toBe('ask-ai');
  });

  it('does not offer or execute retired built-in actions', () => {
    const available = autoActionRouter.availableActions(defaultPredictionBranches);
    for (const id of ['understand-text', 'analyze-table', 'analyze-ui', 'describe-image'] as const) {
      expect(available.some((action) => action.id === id)).toBe(false);
      expect(() => autoActionRouter.getAction(id)).toThrow('未知截图操作');
    }
  });

  it('does not execute a disabled prediction branch and prioritizes an enabled custom branch', () => {
    const withoutCode = defaultPredictionBranches.map((branch) => branch.id === 'explain-code' ? { ...branch, enabled: false } : branch);
    expect(autoActionRouter.resolvePrediction('code', withoutCode).id).toBe('ask-ai');
    expect(autoActionRouter.availableActions(withoutCode).some((action) => action.id === 'explain-code')).toBe(false);
    const custom = {
      id: 'custom:786412d8-f0ea-470c-9211-2092994a85cc', trigger: 'code' as const,
      label: '生成测试', runningLabel: '正在生成测试…', prompt: 'Generate focused tests.',
      enabled: true, builtin: false, mode: 'ai' as const
    };
    expect(autoActionRouter.resolvePrediction('code', [...defaultPredictionBranches, custom]).id).toBe(custom.id);
  });

  it('detects an actionable schedule only when date or time and intent occur together', () => {
    expect(analyzeOcrSignals('下周三下午 3 点开产品评审会', { width: 900, height: 500 }).signals.hasSchedule).toBe(true);
    expect(analyzeOcrSignals('Error at 15:30: request failed', { width: 900, height: 500 }).signals.hasSchedule).toBeUndefined();
  });

  it('uses edited built-in labels, instructions and triggers for both automatic and manual actions', () => {
    const branches = defaultPredictionBranches.map((branch) => branch.id === 'explain-code'
      ? { ...branch, label: '审查代码', runningLabel: '正在审查代码…', trigger: 'question' as const, prompt: 'Find bugs and suggest focused fixes.' }
      : branch);
    const edited = { id: 'explain-code', label: '审查代码', runningLabel: '正在审查代码…', prompt: 'Find bugs and suggest focused fixes.' };
    expect(autoActionRouter.getAction('explain-code', branches)).toEqual(edited);
    expect(autoActionRouter.resolvePrediction('question', branches)).toEqual(edited);
    expect(autoActionRouter.resolvePrediction('code', branches).id).toBe('ask-ai');
    const available = autoActionRouter.availableActions(branches);
    expect(available.filter((action) => action.id === 'explain-code')).toEqual([edited]);
    expect(available.some((action) => action.id === 'ocr')).toBe(true);
    expect(() => autoActionRouter.getAction('explain-code', branches.map((branch) => ({ ...branch, enabled: false })))).toThrow('已关闭');
  });
  it('loads legacy type rules as editable descriptions and bounds non-empty custom criteria', () => {
    const code = defaultPredictionBranches.find((branch) => branch.id === 'explain-code')!;
    expect(predictionApplicableContent(predictionBranchSchema.parse(code))).toBe(defaultApplicableContent.code);
    expect(needsSemanticPrediction(defaultPredictionBranches)).toBe(false);
    expect(predictionBranchSchema.parse({ ...code, applicableContent: '  仅 Python 代码。  ' }).applicableContent).toBe('仅 Python 代码。');
    expect(predictionBranchSchema.safeParse({ ...code, applicableContent: ' ' }).success).toBe(false);
    expect(predictionBranchSchema.safeParse({ ...code, applicableContent: '字'.repeat(1001) }).success).toBe(false);
    expect(needsSemanticPrediction([{ ...code, enabled: false, applicableContent: '仅 Python 代码。' }])).toBe(false);
  });
  it('evaluates custom criteria even when OCR confidently identifies a fixed type', async () => {
    const branches = defaultPredictionBranches.map((branch) => branch.id === 'explain-code' ? { ...branch, applicableContent: '仅 Python 代码，不包括 JavaScript。' } : branch);
    const classifyWithVision = vi.fn().mockResolvedValue({ contentType: 'code', confidence: 0.99, matchedBranchId: null });
    const analyzer = new ScreenshotAnalyzer({
      recognizeText: vi.fn().mockResolvedValue({ text: 'function total(items) {\n const sum = items.reduce((a, b) => a + b, 0);\n return sum;\n}', confidence: 0.99, lineCount: 4 }),
      classifyWithVision
    });
    const result = await analyzer.analyze({ image: 'fixture', width: 900, height: 600, predictionBranches: branches }, new AbortController().signal);
    expect(classifyWithVision).toHaveBeenCalledOnce();
    expect(result.layer).toBe('vision');
    expect(result.analysis.recommendedAction).toBe('ask-ai');
    expect(autoActionRouter.getAutoAction(result.analysis, branches).id).toBe('ask-ai');
  });
  it.each(['offline', 'missing-match'])('does not bypass custom exclusions when classification returns %s', async (failure) => {
    const branches = defaultPredictionBranches.map((branch) => ({ ...branch, applicableContent: '只匹配指定项目中的异常，不包括其他项目。' }));
    const classifyWithVision = failure === 'offline' ? vi.fn().mockRejectedValue(new Error('offline')) : vi.fn().mockResolvedValue({ contentType: 'error', confidence: 0.99 });
    const result = await new ScreenshotAnalyzer({
      recognizeText: vi.fn().mockResolvedValue({ text: 'TypeError: value is undefined\nError: request failed', confidence: 0.99, lineCount: 2 }), classifyWithVision
    }).analyze({ image: 'fixture', width: 900, height: 600, predictionBranches: branches }, new AbortController().signal);
    expect(result.layer).toBe('fallback');
    expect(result.analysis.matchedBranchId).toBeNull();
    expect(result.analysis.recommendedAction).toBe('ask-ai');
    expect(autoActionRouter.getAutoAction(result.analysis, branches).id).toBe('ask-ai');
  });
  it('routes by the matched branch ID rather than its former type and checks enabled state and confidence', () => {
    const branches = defaultPredictionBranches.map((branch) => ({ ...branch, applicableContent: '需要提取报销信息的发票或收据。' }));
    const analysis = { contentType: 'table' as const, confidence: 0.96, matchedBranchId: 'explain-code' as const, recommendedAction: 'ask-ai' as const, signals: { hasSchedule: true } };
    expect(autoActionRouter.getAutoAction(analysis, branches).id).toBe('explain-code');
    for (const invalid of [{ ...analysis, confidence: 0.64 }, { ...analysis, matchedBranchId: null }, { ...analysis, matchedBranchId: 'translate' as const }]) {
      expect(autoActionRouter.getAutoAction(invalid, branches).id).toBe('ask-ai');
    }
    expect(autoActionRouter.getAutoAction(analysis, branches.map((branch) => ({ ...branch, enabled: false }))).id).toBe('ask-ai');
    expect(autoActionRouter.getAutoAction({ ...analysis, matchedBranchId: 'create-schedule', signals: {} }, branches).id).toBe('ask-ai');
    expect(autoActionRouter.getAutoAction({ ...analysis, matchedBranchId: 'create-schedule' }, branches).id).toBe('create-schedule');
  });
  it('uses the user model for defaults and skips classification when all branches are disabled', async () => {
    const recognizeText = vi.fn().mockResolvedValue({ text: 'TypeError: value is undefined\nError: request failed', confidence: 0.99, lineCount: 2 });
    const classifyWithVision = vi.fn().mockResolvedValue({ contentType: 'error', confidence: 0.99, matchedBranchId: 'explain-error' }); const analyzer = new ScreenshotAnalyzer({ recognizeText, classifyWithVision });
    const context = { image: 'fixture', width: 900, height: 600, predictionBranches: defaultPredictionBranches };
    const result = await analyzer.analyze(context, new AbortController().signal);
    expect(autoActionRouter.getAutoAction(result.analysis).id).toBe('explain-error');
    const disabled = await analyzer.analyze({ ...context, predictionBranches: defaultPredictionBranches.map((branch) => ({ ...branch, enabled: false })) }, new AbortController().signal);
    expect(disabled.analysis.matchedBranchId).toBeNull();
    expect(recognizeText).toHaveBeenCalledOnce(); expect(classifyWithVision).toHaveBeenCalledOnce();
  });
});
