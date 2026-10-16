import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import { assertApiKeyFormat } from '../../../shared/api-key';
import { credentialScope } from '../../../shared/providers';
import { modelAddRequestSchema, modelCatalogSchema, modelInfoSchema, modelListRequestSchema, modelTestRequestSchema, type CapabilityStatus, type ModelCatalogResult, type ModelInfo, type ModelListRequest, type ModelScope, type ModelTestRequest } from '../../../shared/models';
import { modelProviderAdapter, type AdapterContext } from './adapters';
import { newModel, staticModels } from './catalogue-mapping';
import { modelJSONRequest, type ModelJSONRequest } from './http';
import { testModelVision, visionFailure } from './vision-test';

const cacheSchema = z.object({ version: z.literal(1), entries: z.array(z.object({ id: z.string().regex(/^[a-f0-9]{64}$/), revision: z.number().optional(), catalog: modelCatalogSchema, local: z.array(modelInfoSchema).max(300) })).max(32) });
type Entry = z.infer<typeof cacheSchema>['entries'][number];
const catalogRevision = 2;
const ttl = 24 * 60 * 60 * 1000;

export class ModelCatalog {
  private entries = new Map<string, Entry>();
  private inflight = new Map<string, Promise<ModelCatalogResult>>();
  private testing = new Set<string>();
  constructor(private options: { file: string; readKey(scope: ModelScope): string; request?: ModelJSONRequest; now?: () => Date }) {
    if (existsSync(options.file)) {
      try {
        if (readFileSync(options.file).byteLength <= 16_000_000) {
          const parsed = cacheSchema.parse(JSON.parse(readFileSync(options.file, 'utf8')));
          this.entries = new Map(parsed.entries.map(entry => [entry.id, entry]));
        }
      } catch { /* Malformed cache is disposable; credentials/settings are untouched. */ }
    }
  }
  private context(value: ModelListRequest): { context: AdapterContext; id: string } {
    const request = modelListRequestSchema.parse(value);
    const apiKey = request.apiKey === undefined ? this.options.readKey(request) : request.apiKey.trim();
    assertApiKeyFormat(apiKey);
    const endpoint = request.endpoint.replace(/\/+$/, '');
    const scope = { provider: request.provider, endpoint };
    const id = createHash('sha256').update(JSON.stringify([credentialScope(scope), apiKey])).digest('hex');
    return { context: { ...scope, apiKey, now: (this.options.now?.() ?? new Date()).toISOString(), request: this.options.request ?? modelJSONRequest() }, id };
  }
  private persist() {
    while (this.entries.size > 32) this.entries.delete(this.entries.keys().next().value!);
    const payload = cacheSchema.parse({ version: 1, entries: [...this.entries.values()] });
    const text = JSON.stringify(payload);
    if (Buffer.byteLength(text) > 16_000_000) throw new Error('模型缓存超过大小限制');
    mkdirSync(dirname(this.options.file), { recursive: true, mode: 0o700 });
    writeFileSync(`${this.options.file}.tmp`, text, { mode: 0o600 });
    renameSync(`${this.options.file}.tmp`, this.options.file); chmodSync(this.options.file, 0o600);
  }
  private overlay(entry: Entry): ModelCatalogResult {
    const models = new Map(entry.catalog.models.map(model => [model.id, structuredClone(model)]));
    for (const local of entry.local) {
      const model = models.get(local.id) ?? structuredClone(local);
      if (local.visionTest) {
        model.visionTest = local.visionTest;
        if ((model.capabilities.vision === 'unknown' || model.evidence.vision?.source === 'verification') && ['supported', 'unsupported'].includes(local.visionTest.outcome)) {
          model.capabilities.vision = local.visionTest.outcome as 'supported' | 'unsupported';
          model.evidence.vision = { source: 'verification', detail: local.visionTest.message, checkedAt: local.visionTest.checkedAt };
        }
      }
      models.set(model.id, model);
    }
    // Apply new documentation to old cached/manual IDs without overriding explicit API evidence.
    for (const model of models.values()) {
      const current = newModel(model, model.id, model.name, model.source, model.discoveredAt);
      for (const [key, evidence] of Object.entries(current.evidence)) {
        const capability = key as keyof typeof model.capabilities;
        if (model.evidence[capability]?.source !== 'api') {
          model.capabilities[capability] = current.capabilities[capability];
          model.evidence[capability] = evidence;
        }
      }
    }
    return { ...entry.catalog, models: [...models.values()].sort((a, b) => Number(b.capabilities.vision === 'supported') - Number(a.capabilities.vision === 'supported') || a.id.localeCompare(b.id)) };
  }
  async list(value: ModelListRequest): Promise<ModelCatalogResult> {
    const { context, id } = this.context(value);
    const previous = this.entries.get(id);
    const fresh = previous?.revision === catalogRevision && Date.parse(context.now) - Date.parse(previous.catalog.fetchedAt) < ttl;
    if (!value.refresh && fresh) return { ...this.overlay(previous), fromCache: true, stale: false };
    const pending = this.inflight.get(id);
    if (pending) return pending;
    if (this.inflight.size >= 4) throw new Error('模型目录请求过多，请稍后刷新');
    const task = Promise.resolve().then(async () => {
      try {
        const listing = !context.apiKey && context.provider !== 'custom'
          ? { models: staticModels(context, context.now), method: '官方文档维护清单', warning: '配置 API Key 后刷新目录；当前清单不是账号调用权限验证。' }
          : await modelProviderAdapter(context.provider).list(context);
        const entry: Entry = { id, revision: catalogRevision, catalog: modelCatalogSchema.parse({ ...listing, fetchedAt: context.now, fromCache: false, stale: false }), local: this.entries.get(id)?.local ?? [] };
        this.entries.set(id, entry); this.persist(); return this.overlay(entry);
      } catch (error) {
        if (previous) return { ...this.overlay(previous), fromCache: true, stale: true, warning: visionFailure(error, 'chat-completions', context.now).message + ' 显示此前缓存。' };
        throw new Error(visionFailure(error, 'chat-completions', context.now).message);
      } finally { this.inflight.delete(id); }
    });
    this.inflight.set(id, task);
    return task;
  }
  /** Local cache + exact documentation mapping only. No request, paid probe or key transfer. */
  vision(scope: ModelScope, model: string): CapabilityStatus {
    const { context, id } = this.context(scope); const entry = this.entries.get(id);
    return (entry && this.overlay(entry).models.find(item => item.id === model))?.capabilities.vision ?? newModel(context, model, model, 'manual', context.now).capabilities.vision;
  }
  add(value: z.input<typeof modelAddRequestSchema>): ModelInfo {
    const parsed = modelAddRequestSchema.parse(value);
    const { context, id } = this.context(parsed);
    if (context.apiKey && parsed.model.includes(context.apiKey)) throw new Error('模型 ID 不能包含 API Key');
    const entry = this.ensureEntry(context, id);
    const model = newModel(context, parsed.model, parsed.model, 'manual', context.now);
    const existing = this.overlay(entry).models.find(item => item.id === model.id);
    if (existing) return existing;
    if (entry.local.length >= 300) throw new Error('手动模型数量超过限制');
    entry.local.push(model); this.persist(); return modelInfoSchema.parse(model);
  }
  private ensureEntry(context: AdapterContext, id: string): Entry {
    let entry = this.entries.get(id);
    if (!entry) {
      entry = { id, catalog: { models: [], fetchedAt: '1970-01-01T00:00:00.000Z', fromCache: false, stale: false, method: '手动模型，尚未获取目录' }, local: [] };
      this.entries.set(id, entry);
    }
    return entry;
  }
  async testVision(value: ModelTestRequest): Promise<ModelInfo> {
    // This literal is validated in main as well as the UI. No automatic paid probes.
    const parsed = modelTestRequestSchema.parse(value);
    const { context, id } = this.context(parsed);
    if (!context.apiKey && context.provider !== 'custom') throw new Error('请先配置该接口的 API Key');
    if (this.testing.size > 0) throw new Error('已有图片能力测试正在进行，请等待完成');
    if (context.apiKey && parsed.model.includes(context.apiKey)) throw new Error('模型 ID 不能包含 API Key');
    this.testing.add(id);
    try {
      const entry = this.ensureEntry(context, id);
      const model = this.overlay(entry).models.find(item => item.id === parsed.model) ?? newModel(context, parsed.model, parsed.model, 'manual', context.now);
      const visionTest = await testModelVision(context, model);
      const local = { ...model, visionTest };
      const index = entry.local.findIndex(item => item.id === model.id);
      if (index >= 0) entry.local[index] = local;
      else { if (entry.local.length >= 300) throw new Error('测试结果数量超过限制'); entry.local.push(local); }
      this.persist();
      return this.overlay(entry).models.find(item => item.id === model.id)!;
    } finally { this.testing.delete(id); }
  }
}
