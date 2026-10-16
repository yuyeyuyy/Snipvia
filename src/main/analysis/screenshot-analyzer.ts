import type { PredictionBranch, ScreenshotAnalysis, ScreenshotContentType } from '../../shared/screenshot-understanding';
import { needsSemanticPrediction, screenshotAnalysisSchema } from '../../shared/screenshot-understanding';
import { autoActionRouter } from './auto-action-router';
import { PredictionError } from './PredictionError';

export type OcrResult = {
  text: string;
  confidence: number;
  lineCount: number;
  durationMs?: number;
};

export type ScreenshotAnalysisContext = {
  image: string;
  width: number;
  height: number;
  sourceApplication?: string;
  predictionBranches?: PredictionBranch[];
};

export type ScreenshotAnalyzerResult = {
  predictionError?: string;
  analysis: ScreenshotAnalysis;
  ocrText: string;
  layer: 'local' | 'ocr' | 'vision' | 'decision' | 'fallback';
};

type ScreenshotAnalyzerDependencies = {
  recognizeText: (image: string, signal: AbortSignal) => Promise<OcrResult | null>;
  classifyWithVision: (image: string, signal: AbortSignal) => Promise<Pick<ScreenshotAnalysis, 'contentType' | 'confidence' | 'signals' | 'matchedBranchId'>>;
  classifyWithServer?: (image: string, signal: AbortSignal) => Promise<ScreenshotAnalysis | null>;
  visionThreshold?: number;
};

type Candidate = { contentType: ScreenshotContentType; confidence: number; signals: NonNullable<ScreenshotAnalysis['signals']> };

const errorPattern = /\b(?:error|exception|traceback|failed|failure|undefined|typeerror|referenceerror|syntaxerror|fatal|panic|npm\s+err|errno|stack trace)\b|错误|异常|失败|崩溃|无法|报错/giu;
const codeWordPattern = /\b(?:function|const|let|var|class|interface|import|export|from|def|return|async|await|public|private|struct|enum|throw|catch|if|else|for|while)\b/g;
const questionPattern = /[?？]|\b(?:why|how|what|when|where|which|who|can|does|is|are)\b|为什么|怎么|如何|什么|是否|能否|哪[个些里]|求证|证明/giu;
const scheduleDatePattern = /\b(?:today|tomorrow|tonight|next\s+(?:mon|tue|wed|thu|fri|sat|sun)|\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?)\b|今天|明天|后天|大后天|今晚|下周|周[一二三四五六日天]|星期[一二三四五六日天]|\d{1,2}月\d{1,2}[日号]/giu;
const scheduleTimePattern = /\b(?:[01]?\d|2[0-3]):[0-5]\d\b|(?:上午|下午|晚上|中午|早上|凌晨)\s*\d{1,2}(?:[:：点时][0-5]?\d?)?|\d{1,2}\s*(?:点|时)/giu;
const scheduleIntentPattern = /\b(?:meeting|appointment|deadline|due|schedule|calendar|remind|submit|review|interview|flight|train)\b|会议|开会|预约|行程|出差|截止|最晚|提交|评审|面试|航班|车次|提醒|日程|活动/giu;

function clamp(value: number) {
  return Math.max(0, Math.min(1, value));
}

function occurrences(text: string, pattern: RegExp) {
  pattern.lastIndex = 0;
  return [...text.matchAll(pattern)].length;
}

function tableScore(lines: string[]) {
  if (lines.length < 3) return 0;
  const structured = lines.filter((line) => /\S(?:\t+| {2,}|\s*\|\s*)\S/.test(line));
  const numeric = lines.filter((line) => (line.match(/(?:^|\s)[+-]?(?:\d+[,.]?)+%?(?=\s|$)/g)?.length ?? 0) >= 2);
  const separators = lines.filter((line) => /^\s*[-+|: ]{5,}\s*$/.test(line));
  return clamp((structured.length / lines.length) * 0.65 + (numeric.length / lines.length) * 0.25 + (separators.length ? 0.18 : 0));
}

