import type { Settings } from '../../shared/contracts';
import type { ScreenshotAnalysis } from '../../shared/screenshot-understanding';
import { classifyScreenshot } from '../ai/provider';
import { PredictionError } from './PredictionError';
import type { PredictionSettings } from '../../shared/prediction-settings';
import { prepareJevImage, type JevImage } from '../ai/jev/image';
import { predictWithJev } from '../ai/jev/JevPredictionClient';
import { requireModelConfiguration } from '../ai/model-configuration';

type JevConfig = Pick<PredictionSettings, 'model'> & { key: string };
/** Optional Jev vision classification; branch execution remains with the existing router. */
export class PredictionService {
  constructor(private readonly options: { jev?: () => JevConfig | null; prepareImage?: (image: string) => JevImage } = {}) {}
  async predict(settings: Settings, key: string | (() => string), image: string, signal: AbortSignal): Promise<ScreenshotAnalysis> {
    signal.throwIfAborted();
    const snapshot = structuredClone(settings);
    const enabled = snapshot.predictionBranches.filter(branch => branch.enabled);
    if (!enabled.length) return { contentType: 'unknown', confidence: 0, matchedBranchId: null, recommendedAction: 'ask-ai' };
    const jev = this.options.jev?.();
    if (jev) return predictWithJev(jev, (this.options.prepareImage ?? prepareJevImage)(image), enabled, signal);
    let modelKey: string;
    try { modelKey = typeof key === 'function' ? key() : key; requireModelConfiguration(snapshot, modelKey); }
    catch { throw new PredictionError({ stage: 'vision', reason: 'configuration' }); }
    try {
      const result = await classifyScreenshot(snapshot, modelKey, image, signal);
      signal.throwIfAborted();
      return { ...result, matchedBranchId: result.matchedBranchId ?? null, recommendedAction: result.matchedBranchId ?? 'ask-ai' };
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof PredictionError) throw error;
      throw new PredictionError({ stage: 'vision', reason: 'invalid_response' });
    }
  }
}
