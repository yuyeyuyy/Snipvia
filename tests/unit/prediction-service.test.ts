import { afterEach, describe, expect, it, vi } from 'vitest';
import { PredictionService } from '../../src/main/analysis/PredictionService';
import { requestPredictionJson } from '../../src/main/ai/json-request';
import { defaults } from '../../src/shared/contracts';
import { autoActionRouter } from '../../src/main/analysis/auto-action-router';

afterEach(() => vi.unstubAllGlobals());
const settings = { ...defaults, provider: 'custom' as const, endpoint: 'http://127.0.0.1:9191/v1', model: 'synthetic-vision' };
const result = { contentType: 'code', confidence: 0.95, matchedBranchId: 'explain-code', signals: { hasSchedule: false } };
function mock(content: unknown = result, finish = 'stop') {
  const fetcher = vi.fn().mockImplementation(async () => Response.json({ choices: [{ finish_reason: finish, message: { content: JSON.stringify(content) } }] }));
  vi.stubGlobal('fetch', fetcher); return fetcher;
}

describe('local-first prediction', () => {
  it('uses only the user endpoint and crop, never cookies, execution prompts or notebook references', async () => {
    const fetcher = mock();
    const snapshot = { ...settings, predictionBranches: settings.predictionBranches.map(branch => ({ ...branch, prompt: 'PRIVATE_EXECUTION_PROMPT', notebookId: '10000000-0000-4000-8000-000000000001' })) };
    const predicted = await new PredictionService().predict(snapshot, 'synthetic-user-key', 'selected-crop-only', new AbortController().signal);
    expect(autoActionRouter.getAutoAction(predicted).id).toBe('explain-code');
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe(settings.endpoint + '/chat/completions'); expect(init.credentials).toBe('omit'); expect(init.redirect).toBe('error');
    expect(init.headers.Cookie).toBeUndefined(); expect(init.body).not.toMatch(/PRIVATE_EXECUTION_PROMPT|10000000-0000|synthetic-user-key/);
    expect(JSON.parse(init.body).messages[1].content[1].image_url.url).toBe('selected-crop-only');
  });
  it('requires a key for hosted presets and performs no request without configuration', async () => {
    const fetcher = mock();
    await expect(new PredictionService().predict(defaults, '', 'crop', new AbortController().signal)).rejects.toThrow('模型与设置');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('skips the model if every branch is disabled', async () => {
    const fetcher = mock();
    const predicted = await new PredictionService().predict({ ...settings, predictionBranches: settings.predictionBranches.map(branch => ({ ...branch, enabled: false })) }, '', 'crop', new AbortController().signal);
    expect(predicted.matchedBranchId).toBeNull(); expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([undefined, 'translate', 'custom:786412d8-f0ea-470c-9211-2092994a85cc'])('rejects incomplete, out-of-set or unknown branch IDs: %s', async matchedBranchId => {
    mock({ ...result, matchedBranchId });
    await expect(new PredictionService().predict(settings, '', 'crop', new AbortController().signal)).rejects.toThrow('响应格式异常');
  });
  it.each(['length', 'content_filter', 'tool_calls'])('does not execute partial or unexpected completions: %s', async finish => {
    mock(result, finish);
    await expect(new PredictionService().predict(settings, '', 'crop', new AbortController().signal)).rejects.toThrow('响应格式异常');
  });
  it('respects an explicit no-match, confidence and schedule signal', async () => {
    for (const candidate of [{ ...result, matchedBranchId: null }, { ...result, confidence: 0.64 }, { ...result, matchedBranchId: 'create-schedule', signals: { hasSchedule: false } }]) {
      mock(candidate);
      const predicted = await new PredictionService().predict(settings, '', 'crop', new AbortController().signal);
      expect(autoActionRouter.getAutoAction(predicted).id).toBe('ask-ai');
    }
  });
  it('preserves caller cancellation and discards a late result', async () => {
    const abort = new AbortController();
    vi.stubGlobal('fetch', async () => { abort.abort(new Error('synthetic cancellation')); return Response.json({ choices: [{ message: { content: JSON.stringify(result) } }] }); });
    await expect(new PredictionService().predict(settings, '', 'crop', abort.signal)).rejects.toThrow('synthetic cancellation');
  });
});

describe('bounded prediction transport', () => {
  it.each([401, 403, 404, 429, 500])('reports safe HTTP metadata without reflecting model errors: %s', async status => {
    vi.stubGlobal('fetch', async () => new Response('PRIVATE_KEY_AND_SCREENSHOT', { status }));
    const error = await requestPredictionJson(settings.endpoint, {}, new AbortController().signal).catch(error => error);
    if (!(error instanceof Error)) throw new Error('Expected a safe prediction error');
    expect(error.message).toContain(`HTTP ${status}`); expect(error.message).not.toContain('PRIVATE');
  });
  it.each(['invalid-json', 'oversized', 'invalid-utf8'])('rejects unsafe response bodies: %s', async mode => {
    const body = mode === 'oversized' ? 'x'.repeat(131_073) : mode === 'invalid-utf8' ? Uint8Array.from([0xff]) : '{"unfinished":';
    vi.stubGlobal('fetch', async () => new Response(body));
    await expect(requestPredictionJson(settings.endpoint, {}, new AbortController().signal)).rejects.toThrow('响应格式异常');
  });
  it('times out a stalled body and cancels its reader', async () => {
    const cancel = vi.fn();
    vi.stubGlobal('fetch', async () => new Response(new ReadableStream({ cancel })));
    await expect(requestPredictionJson(settings.endpoint, {}, new AbortController().signal, 20)).rejects.toThrow('调用超时');
    expect(cancel).toHaveBeenCalledOnce();
  });
});
