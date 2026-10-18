import { afterEach, describe, expect, it, vi } from 'vitest';
import { predictWithJev, jevEndpoint } from '../../src/main/ai/jev/JevPredictionClient';
import { jevImageBounds } from '../../src/main/ai/jev/image';
import { PredictionService } from '../../src/main/analysis/PredictionService';
import { PredictionError } from '../../src/main/analysis/PredictionError';
import { autoActionRouter } from '../../src/main/analysis/auto-action-router';
import { defaults } from '../../src/shared/contracts';
import { screenshotContentTypes } from '../../src/shared/screenshot-understanding';

const config = { model: 'jev-1.14.0' as const, key: 'synthetic-jev-key' };
const image = { type: 'image' as const, format: 'png' as const, data_base64: 'c3ludGhldGljLWNyb3A=' };
const signal = () => new AbortController().signal;
const branches = defaults.predictionBranches;
const enabled = branches.filter(branch => branch.enabled);
function choice(keys: string[], selected: string, confidence = 0.95) {
  return { type: 'choice', choice: selected, confidence, probabilities: Object.fromEntries(keys.map(key => [key, key === selected ? 1 : 0])) };
}
function result(selected = `branch_${enabled.findIndex(branch => branch.id === 'explain-code')}`) {
  return { model: config.model, answers: { branch: choice([...enabled.map((_, index) => `branch_${index}`), 'no_match'], selected), content: choice([...screenshotContentTypes], 'code'), schedule: { type: 'noul', noul: 0 } }, usage: { input_tokens: 120, output_tokens: 10 } };
}
function mock(value: unknown = result()) {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json(value));vi.stubGlobal('fetch', fetcher);return fetcher;
}
afterEach(() => vi.unstubAllGlobals());
describe('Jev direct image prediction', () => {
  it('sends only the crop and branch conditions to fixed HTTPS, keeping keys and execution data separate', async () => {
    const fetcher = mock();
    const privateBranches = branches.map(branch => ({ ...branch, prompt: 'PRIVATE_EXECUTION_PROMPT', notebookId: '10000000-0000-4000-8000-000000000001' }));
    const predicted = await predictWithJev(config, image, privateBranches, signal());
    expect(autoActionRouter.getAutoAction(predicted).id).toBe('explain-code');
    expect(fetcher).toHaveBeenCalledOnce();const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(jevEndpoint);expect(init).toMatchObject({ redirect: 'error', credentials: 'omit', headers: { Authorization: 'Bearer synthetic-jev-key', 'TypeSafe-Danger-Zone-Images': 'true' } });
    expect(init.body).not.toMatch(/PRIVATE_EXECUTION_PROMPT|notebookId|10000000|synthetic-jev-key/);
    const body = JSON.parse(String(init.body));expect(body.assets['snipvia-selected-crop']).toEqual(image);
    expect(body.state.screenshot).toBe('snipvia-selected-crop');
    expect(Object.values(body.questions.branch.criteria)).toContainEqual(expect.objectContaining({ applicableContent: '源代码、代码片段或编程实现。' }));
  });
  it('uses Jev without reading the chat model key, and falls back only when Jev is not configured', async () => {
    const fetcher = mock(), key = vi.fn(() => { throw new Error('chat key must not be read'); });
    await expect(new PredictionService({ jev: () => config, prepareImage: () => image }).predict(defaults, key, 'crop', signal())).resolves.toMatchObject({ matchedBranchId: 'explain-code' });
    expect(key).not.toHaveBeenCalled();expect(fetcher).toHaveBeenCalledOnce();
    const llm = vi.fn<typeof fetch>(async () => Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ contentType: 'code', confidence: 0.95, matchedBranchId: 'explain-code' }) } }] }));vi.stubGlobal('fetch', llm);
    await new PredictionService({ jev: () => null }).predict({ ...defaults, provider: 'custom', endpoint: 'http://127.0.0.1:9191/v1' }, '', 'crop', signal());
    expect(llm.mock.calls[0][0]).toBe('http://127.0.0.1:9191/v1/chat/completions');
  });
  it('does not contact any model or read Jev configuration when all branches are disabled', async () => {
    const fetcher = mock(), jev = vi.fn(() => config);
    await new PredictionService({ jev }).predict({ ...defaults, predictionBranches: branches.map(branch => ({ ...branch, enabled: false })) }, '', 'crop', signal());
    expect(jev).not.toHaveBeenCalled();expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([401, 403, 429, 500])('does not silently fall back or reflect upstream content on HTTP %s', async status => {
    const fetcher = vi.fn(async () => new Response('PRIVATE_UPSTREAM_BODY_AND_KEY', { status }));vi.stubGlobal('fetch', fetcher);
    const failure = await new PredictionService({ jev: () => config, prepareImage: () => image }).predict(defaults, 'chat-key', 'crop', signal()).catch(error => error);
    expect(failure).toBeInstanceOf(PredictionError);expect(failure.failure).toMatchObject({ stage: 'branch', upstreamStatus: status });
    expect(failure.message).not.toMatch(/PRIVATE|chat-key|synthetic-jev/);expect(fetcher).toHaveBeenCalledOnce();
  });
  it.each(['model', 'questions', 'type', 'options', 'winner', 'sum', 'nan', 'range', 'usage'])('rejects invalid %s before executing', async mode => {
    const invalid = result();
    if (mode === 'model') invalid.model = 'jev-1.13.0' as typeof invalid.model;
    if (mode === 'questions') Object.assign(invalid.answers, { injected: { type: 'noul', noul: 1 } });
    if (mode === 'type') invalid.answers.branch.type = 'noul';
    if (mode === 'options') invalid.answers.branch.probabilities.extra = 0;
    if (mode === 'winner') invalid.answers.branch.choice = 'no_match';
    if (mode === 'sum') invalid.answers.branch.probabilities[invalid.answers.branch.choice] = 0.5;
    if (mode === 'nan') invalid.answers.schedule.noul = Number.NaN;
    if (mode === 'range') invalid.answers.branch.confidence = 1.1;
    if (mode === 'usage') invalid.usage.input_tokens = -1;
    mock(invalid);await expect(predictWithJev(config, image, branches, signal())).rejects.toMatchObject({ failure: { stage: 'branch', reason: 'invalid_response' } });
  });
  it('preserves no-match, confidence gating, custom branches, and the schedule evidence gate', async () => {
    mock(result('no_match'));expect(autoActionRouter.getAutoAction(await predictWithJev(config, image, branches, signal())).id).toBe('ask-ai');
    const low = result();low.answers.branch.confidence = 0.64;mock(low);expect(autoActionRouter.getAutoAction(await predictWithJev(config, image, branches, signal())).id).toBe('ask-ai');
    const index = enabled.findIndex(branch => branch.mode === 'schedule');
    for (const noul of [0.81, 0.82]) {
      const value = result(`branch_${index}`);value.answers.schedule.noul = noul;mock(value);
      expect(autoActionRouter.getAutoAction(await predictWithJev(config, image, branches, signal())).id).toBe(noul < 0.82 ? 'ask-ai' : enabled[index].id);
    }
    const custom = { ...enabled[0], id: 'custom:10000000-0000-4000-8000-000000000001' as const, builtin: false, label: '发票', applicableContent: '仅报销发票；排除广告' };
    const value = result('branch_0');value.answers.branch = choice(['branch_0', 'no_match'], 'branch_0');mock(value);
    expect(autoActionRouter.getAutoAction(await predictWithJev(config, image, [custom], signal()), [custom]).id).toBe(custom.id);
  });
  it('discards late responses after cancellation', async () => {
    const controller = new AbortController();vi.stubGlobal('fetch', async () => { controller.abort(new Error('cancelled'));return Response.json(result()); });
    await expect(predictWithJev(config, image, branches, controller.signal)).rejects.toThrow('cancelled');
  });
  it.each([[20, 10, 280, 280], [4000, 2000, 1568, 784], [4000, 20, 1568, 280], [300, 400, 300, 400]])('fits a %sx%s crop without stretching or adding screen pixels', (width, height, targetWidth, targetHeight) => {
    expect(jevImageBounds(width, height)).toMatchObject({ width: targetWidth, height: targetHeight });
  });
});