function codeScore(text: string, lines: string[]) {
  if (!text) return 0;
  const codeWords = occurrences(text, codeWordPattern);
  const symbols = (text.match(/[{}()[\];=<>:]/g) ?? []).length;
  const nonWhitespace = Math.max(1, text.replace(/\s/g, '').length);
  const indented = lines.filter((line) => /^(?: {2,}|\t)\S/.test(line)).length;
  const codeLikeLines = lines.filter((line) => /(?:=>|[{};]|\w+\([^)]*\)|^\s*(?:#include|import |from |def |class |func ))/.test(line)).length;
  return clamp(codeWords * 0.08 + Math.min(0.32, symbols / nonWhitespace * 2.6) +
    Math.min(0.18, indented / Math.max(1, lines.length)) + Math.min(0.3, codeLikeLines / Math.max(1, lines.length)));
}

function detectLanguage(text: string) {
  const cjk = (text.match(/[\u3400-\u9fff]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  if (cjk > latin * 0.25) return 'zh';
  if (latin > 0) return 'en';
  return undefined;
}

export function analyzeOcrSignals(text: string, dimensions: { width: number; height: number }, sourceApplication?: string): Candidate {
  const normalized = text.replace(/\r/g, '').trim();
  const lines = normalized.split('\n').map((line) => line.trimEnd()).filter(Boolean);
  const errorMatches = occurrences(normalized, errorPattern);
  const code = codeScore(normalized, lines);
  const table = tableScore(lines);
  const questions = occurrences(normalized, questionPattern);
  const scheduleDates = occurrences(normalized, scheduleDatePattern);
  const scheduleTimes = occurrences(normalized, scheduleTimePattern);
  const scheduleIntents = occurrences(normalized, scheduleIntentPattern);
  const hasSchedule = (scheduleDates > 0 && (scheduleTimes > 0 || scheduleIntents > 0)) || (scheduleTimes > 0 && scheduleIntents > 0);
  const developerAppPrior = /\b(?:xcode|visual studio code|vscode|cursor|terminal|iterm|warp)\b/i.test(sourceApplication ?? '') ? 0.08 : 0;
  const error = clamp(errorMatches * 0.24 + (errorMatches > 0 && code > 0.35 ? 0.25 : 0) + developerAppPrior);
  const question = clamp(questions * 0.25 + (questions > 0 && normalized.length < 800 ? 0.28 : 0));
  const textCoverage = clamp(normalized.length / Math.max(160, (dimensions.width * dimensions.height) / 3200));
  const textConfidence = clamp(0.52 + textCoverage * 0.22 + (lines.length >= 3 ? 0.05 : 0));
  const signals = {
    ...(code >= 0.48 ? { hasCode: true } : {}),
    ...(errorMatches > 0 ? { hasError: true } : {}),
    ...(table >= 0.48 ? { hasTable: true } : {}),
    ...(questions > 0 ? { hasQuestion: true } : {}),
    ...(hasSchedule ? { hasSchedule: true } : {}),
    ...(detectLanguage(normalized) ? { detectedLanguage: detectLanguage(normalized) } : {})
  };

  if (error >= 0.64) return { contentType: 'error', confidence: clamp(0.69 + error * 0.29), signals };
  if (table >= 0.58 && code < 0.62) return { contentType: 'table', confidence: clamp(0.64 + table * 0.32), signals };
  if (code + developerAppPrior >= 0.58) return { contentType: 'code', confidence: clamp(0.64 + (code + developerAppPrior) * 0.32), signals };
  if (question >= 0.52) return { contentType: 'question', confidence: clamp(0.67 + question * 0.28), signals };
  if (normalized.length >= 24) return { contentType: 'text', confidence: textConfidence, signals };
  const panoramic = dimensions.width / Math.max(1, dimensions.height) > 2.5;
  return { contentType: 'unknown', confidence: panoramic ? 0.3 : 0.22, signals };
}

function finalize(candidate: Candidate, matchedBranchId?: ScreenshotAnalysis['matchedBranchId']): ScreenshotAnalysis {
  return screenshotAnalysisSchema.parse({
    ...candidate,
    recommendedAction: matchedBranchId === undefined ? autoActionRouter.recommendedActionId(candidate.contentType) : matchedBranchId ?? 'ask-ai',
    ...(matchedBranchId !== undefined ? { matchedBranchId } : {})
  });
}

export class ScreenshotAnalyzer {
  private readonly visionThreshold: number;

  constructor(private readonly dependencies: ScreenshotAnalyzerDependencies) {
    this.visionThreshold = dependencies.visionThreshold ?? 0.78;
  }

  async analyze(context: ScreenshotAnalysisContext, signal: AbortSignal): Promise<ScreenshotAnalyzerResult> {
    if (signal.aborted) throw signal.reason;
    const semanticPrediction = needsSemanticPrediction(context.predictionBranches ?? []);
    if (context.predictionBranches && !context.predictionBranches.some((branch) => branch.enabled)) {
      return { analysis: finalize(analyzeOcrSignals('', context), null), ocrText: '', layer: 'local' };
    }
    let ocr: OcrResult | null = null;
    try {
      ocr = await this.dependencies.recognizeText(context.image, signal);
    } catch (error) {
      if (signal.aborted) throw error;
    }
    const local = analyzeOcrSignals(ocr?.text ?? '', context, context.sourceApplication);
    if (this.dependencies.classifyWithServer) {
      try {
        const prediction = await this.dependencies.classifyWithServer(context.image, signal);
        if (signal.aborted) throw signal.reason;
        if (prediction) return { analysis: screenshotAnalysisSchema.parse(prediction), ocrText: ocr?.text ?? '', layer: 'decision' };
      } catch (error) {
        if (signal.aborted) throw error;
        // A failed central prediction must not execute a local branch or send the
        // screenshot to a second, implicitly selected prediction provider.
        return { analysis: finalize(local, null), ocrText: ocr?.text ?? '', layer: 'fallback', predictionError: error instanceof PredictionError ? error.message : '服务端预测未完成，请检查网络与后台配置后重试。' };
      }
    }
    if (!semanticPrediction && local.confidence >= this.visionThreshold) {
      return { analysis: finalize(local), ocrText: ocr?.text ?? '', layer: ocr?.text ? 'ocr' : 'local' };
    }
    try {
      const vision = await this.dependencies.classifyWithVision(context.image, signal);
      if (semanticPrediction && vision.matchedBranchId === undefined) throw new Error('截图预测没有返回适用分支');
      const booleanSignal = (key: 'hasCode' | 'hasError' | 'hasTable' | 'hasQuestion' | 'hasUI' | 'hasSchedule') =>
        local.signals[key] || vision.signals?.[key] ? true : undefined;
      const analysis = finalize({
        contentType: vision.contentType,
        confidence: vision.confidence,
        signals: {
          ...(booleanSignal('hasCode') ? { hasCode: true } : {}),
          ...(booleanSignal('hasError') ? { hasError: true } : {}),
          ...(booleanSignal('hasTable') ? { hasTable: true } : {}),
          ...(booleanSignal('hasQuestion') ? { hasQuestion: true } : {}),
          ...(booleanSignal('hasUI') ? { hasUI: true } : {}),
          ...(booleanSignal('hasSchedule') ? { hasSchedule: true } : {}),
          ...((vision.signals?.detectedLanguage ?? local.signals.detectedLanguage) ? { detectedLanguage: vision.signals?.detectedLanguage ?? local.signals.detectedLanguage } : {})
        }
      }, vision.matchedBranchId);
      return { analysis, ocrText: ocr?.text ?? '', layer: 'vision' };
    } catch (error) {
      if (signal.aborted) throw error;
      return { analysis: finalize(local, semanticPrediction ? null : undefined), ocrText: ocr?.text ?? '', layer: 'fallback' };
    }
  }
}
