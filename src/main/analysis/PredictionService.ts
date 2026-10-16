import type { Settings } from '../../shared/contracts';
import type { ScreenshotAnalysis } from '../../shared/screenshot-understanding';
import { classifyScreenshot } from '../ai/provider';
import { PredictionError } from './PredictionError';
import { requireModelConfiguration } from '../ai/model-configuration';

/** Phase 1: direct classification with the user's model; no official proxy. */
export class PredictionService {
  async predict(settings: Settings, key: string, image: string, signal: AbortSignal): Promise<ScreenshotAnalysis> {
    signal.throwIfAborted();
    const snapshot = structuredClone(settings);
    const enabled = snapshot.predictionBranches.filter(branch => branch.enabled);
    if (!enabled.length) return { contentType: 'unknown', confidence: 0, matchedBranchId: null, recommendedAction: 'ask-ai' };
    try { requireModelConfiguration(snapshot, key); }
    catch { throw new PredictionError({ stage: 'vision', reason: 'configuration' }); }
    try {
      const result = await classifyScreenshot(snapshot, key, image, signal);
      signal.throwIfAborted();
      return { ...result, matchedBranchId: result.matchedBranchId ?? null, recommendedAction: result.matchedBranchId ?? 'ask-ai' };
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof PredictionError) throw error;
      throw new PredictionError({ stage: 'vision', reason: 'invalid_response' });
    }
  }
}
