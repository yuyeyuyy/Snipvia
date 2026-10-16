import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { inflateSync } from 'node:zlib';
import { ModelCatalog } from '../../src/main/ai/models/ModelCatalog';
import { modelProviderAdapter, type AdapterContext } from '../../src/main/ai/models/adapters';
import { ModelAPIError, modelJSONRequest, type ModelJSONRequest } from '../../src/main/ai/models/http';
import { newModel } from '../../src/main/ai/models/catalogue-mapping';
import { testModelVision, visionFailure, visionTestImage } from '../../src/main/ai/models/vision-test';
import { capabilityIds, modelScopeSchema, unknownCapabilities, type ModelScope } from '../../src/shared/models';
import { providerFor, type ProviderId } from '../../src/shared/providers';

const requiredProviders: ProviderId[] = ['openai', 'anthropic', 'gemini', 'xai', 'qwen', 'deepseek', 'zhipu', 'kimi', 'doubao', 'qianfan', 'hunyuan'];
const now = '2026-10-09T10:00:00.000Z';
const mockKey = 'synthetic-api-key-for-model-tests';
function context(provider: ProviderId, request: ModelJSONRequest = async () => ({})): AdapterContext {
  return { provider, endpoint: providerFor(provider).endpoint, apiKey: mockKey, now, request };
}
const directories: string[] = [];
function setup(request: ModelJSONRequest = async () => ({ data: [{ id: 'test-unknown' }] }), clock = () => new Date(now)) {
  const directory = mkdtempSync(join(tmpdir(), 'snipvia-model-catalog-')); directories.push(directory);
  const file = join(directory, 'model-catalog.json');
  const options = { file, readKey: () => mockKey, request, now: clock };
  return { catalog: new ModelCatalog(options), options, file };
}
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe('官方模型目录与能力解析（全部为 Mock，不是账号实测）', () => {
  it('图片准入只读现有缓存和精确文档映射，不发目录请求或付费探测，未知仍未知', async () => {
    const request = vi.fn<ModelJSONRequest>(async () => ({ data: [{ id: 'text-only', input_modalities: ['text'], output_modalities: ['text'] }, { id: 'photo-vl', input_modalities: ['text', 'image'], output_modalities: ['text'] }] }));
    const { catalog } = setup(request); const scope = { provider: 'deepseek' as const, endpoint: providerFor('deepseek').endpoint };
    expect(catalog.vision(scope, 'unknown-vl')).toBe('unknown'); expect(request).not.toHaveBeenCalled();
    await catalog.list(scope); expect(catalog.vision(scope, 'text-only')).toBe('unsupported'); expect(catalog.vision(scope, 'photo-vl')).toBe('supported'); expect(request).toHaveBeenCalledTimes(1);
    expect(catalog.vision({ provider: 'deepseek', endpoint: providerFor('deepseek').endpoint }, 'deepseek-v4-pro')).toBe('unsupported');
  });
  it.each(['', 'h', 'https://', 'http://['])('自定义地址编辑中 %j 返回校验失败而不抛出异常', endpoint => {
    expect(modelScopeSchema.safeParse({ provider: 'custom', endpoint }).success).toBe(false);
  });
  it.each(requiredProviders)('%s 使用同一个适配器接口，未知模型不按名称猜测能力', provider => {
    const adapter = modelProviderAdapter(provider), ctx = context(provider);
    const raw = provider === 'gemini' ? { name: 'models/unknown-vision-vl' } : provider === 'qwen' ? { model: 'unknown-vision-vl' } : { id: 'unknown-vision-vl' };
    const model = adapter.parseModel(raw, ctx)!;
    expect(model.id).toBe('unknown-vision-vl'); expect(model.capabilities).toEqual(unknownCapabilities());
    expect(JSON.stringify(model)).not.toContain(mockKey); expect(model).not.toHaveProperty('request');
  });
  it.each(['openai', 'deepseek', 'kimi', 'qianfan', 'siliconflow', 'openrouter', 'custom'] as const)('%s 查询兼容目录不等于推理成功', async provider => {
    const request = vi.fn(async () => ({ data: [{ id: 'unverified' }] }));
    const ctx = context(provider, request); if (provider === 'custom') ctx.endpoint = 'http://localhost:1234/v1';
    const listing = await modelProviderAdapter(provider).list(ctx);
    expect(request).toHaveBeenCalledWith(`${ctx.endpoint}/models`, { headers: { Authorization: `Bearer ${mockKey}` } });
    expect(listing.models[0].capabilities.vision).toBe('unknown'); expect(listing.models[0].visionTest).toBeUndefined();
  });
  it.each(['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-luna', 'gpt-6-sol'])('%s 采用官方精确 ID 和能力证据，未知后缀不继承', id => {
    const adapter = modelProviderAdapter('openai');
    const model = adapter.parseModel({ id }, context('openai'))!;
    expect(model.capabilities).toMatchObject({ vision: 'supported', reasoning: 'supported', toolCalling: 'supported', imageGeneration: 'unsupported' });
    expect(model.evidence.vision?.url).toBe(`https://developers.openai.com/api/docs/models/${id}`);
    expect(adapter.parseModel({ id: id + '-unknown-version' }, context('openai'))!.capabilities.vision).toBe('unknown');
  });
  it('升级目录缓存后自动获取新清单，并保留手动模型及 API 明确的否定能力', async () => {
    const request = vi.fn(async () => ({ data: [{ id: 'gpt-6.1-sol' }] }));
    const { catalog, options, file } = setup(request);
    const scope = { provider: 'openai' as const, endpoint: providerFor('openai').endpoint };
    await catalog.list(scope);
    catalog.add({ ...scope, model: 'manual-id' });
    const old = JSON.parse(readFileSync(file, 'utf8'));
    delete old.entries[0].revision;
    old.entries[0].catalog.models[0].capabilities.vision = 'unknown';
    delete old.entries[0].catalog.models[0].evidence.vision;
    writeFileSync(file, JSON.stringify(old));
    const upgraded = await new ModelCatalog(options).list(scope);
    expect(request).toHaveBeenCalledTimes(2);
    expect(upgraded.models.find(model => model.id === 'gpt-6.1-sol')?.capabilities.vision).toBe('supported');
    expect(upgraded.models.some(model => model.id === 'manual-id')).toBe(true);
    const current = JSON.parse(readFileSync(file, 'utf8'));
    current.entries[0].catalog.models[0].capabilities.vision = 'unsupported';
    current.entries[0].catalog.models[0].evidence.vision = { source: 'api', checkedAt: now, detail: 'explicit API result' };
    writeFileSync(file, JSON.stringify(current));
    expect((await new ModelCatalog(options).list(scope)).models.find(model => model.id === 'gpt-6.1-sol')?.capabilities.vision).toBe('unsupported');
  });
  it('OpenAI 仅对确切官方映射使用文档证据，不信任非标准 vision 字段', () => {
    const adapter = modelProviderAdapter('openai');
    const known = adapter.parseModel({ id: 'gpt-4.1-mini', vision: false }, context('openai'))!;
    expect(known.capabilities.vision).toBe('supported'); expect(known.evidence.vision?.source).toBe('documentation');
    expect(adapter.parseModel({ id: 'gpt-4.1-mini-my-finetune', vision: true }, context('openai'))!.capabilities.vision).toBe('unknown');
  });
  it('Claude 显式 false 与 null 缺失不混淆，不把 server_tools 当作 Function Calling', () => {
    const adapter = modelProviderAdapter('anthropic'), ctx = context('anthropic');
    const model = adapter.parseModel({ id: 'new-claude', display_name: 'New Claude', capabilities: { image_input: { supported: false }, thinking: { supported: true }, structured_outputs: { supported: true }, server_tools: { supported: true } } }, ctx)!;
    expect(model.name).toBe('New Claude'); expect(model.capabilities).toMatchObject({ vision: 'unsupported', reasoning: 'supported', structuredOutput: 'supported', toolCalling: 'unknown' });
    expect(adapter.parseModel({ id: 'new', capabilities: null }, ctx)!.capabilities.vision).toBe('unknown');
  });
  it('Claude 使用原生鉴权与 after_id 分页，跳过 retired 模型', async () => {
    const request = vi.fn().mockResolvedValueOnce({ data: [{ id: 'first' }], has_more: true, last_id: 'first' }).mockResolvedValueOnce({ data: [{ id: 'second' }, { id: 'old', lifecycle: 'retired' }], has_more: false });
    const listing = await modelProviderAdapter('anthropic').list(context('anthropic', request));
    expect(listing.models.map(model => model.id)).toEqual(['first', 'second']);
    expect(request.mock.calls[1][0]).toBe('https://api.anthropic.com/v1/models?limit=1000&after_id=first');
    expect(request.mock.calls[0][1].headers).toEqual({ 'x-api-key': mockKey, 'anthropic-version': '2023-06-01' });
  });
  it('Gemini 原生目录去掉 models/，生成方法不是图片证据，thinking=false 是明确证据', async () => {
    const request = vi.fn().mockResolvedValueOnce({ models: [{ name: 'models/new', displayName: 'Gemini New', supportedGenerationMethods: ['generateContent'], thinking: false }], nextPageToken: 'page-2' }).mockResolvedValueOnce({ models: [] });
    const listing = await modelProviderAdapter('gemini').list(context('gemini', request));
    expect(request.mock.calls[1][0]).toContain('/v1beta/models?pageSize=1000&pageToken=page-2');
    expect(request.mock.calls[0][1].headers).toEqual({ 'x-goog-api-key': mockKey });
    expect(listing.models[0]).toMatchObject({ id: 'new', name: 'Gemini New', capabilities: { textInput: 'supported', vision: 'unknown', reasoning: 'unsupported' } });
  });
  it('DeepSeek 官方模态、推理级别优先于文档映射', () => {
    const model = modelProviderAdapter('deepseek').parseModel({ id: 'deepseek-flash', name: 'Flash', input_modalities: ['text'], output_modalities: ['text'], effort: { supported_levels: ['high'] } }, context('deepseek'))!;
    expect(model.capabilities).toMatchObject({ vision: 'unsupported', audioInput: 'unsupported', videoUnderstanding: 'unsupported', reasoning: 'supported', imageGeneration: 'unsupported' });
    expect(model.evidence.vision?.source).toBe('api');
  });
  it('xAI 合并语言与图像目录和明确 aliases，不能把图像生成输入当成识图', async () => {
    const request = vi.fn().mockResolvedValueOnce({ data: [{ id: 'grok-alias' }, { id: 'image-maker' }] })
      .mockResolvedValueOnce({ models: [{ id: 'latest', aliases: ['grok-alias'], input_modalities: ['text', 'image', 'video'], output_modalities: ['text'], capabilities: { reasoning_effort: ['high'] } }] })
      .mockResolvedValueOnce({ models: [{ id: 'image-maker', input_modalities: ['image', 'text'], output_modalities: ['image'] }] });
    const listing = await modelProviderAdapter('xai').list(context('xai', request));
    expect(listing.models[0].capabilities).toMatchObject({ vision: 'supported', videoUnderstanding: 'supported', reasoning: 'supported' });
    expect(listing.models[1].capabilities).toMatchObject({ vision: 'unknown', imageGeneration: 'supported' });
  });
  it('xAI 部分目录失败保留主目录与未知能力', async () => {
    const request = vi.fn().mockResolvedValueOnce({ data: [{ id: 'new' }] }).mockRejectedValue(new ModelAPIError('http', 403));
    const listing = await modelProviderAdapter('xai').list(context('xai', request));
    expect(listing.models[0].capabilities.vision).toBe('unknown'); expect(listing.warning).toContain('部分');
  });
  it('百炼使用同一官方 origin 的专用目录、分页和能力元数据', async () => {
    const request = vi.fn().mockResolvedValueOnce({ output: { total: 101, models: [{ model: 'qwen-new', name: 'New', capabilities: ['Reasoning'], features: ['function-calling', 'structured-outputs'], inference_metadata: { request_modality: ['Text', 'Image', 'Video', 'Audio'], response_modality: ['Text'] } }] } })
      .mockResolvedValueOnce({ output: { total: 101, models: [{ model: 'qwen-image', inference_metadata: { request_modality: ['Text'], response_modality: ['Image'] } }] } });
    const ctx = { ...context('qwen', request), endpoint: 'https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1' };
    const listing = await modelProviderAdapter('qwen').list(ctx);
    expect(request.mock.calls[0][0]).toBe('https://workspace.cn-beijing.maas.aliyuncs.com/api/v1/models?page_no=1&page_size=100');
    expect(request.mock.calls[1][0]).toContain('page_no=2');
    expect(listing.models[0].capabilities).toMatchObject({ vision: 'supported', videoUnderstanding: 'supported', audioInput: 'supported', toolCalling: 'supported', structuredOutput: 'supported', reasoning: 'supported' });
    expect(listing.models[1].capabilities.imageGeneration).toBe('supported');
  });
  it.each(['https://dashscope-intl.aliyuncs.com', 'https://cn-hongkong.dashscope.aliyuncs.com'])('百炼 %s 不改 Key 所在地区', async origin => {
    const request = vi.fn<ModelJSONRequest>(async () => ({ output: { models: [], total: 0 } }));
    await modelProviderAdapter('qwen').list({ ...context('qwen', request), endpoint: origin + '/compatible-mode/v1' });
    expect(request.mock.calls[0][0]).toBe(origin + '/api/v1/models?page_no=1&page_size=100');
  });
  it('Kimi 官方布尔能力字段正确处理 false、缺失和额外新字段', () => {
    const model = modelProviderAdapter('kimi').parseModel({ id: 'new', supports_image_in: false, supports_video_in: true, supports_reasoning: true, future: true }, context('kimi'))!;
    expect(model.capabilities).toMatchObject({ vision: 'unsupported', videoUnderstanding: 'supported', reasoning: 'supported', audioInput: 'unknown' });
  });
  it('千帆 architecture 的 voice 输入归一为音频，不从 type 推测未返回能力', () => {
    const model = modelProviderAdapter('qianfan').parseModel({ id: 'new', architecture: { input_modalities: ['text', 'image', 'voice', 'video'], output_modalities: ['text'] } }, context('qianfan'))!;
    expect(model.capabilities).toMatchObject({ vision: 'supported', videoUnderstanding: 'supported', audioInput: 'supported', imageGeneration: 'unsupported' });
    expect(modelProviderAdapter('qianfan').parseModel({ id: 'new', type: 'multimodal' }, context('qianfan'))!.capabilities.vision).toBe('unknown');
  });
  it.each(['zhipu', 'hunyuan', 'doubao'] as const)('%s 维护清单不发送 Key 到其他目录服务', async provider => {
    const request = vi.fn(); const listing = await modelProviderAdapter(provider).list(context(provider, request));
    expect(request).not.toHaveBeenCalled(); expect(listing.models[0].source).toBe('documentation'); expect(listing.models[0].capabilities.vision).toBe('supported'); expect(listing.warning).toBeTruthy();
  });
  it('百炼北京通用接口需要 workspace 地址，没有未核实的目录请求', async () => {
    const request = vi.fn(); const listing = await modelProviderAdapter('qwen').list(context('qwen', request));
    expect(request).not.toHaveBeenCalled(); expect(listing.warning).toContain('业务空间');
  });
  it('Opaque ep 接入点没有名称继承，不假设其具有视觉能力', () => {
    expect(newModel(context('doubao'), 'ep-qwen-vision', 'Vision', 'manual', now)).toMatchObject({ endpointId: true, capabilities: unknownCapabilities() });
  });
  it.each([{}, { data: null }, { data: [{}] }])('拒绝损坏的目录 %j', async body => {
    await expect(modelProviderAdapter('openai').list(context('openai', async () => body))).rejects.toThrow();
  });
  it('拒绝重复分页游标', async () => {
    await expect(modelProviderAdapter('anthropic').list(context('anthropic', async () => ({ data: [{ id: 'same' }], has_more: true, last_id: 'same' })))).rejects.toThrow('格式');
  });
  it('能力结构始终包含八个三态字段', () => { expect(Object.keys(unknownCapabilities())).toEqual([...capabilityIds]); });
});

