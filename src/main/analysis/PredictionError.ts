import { predictionFailureMessage, predictionFailureSchema, type PredictionFailure } from '../../shared/prediction-failure';

export class PredictionError extends Error {
  readonly failure: PredictionFailure;
  constructor(failure: PredictionFailure) {
    const checked = predictionFailureSchema.parse(failure);
    super(predictionFailureMessage(checked)); this.name = 'PredictionError'; this.failure = checked;
  }
}
