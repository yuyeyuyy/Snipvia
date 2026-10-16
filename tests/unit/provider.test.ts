import { afterEach, describe, expect, it, vi } from 'vitest';
import { askModel, classifyScreenshot, extractScheduleEvents, parseScheduleExtraction, parseScreenshotClassification, streamModel } from '../../src/main/ai/provider';
import { defaults } from '../../src/shared/contracts';
import { providerFor } from '../../src/shared/providers';

afterEach(() => vi.unstubAllGlobals());
describe('vision provider', () => {
  it.each(['openai', 'anthropic', 'gemini', 'xai', 'qwen', 'deepseek', 'kimi', 'zhipu', 'doubao', 'qianfan', 'hunyuan', 'siliconflow', 'openrouter'] as const)('通过 %s 的官方接口发送裁剪图、历史和独立密钥', async (id) => {
    const preset = providerFor(id), settings = { ...defaults, provider: id, endpoint: preset.endpoint, model: preset.models[0].id };
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '合成图片描述' } }] })));
    vi.stubGlobal('fetch', fetch);
    await askModel(settings, 'synthetic-provider-key', 'data:image/jpeg;base64,fixture', [{ role: 'assistant', content: '此前回答' }], '解释截图', new AbortController().signal);
    const [url, init] = fetch.mock.calls[0], body = JSON.parse(init.body);
    expect(url).toBe(preset.endpoint + '/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer synthetic-provider-key');
    expect(init.redirect).toBe('error'); expect(body.messages[1].content[1].image_url.url).toBe('data:image/jpeg;base64,fixture');
    expect(body.messages[2]).toEqual({ role: 'assistant', content: '此前回答' });
    expect(init.body).not.toContain('synthetic-provider-key'); expect(body).not.toHaveProperty('extra_body');
    if (['deepseek', 'kimi', 'zhipu', 'doubao'].includes(id)) expect(body.thinking).toEqual({ type: 'disabled' });
    else expect(body).not.toHaveProperty('thinking');
    if (id === 'kimi') expect(body.temperature).toBe(0.6);
  });
  it('Kimi 分类和日程提取均关闭思考，分类不用不被支持的 temperature=0', async () => {
    const preset = providerFor('kimi'), settings = { ...defaults, provider: preset.id, endpoint: preset.endpoint, model: 'kimi-k2.6' };
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: '{"contentType":"unknown","confidence":0.5,"matchedBranchId":null}' } }] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: '{"events":[]}' } }] })));
    vi.stubGlobal('fetch', fetch);
    await classifyScreenshot(settings, '', 'fixture', new AbortController().signal);
    await expect(extractScheduleEvents(settings, '', 'fixture', '2026-10-06T00:00:00Z', 'Asia/Shanghai', new AbortController().signal)).rejects.toThrow('日程字段');
    for (const [, init] of fetch.mock.calls) expect(JSON.parse(init.body)).toMatchObject({ thinking: { type: 'disabled' }, temperature: 0.6 });
  });
  it.each(['qwen3.8-max', 'qwen3.8-flash', 'qwen3.8-max-0902', 'qwen3.8-max-2026-09-02'])(
    'sends image and history in non-thinking mode for %s', async (model) => {
      const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '截图中的内容' } }] })));
      vi.stubGlobal('fetch', fetch);
      const history = [{ role: 'user' as const, content: '总结截图' }, { role: 'assistant' as const, content: '之前的摘要' }];
      const answer = await askModel({ ...defaults, provider: 'qwen', endpoint: providerFor('qwen').endpoint, model }, 'qwen-test-key', 'data:image/jpeg;base64,fixture', history, '进一步解释', new AbortController().signal);
      expect(answer).toBe('截图中的内容');
      const [url, options] = fetch.mock.calls[0];
      expect(url).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');
      const body = JSON.parse(options.body);
      expect(body).toMatchObject({ model, stream: false, enable_thinking: false, preserve_thinking: false });
      expect(body.extra_body).toBeUndefined();
      expect(body.messages[1].content[1].image_url.url).toBe('data:image/jpeg;base64,fixture');
      expect(body.messages.slice(2, 4)).toEqual(history);
    }
  );
  it.each([
    { provider: 'qwen' as const, model: 'qwen-vl-plus' },
    { provider: 'openai' as const, model: 'gpt-4.1-mini' },
    { provider: 'gemini' as const, model: 'gemini-3.8-flash' },
    { provider: 'custom' as const, model: 'qwen3.8-max' }
  ])('keeps vendor-specific parameters out of $provider / $model requests', async (setting) => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '回答' } }] })));
    vi.stubGlobal('fetch', fetch);
    await askModel({ ...defaults, ...setting }, '', 'fixture', [], '问题', new AbortController().signal);
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body).not.toHaveProperty('enable_thinking');
    expect(body).not.toHaveProperty('preserve_thinking');
  });
  it('sends the selected image and bounded history without following redirects', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '图片摘要' } }] })));
    vi.stubGlobal('fetch', fetch);
    expect(await askModel(defaults, 'test-key', 'data:image/jpeg;base64,fixture', [], '解释图片', new AbortController().signal)).toBe('图片摘要');
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe(`${defaults.endpoint}/chat/completions`);
    expect(options.redirect).toBe('error');
    expect(JSON.parse(options.body).messages[1].content[1].image_url.url).toBe('data:image/jpeg;base64,fixture');
  });
  it('places a continued screenshot after the previous messages so the model treats it as new context', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '继续回答' } }] })));
    vi.stubGlobal('fetch', fetch);
    const history = [
      { role: 'user' as const, content: '上一张图里是什么？' },
      { role: 'assistant' as const, content: '上一张图是设置界面。' }
    ];
    await askModel(defaults, 'test-key', 'data:image/jpeg;base64,new', history, '这张呢？', new AbortController().signal, undefined, true);
    const messages = JSON.parse(fetch.mock.calls[0][1].body).messages;
    expect(messages.slice(1, 3)).toEqual(history);
    expect(messages[3].content[0].text).toContain('刚补充的新截图');
    expect(messages[3].content[1].image_url.url).toBe('data:image/jpeg;base64,new');
    expect(messages[4]).toEqual({ role: 'user', content: '这张呢？' });
  });
  it('does not expose provider response bodies in errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('private upstream details', { status: 401 })));
    await expect(askModel(defaults, '', 'fixture', [], '问题', new AbortController().signal)).rejects.toThrow('HTTP 401');
  });
  it('rejects unsupported or empty responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [] }))));
    await expect(askModel(defaults, '', 'fixture', [], '问题', new AbortController().signal)).rejects.toThrow('空回答');
  });
  it('rejects a non-ASCII credential before constructing the authorization header', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(askModel(defaults, 'example（不要复制）', 'fixture', [], '问题', new AbortController().signal)).rejects.toThrow('API Key 含有中文符号');
    await expect(extractScheduleEvents(defaults, 'example（不要复制）', 'fixture', '2026-09-17T00:00:00Z', 'Asia/Shanghai', new AbortController().signal)).rejects.toThrow('API Key 含有中文符号');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('passes cancellation through to the request', async () => {
    const controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => reject(new Error('cancelled')));
    })));
    const pending = askModel(defaults, '', 'fixture', [], '问题', controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow('cancelled');
  });
  it('parses only supported structured screenshot classifications', () => {
    expect(parseScreenshotClassification('```json\n{"contentType":"ui","confidence":0.91,"signals":{"hasUI":true}}\n```'))
      .toEqual({ contentType: 'ui', confidence: 0.91, signals: { hasUI: true } });
    expect(parseScreenshotClassification('{"contentType":"text","confidence":0.88,"signals":{"hasSchedule":true}}'))
      .toEqual({ contentType: 'text', confidence: 0.88, signals: { hasSchedule: true } });
    expect(() => parseScreenshotClassification('{"contentType":"invoice","confidence":0.9}')).toThrow('不支持');
    expect(() => parseScreenshotClassification('This is code')).toThrow('有效 JSON');
  });
  it('classifies using enabled applicability rules, without leaking execution instructions or notebook bindings', async () => {
    const branches = defaults.predictionBranches.map((branch) => ({ ...branch,
      applicableContent: branch.id === 'explain-code' ? '仅 TypeScript 异步代码，不包括 Java。' : undefined,
      enabled: branch.id !== 'explain-error', prompt: 'PRIVATE_EXECUTION_PROMPT', notebookId: '10000000-0000-4000-8000-000000000001'
    }));
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ contentType: 'text', confidence: 0.92, matchedBranchId: 'explain-code' }) } }] })));
    vi.stubGlobal('fetch', fetch);
    expect(await classifyScreenshot({ ...defaults, predictionBranches: branches }, 'private-key', 'fixture', new AbortController().signal)).toMatchObject({ matchedBranchId: 'explain-code' });
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.messages[0]).toMatchObject({ role: 'system' });
    expect(body.messages[0].content).toContain('including exclusions');
    const rules = JSON.parse(body.messages[1].content[0].text).branches;
    expect(rules).toContainEqual({ id: 'explain-code', applicableContent: '仅 TypeScript 异步代码，不包括 Java。', custom: false, requiresSchedule: false });
    expect(rules.some((branch: { id: string }) => branch.id === 'explain-error')).toBe(false);
    expect(JSON.stringify(body)).not.toMatch(/PRIVATE_EXECUTION_PROMPT|private-key|10000000-0000/);
    expect(body.messages[1].content[1].image_url.url).toBe('fixture');
  });
  it('rejects missing, unknown and disabled matches, while accepting an explicit no-match', () => {
    const branches = defaults.predictionBranches.map((branch) => branch.id === 'explain-code' ? { ...branch, enabled: false } : branch);
    const candidate = { contentType: 'code', confidence: 0.99 };
    for (const matchedBranchId of [undefined, 'explain-code', 'translate', 'custom:786412d8-f0ea-470c-9211-2092994a85cc']) {
      expect(() => parseScreenshotClassification(JSON.stringify({ ...candidate, matchedBranchId }), branches)).toThrow('预测分支');
    }
    expect(parseScreenshotClassification(JSON.stringify({ ...candidate, matchedBranchId: null }), branches).matchedBranchId).toBeNull();
  });
  it('streams OpenAI-compatible SSE deltas in order', async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"第一"}}]}\n\n'));
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"段"}}]}\n\ndata: [DONE]\n\n'));
        controller.close();
      }
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { headers: { 'Content-Type': 'text/event-stream' } })));
    const deltas: string[] = [];
    expect(await streamModel(defaults, '', 'fixture', [], '解释', new AbortController().signal, (delta) => deltas.push(delta))).toBe('第一段');
    expect(deltas).toEqual(['第一', '段']);
  });
  it('accepts a complete JSON response from compatible services that ignore stream mode', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '完整回答' } }] }), {
      headers: { 'Content-Type': 'application/json' }
    })));
    const deltas: string[] = [];
    expect(await streamModel(defaults, '', 'fixture', [], '解释', new AbortController().signal, (delta) => deltas.push(delta))).toBe('完整回答');
    expect(deltas).toEqual(['完整回答']);
  });
  it('parses fenced and unfenced structured schedule output', () => {
    const event = { kind: 'event' as const, title: '产品评审', allDay: false, startAt: '2026-09-18T14:00:00+08:00', endAt: '2026-09-18T15:00:00+08:00',
      startDate: null, endDate: null, dueAt: null, dueDate: null, timezone: 'Asia/Shanghai', location: '3A 会议室', people: ['小王'], notes: '', unresolvedFields: [], warnings: ['结束时间由上下文推断'] };
    expect(parseScheduleExtraction(JSON.stringify({ events: [event] }))).toEqual([event]);
    expect(parseScheduleExtraction(`\`\`\`json\n${JSON.stringify({ events: [event, { ...event, title: '复盘' }] })}\n\`\`\``)).toHaveLength(2);
    expect(() => parseScheduleExtraction('{broken')).toThrow('有效的日程 JSON');
  });
  it('keeps a completion deadline as a deadline instead of inventing a time range', () => {
    const deadline = { kind: 'deadline', title: '完成季度方案', allDay: true, startAt: null, endAt: null, startDate: null, endDate: null,
      dueAt: null, dueDate: '2026-09-30', timezone: 'Asia/Shanghai', location: '', people: ['项目组'], notes: '9 月 30 日前完成', unresolvedFields: [], warnings: [] };
    expect(parseScheduleExtraction(JSON.stringify({ events: [deadline] }))[0]).toEqual(deadline);
  });
  it('sends the extraction marker, capture time, timezone and image', async () => {
    const event = { kind: 'event' as const, title: '午餐', allDay: false, startAt: '2026-09-17T12:00:00+08:00', endAt: '2026-09-17T13:00:00+08:00',
      startDate: null, endDate: null, dueAt: null, dueDate: null, timezone: 'Asia/Shanghai', location: '望江楼', people: [], notes: '', unresolvedFields: [], warnings: [] };
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ events: [event] }) } }] })));
    vi.stubGlobal('fetch', fetch);
    expect(await extractScheduleEvents(defaults, 'key', 'data:image/jpeg;base64,event', '2026-09-16T08:00:00.000Z', 'Asia/Shanghai', new AbortController().signal, '仅提取会议，参会人写入备注。')).toEqual([event]);
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.messages[0].content[0].text).toContain('EVENT_EXTRACTION_SCHEMA');
    expect(body.messages[0].content[0].text).toContain('2026-09-16T08:00:00.000Z');
    expect(body.messages[0].content[0].text).toContain('该时区今天：2026-09-16；明天：2026-09-17；后天：2026-09-18');
    expect(body.messages[0].content[0].text).toContain('某日之前完成');
    expect(body.messages[0].content[0].text).toContain('仅提取会议，参会人写入备注。');
    expect(body.messages[0].content[1].image_url.url).toBe('data:image/jpeg;base64,event');
  });
  it('resolves tomorrow and the day after from the captured local day across a year boundary', () => {
    const event = { kind: 'event', title: '跨年值班', allDay: false, startAt: '2026-12-31T09:00:00+08:00', endAt: '2027-01-01T10:00:00+08:00',
      startDate: null, endDate: null, dueAt: null, dueDate: null, timezone: 'Asia/Shanghai', location: '', people: [], notes: '', unresolvedFields: [], warnings: [], relativeDates: { start: '明天', end: '后天' } };
    const [resolved] = parseScheduleExtraction(JSON.stringify({ events: [event] }), { capturedAt: '2026-12-31T16:30:00.000Z', timezone: 'Asia/Shanghai' });
    expect(resolved.startAt).toBe('2027-01-02T01:00:00Z');
    expect(resolved.endAt).toBe('2027-01-03T02:00:00Z');
    expect(resolved.warnings[0]).toContain('2027-01-01');
    const deadline = { ...event, kind: 'deadline', allDay: true, startAt: null, endAt: null, dueDate: '2026-12-31', relativeDates: { due: '大后天' } };
    expect(parseScheduleExtraction(JSON.stringify({ events: [deadline] }), { capturedAt: '2026-12-31T16:30:00.000Z', timezone: 'Asia/Shanghai' })[0].dueDate).toBe('2027-01-04');
  });
});