describe('用户确认的图片验证协议', () => {
  it('合成图片确实为 64x64，颜色判定未在请求文字中泄露', () => {
    const png = Buffer.from(visionTestImage, 'base64'); expect(png.readUInt32BE(16)).toBe(64); expect(png.readUInt32BE(20)).toBe(64);
    let offset = 8; const compressed: Buffer[] = [];
    while (offset < png.length) { const length = png.readUInt32BE(offset); if (png.subarray(offset + 4, offset + 8).toString() === 'IDAT') compressed.push(png.subarray(offset + 8, offset + 8 + length)); offset += length + 12; }
    const pixels = inflateSync(Buffer.concat(compressed));
    expect([...pixels.subarray(1, 4)]).toEqual([255, 0, 0]);
    expect([...pixels.subarray(63 * 193 + 1 + 63 * 3, 63 * 193 + 4 + 63 * 3)]).toEqual([0, 0, 255]);
  });
  it.each(requiredProviders)('%s 只发送合成图，通过正确识图而不是仅 HTTP 200', async provider => {
    const reply = '{"topLeft":"red","bottomRight":"blue"}';
    const request = vi.fn<ModelJSONRequest>(async () => provider === 'anthropic' ? { content: [{ type: 'text', text: reply }] } : provider === 'gemini' ? { candidates: [{ content: { parts: [{ text: reply }] } }] } : { choices: [{ message: { content: reply } }] });
    const ctx = context(provider, request); const model = newModel(ctx, providerFor(provider).models[0].id, 'Fixture', 'manual', now);
    expect((await testModelVision(ctx, model)).outcome).toBe('supported');
    const [url, init] = request.mock.calls[0]; const body = JSON.parse(String(init?.body));
    expect(JSON.stringify(body)).toContain(visionTestImage); expect(JSON.stringify(body)).not.toContain(mockKey);
    expect(JSON.stringify(body)).not.toContain('red');
    if (provider === 'anthropic') { expect(url).toBe(ctx.endpoint + '/messages'); expect(init?.headers).toMatchObject({ 'x-api-key': mockKey }); expect(body.max_tokens).toBe(128); }
    else if (provider === 'gemini') { expect(url).toContain(':generateContent'); expect(init?.headers).toMatchObject({ 'x-goog-api-key': mockKey }); expect(body.contents[0].parts[0].inlineData.mimeType).toBe('image/png'); }
    else { expect(url).toBe(ctx.endpoint + '/chat/completions'); expect(body.messages[0].content[0].image_url.url).toMatch(/^data:image\/png;base64,/); }
  });
  it.each(['wrong answer', '{"topLeft":"blue","bottomRight":"red"}', ''])('接口正常返回但内容不正确保留未知：%s', async content => {
    const ctx = context('openai', async () => ({ choices: [{ message: { content } }] }));
    expect((await testModelVision(ctx, newModel(ctx, 'new', 'New', 'manual', now))).outcome).toBe('inconclusive');
  });
  it.each([
    [401, 'does not support image', 'authentication'], [403, '', 'permission'], [402, '', 'balance'], [429, '', 'rateLimit'], [429, 'insufficient_quota', 'balance'], [500, '', 'network'], [404, '', 'modelUnavailable'],
    [400, 'image input is not supported', 'unsupported'], [422, 'This model does not support image input', 'unsupported'], [400, '不支持图片输入', 'unsupported'],
    [400, 'invalid image_url', 'invalidRequest'], [400, 'unsupported parameter max_tokens', 'invalidRequest'], [400, 'image too small', 'invalidRequest'], [503, 'does not support image', 'network']
  ])('HTTP %i %s => %s', (status, diagnostic, outcome) => {
    expect(visionFailure(new ModelAPIError('http', Number(status), String(diagnostic)), 'chat-completions', now).outcome).toBe(outcome);
  });
});

describe('目录缓存、刷新、凭据隔离和结果持久化', () => {
  const scope: ModelScope = { provider: 'openai', endpoint: providerFor('openai').endpoint };
  it('缓存减少查询，手动刷新真实查询，Key 改变不复用测试结果', async () => {
    const request = vi.fn(async () => ({ data: [{ id: 'new' }] })); const { catalog, file, options } = setup(request);
    expect((await catalog.list(scope)).fromCache).toBe(false); expect((await catalog.list(scope)).fromCache).toBe(true);
    await catalog.list({ ...scope, refresh: true }); expect(request).toHaveBeenCalledTimes(2);
    await catalog.list({ ...scope, apiKey: 'different-synthetic-key' }); expect(request).toHaveBeenCalledTimes(3);
    expect(readFileSync(file, 'utf8')).not.toMatch(/synthetic-api-key|different-synthetic-key|Authorization|apiKey/);
    expect((await new ModelCatalog(options).list(scope)).fromCache).toBe(true);
  });
  it('缓存 TTL 到期刷新；失败返回过期缓存与明确提示', async () => {
    let time = new Date(now); const request = vi.fn().mockResolvedValueOnce({ data: [{ id: 'new' }] }).mockRejectedValue(new ModelAPIError('http', 401, mockKey));
    const { catalog } = setup(request, () => time);
    await catalog.list(scope); time = new Date(time.getTime() + 86_400_001);
    const value = await catalog.list(scope); expect(value).toMatchObject({ fromCache: true, stale: true }); expect(value.warning).toContain('鉴权失败'); expect(value.warning).not.toContain(mockKey);
  });
  it('目录失败没有缓存时不伪装成查询成功', async () => {
    const { catalog } = setup(async () => { throw new ModelAPIError('http', 403); });
    await expect(catalog.list(scope)).rejects.toThrow('无权');
  });
  it('动态目录替换后保留手动模型与验证时间，重启仍保留', async () => {
    const request = vi.fn(async (url: string) => url.endsWith('/models') ? { data: [{ id: 'new' }] } : { choices: [{ message: { content: '{"topLeft":"red","bottomRight":"blue"}' } }] });
    const { catalog, options } = setup(request);
    catalog.add({ ...scope, model: 'manual-vl' });
    await expect(catalog.testVision({ ...scope, model: 'manual-vl', confirmCost: false } as never)).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
    const model = await catalog.testVision({ ...scope, model: 'manual-vl', confirmCost: true });
    expect(model.capabilities.vision).toBe('supported'); expect(model.visionTest?.checkedAt).toBe(now);
    expect((await catalog.list({ ...scope, refresh: true })).models).toHaveLength(2);
    const rebooted = new ModelCatalog(options); const result = await rebooted.list(scope);
    expect(result.models.find(item => item.id === 'manual-vl')?.evidence.vision?.source).toBe('verification');
  });
  it('同一接口改变 Key 后测试记录隔离；同一 Key 的另一接口也隔离', async () => {
    const { catalog } = setup(async () => ({ choices: [{ message: { content: '{"topLeft":"red","bottomRight":"blue"}' } }] }));
    await catalog.testVision({ ...scope, model: 'new', confirmCost: true });
    expect(catalog.add({ ...scope, model: 'new', apiKey: 'other-synthetic' }).capabilities.vision).toBe('unknown');
    expect(catalog.add({ ...scope, provider: 'custom', endpoint: 'https://other.example/v1', model: 'new' }).capabilities.vision).toBe('unknown');
  });
  it.each([401, 402, 403, 429, 500])('HTTP %i 不能污染未知图片能力', async status => {
    const { catalog } = setup(async () => { throw new ModelAPIError('http', status); });
    const result = await catalog.testVision({ ...scope, model: 'unknown', confirmCost: true });
    expect(result.capabilities.vision).toBe('unknown'); expect(result.visionTest?.checkedAt).toBe(now);
  });
  it('只有明确证据设为不支持；实际验证优先级低于官方字段', async () => {
    const request = vi.fn().mockResolvedValueOnce({ data: [{ id: 'known', input_modalities: ['text', 'image'], output_modalities: ['text'] }] }).mockRejectedValue(new ModelAPIError('http', 400, 'image input is not supported'));
    const { catalog } = setup(request); const deepseek = { ...scope, provider: 'deepseek' as const, endpoint: providerFor('deepseek').endpoint };
    await catalog.list(deepseek);
    const known = await catalog.testVision({ ...deepseek, model: 'known', confirmCost: true });
    expect(known.capabilities.vision).toBe('supported'); expect(known.visionTest?.outcome).toBe('unsupported'); expect(known.evidence.vision?.source).toBe('api');
    const unknown = await catalog.testVision({ ...deepseek, model: 'unknown', confirmCost: true });
    expect(unknown.capabilities.vision).toBe('unsupported');
  });
  it('无 Key 使用清单，不发匿名官方请求；清单请求不被永久 inflight 缓存', async () => {
    const request = vi.fn(); const { catalog } = setup(request);
    expect((await catalog.list({ ...scope, apiKey: '' })).warning).toContain('API Key');
    expect((await catalog.list({ ...scope, apiKey: '', refresh: true })).fromCache).toBe(false); expect(request).not.toHaveBeenCalled();
  });
  it('同账号并发目录查询去重', async () => {
    const request = vi.fn(async () => ({ data: [{ id: 'new' }] })); const { catalog } = setup(request);
    const results = await Promise.all([catalog.list(scope), catalog.list(scope)]);
    expect(request).toHaveBeenCalledTimes(1); expect(results[0]).toEqual(results[1]);
  });
  it('损坏缓存可重建，不修改设置或凭据', async () => {
    const { file, options } = setup(); writeFileSync(file, '{invalid');
    expect((await new ModelCatalog(options).list(scope)).models).toHaveLength(1);
  });
  it('主进程拒绝地址错配和 URL 内凭据', () => {
    for (const endpoint of ['https://evil.test/v1', 'https://api.openai.com.evil.test/v1', 'https://key:password@api.openai.com/v1', scope.endpoint + '?apiKey=secret']) expect(modelScopeSchema.safeParse({ ...scope, endpoint }).success).toBe(false);
  });
  it('服务反射 Key 到模型 ID 或名字不能返回/持久化', async () => {
    const { catalog, file } = setup(async () => ({ data: [{ id: mockKey }, { id: 'safe', name: mockKey }] }));
    expect((await catalog.list(scope)).models.map(model => model.name)).toEqual(['safe']);
    expect(readFileSync(file, 'utf8')).not.toContain(mockKey);
  });
});

describe('目录 HTTP 边界', () => {
  it('使用禁止重定向和超时，不追随第三方地址，不传 Key 到 URL', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ data: [] }));
    const request = modelJSONRequest(fetcher as typeof fetch);
    await request('https://api.openai.com/v1/models', { headers: { Authorization: 'Bearer synthetic' } });
    expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: 'error', signal: expect.any(AbortSignal) });
  });
  it.each([false, true])('处理 HTTP/业务错误，不向调用者暴露原始文本 (%s)', async embedded => {
    const fetcher = vi.fn(async () => Response.json({ error: { message: mockKey } }, { status: embedded ? 200 : 401 }));
    await expect(modelJSONRequest(fetcher as typeof fetch)('https://example.test')).rejects.toThrow(/请求失败/);
  });
  it('限制响应大小', async () => {
    await expect(modelJSONRequest((async () => new Response('x'.repeat(4_000_001))) as typeof fetch)('https://example.test')).rejects.toThrow('格式');
  });
});
