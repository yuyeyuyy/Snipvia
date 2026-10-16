import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type Fixture = { urls: string[]; version: number; fail: boolean; keysMatched: boolean[]; delay: boolean; release?: () => void };
type FixtureGlobal = typeof globalThis & { modelCatalogueFixture: Fixture };

test('刷新直接更新图片模型下拉框，旧目录消失，缓存、失败和跨厂商竞态（Mock）', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'snipvia-model-catalog-ui-'));
  const app = await electron.launch({ args: ['.', `--user-data-dir=${directory}`], env: { ...process.env, SNIPVIA_CAPTURE_WARMUP: '0' } });
  try {
    const page = await app.firstWindow();
    await app.evaluate(() => {
      const state: Fixture = { urls: [], version: 1, fail: false, keysMatched: [], delay: false };
      (globalThis as FixtureGlobal).modelCatalogueFixture = state;
      globalThis.fetch = async (input, init) => {
        const url = String(input);
        if (['https://api.openai.com/v1/models', 'https://api.deepseek.com/models'].includes(url)) {
          state.urls.push(url);
          state.keysMatched.push(new Headers(init?.headers).get('authorization') === 'Bearer synthetic-model-ui-key');
          if (state.fail) return Response.json({ error: { message: 'Unauthorized' } }, { status: 401 });
          if (state.delay) await new Promise<void>(resolve => { state.release = resolve; });
          if (url.includes('openai.com')) return Response.json({ data: [
            { id: 'gpt-6.1-sol' }, { id: 'gpt-6-astra' }, { id: 'gpt-6-luna' }, { id: 'gpt-4.1-mini' },
            { id: 'unknown-vision-vl' }, { id: 'text-embedding-3-small' }, { id: 'gpt-image-2' },
            ...(state.version > 1 ? [{ id: 'gpt-6-sol' }] : [])
          ] });
          return Response.json({ data: [
            { id: 'confirmed-model', name: '已确认图片模型', input_modalities: ['text', 'image'], output_modalities: ['text'] },
            { id: 'future-vl', name: '未知能力模型' },
            { id: 'text-only', name: '纯文本模型', input_modalities: ['text'], output_modalities: ['text'] }
          ] });
        }
        throw new Error('Non-fixture network disabled');
      };
    });
    await page.getByRole('button', { name: '模型与设置' }).click();
    await page.getByRole('button', { name: '配置…' }).click();
    const dialog = page.getByRole('dialog', { name: '配置厂商', exact: true });
    const select = dialog.getByLabel('选择模型');
    const refresh = dialog.getByRole('button', { name: '刷新模型列表' });
    await expect(dialog.getByLabel('模型厂商').locator('option')).toHaveText(['OpenAI', 'Anthropic Claude', 'xAI Grok', '通义千问', 'Google Gemini', 'DeepSeek', 'Kimi', '智谱 GLM', '豆包', '自定义服务']);
    await expect(select).toHaveValue('gpt-6.1-sol'); // Current documented fallback before a key is entered.
    await expect(dialog.getByRole('region', { name: '模型目录' })).toHaveCount(0);
    await expect(dialog.getByRole('table')).toHaveCount(0);
    await dialog.getByLabel('API Key', { exact: true }).fill('synthetic-model-ui-key');
    await expect(select.locator('option[value="gpt-6-sol"]')).toHaveCount(0); // API list replaces presets.
    await expect(refresh).toBeEnabled();
    await expect(select.locator('option')).toHaveCount(6); // Placeholder, four confirmed IDs, manual entry.
    const first = await select.locator('option').allTextContents();
    expect(first.join(' ')).not.toMatch(/unknown-vision|embedding|gpt-image/);
    await select.selectOption('gpt-6-luna');
    const before = await app.evaluate(() => (globalThis as FixtureGlobal).modelCatalogueFixture.urls.length);
    await app.evaluate(() => { (globalThis as FixtureGlobal).modelCatalogueFixture.version = 2; });
    await refresh.click();
    await expect(select.locator('option[value="gpt-6-sol"]')).toHaveCount(1);
    await expect(select).toHaveValue('gpt-6-luna');
    expect(await app.evaluate(() => (globalThis as FixtureGlobal).modelCatalogueFixture.urls.length)).toBe(before + 1);
    const buttonBox = await refresh.boundingBox(), selectBox = await select.boundingBox();
    expect(buttonBox!.x + buttonBox!.width).toBeLessThan(selectBox!.x);
    expect(Math.abs(buttonBox!.y + buttonBox!.height / 2 - selectBox!.y - selectBox!.height / 2)).toBeLessThan(2);
    await page.screenshot({ path: 'docs/ui/client-model-catalog.png' });
    await app.evaluate(() => { (globalThis as FixtureGlobal).modelCatalogueFixture.fail = true; });
    await refresh.click();
    await expect(dialog.getByRole('status')).toContainText('鉴权失败');
    await expect(select).toHaveValue('gpt-6-luna');
    await expect(select.locator('option[value="gpt-6-sol"]')).toHaveCount(1);
    await app.evaluate(() => { (globalThis as FixtureGlobal).modelCatalogueFixture.fail = false; });

    // A delayed response from the previous provider must never populate the new dropdown.
    await dialog.getByLabel('模型厂商').selectOption('deepseek');
    await app.evaluate(() => { (globalThis as FixtureGlobal).modelCatalogueFixture.delay = true; });
    await dialog.getByLabel('API Key', { exact: true }).fill('synthetic-model-ui-key');
    await expect.poll(() => app.evaluate(() => Boolean((globalThis as FixtureGlobal).modelCatalogueFixture.release))).toBe(true);
    await dialog.getByLabel('模型厂商').selectOption('doubao');
    await app.evaluate(() => { const state = (globalThis as FixtureGlobal).modelCatalogueFixture; state.delay = false; state.release?.(); });
    await expect(select).toHaveValue('doubao-seed-2-0-lite-260428');
    await expect(select.locator('option[value="confirmed-model"]')).toHaveCount(0);
    await select.selectOption('__custom__');
    await dialog.getByLabel('模型名称', { exact: true }).fill('ep-fixture');
    await refresh.click();
    await expect(dialog.getByLabel('模型名称', { exact: true })).toHaveValue('ep-fixture');
    await expect(select.locator('option[value="ep-fixture"]')).toHaveCount(0);

    await dialog.getByLabel('模型厂商').selectOption('deepseek');
    await dialog.getByLabel('API Key', { exact: true }).fill('synthetic-model-ui-key');
    await expect(select.locator('option[value="confirmed-model"]')).toHaveCount(1);
    await select.selectOption('confirmed-model');
    await expect(dialog.getByLabel('模型名称', { exact: true })).toHaveCount(0);
    expect((await select.locator('option').allTextContents()).join(' ')).not.toMatch(/未知能力|纯文本/);
    const count = await app.evaluate(() => (globalThis as FixtureGlobal).modelCatalogueFixture.urls.length);
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    await page.getByRole('button', { name: '配置…' }).click();
    await dialog.getByLabel('模型厂商').selectOption('deepseek');
    await dialog.getByLabel('API Key', { exact: true }).fill('synthetic-model-ui-key');
    await expect(select.locator('option[value="confirmed-model"]')).toHaveCount(1);
    expect(await app.evaluate(() => (globalThis as FixtureGlobal).modelCatalogueFixture.urls.length)).toBe(count);
    expect(await app.evaluate(() => (globalThis as FixtureGlobal).modelCatalogueFixture.keysMatched.every(Boolean))).toBe(true);
    expect(await readFile(join(directory, 'model-catalog.json'), 'utf8')).not.toContain('synthetic-model-ui-key');
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});

test('移除厂商的旧配置显示为自定义服务，重新保存保留密钥作用域（Mock）', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'snipvia-retired-provider-ui-'));
  const app = await electron.launch({ args: ['.', `--user-data-dir=${directory}`], env: { ...process.env, SNIPVIA_CAPTURE_WARMUP: '0' } });
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ safeStorage }) => {
      safeStorage.isEncryptionAvailable = () => true;
      safeStorage.encryptString = text => Buffer.from('fixture:' + Buffer.from(text).toString('base64'));
      safeStorage.decryptString = bytes => Buffer.from(bytes.toString().slice('fixture:'.length), 'base64').toString();
      globalThis.fetch = async () => { throw new Error('Non-fixture network disabled'); };
    });
    const saved = await page.evaluate(async () => {
      const current = await window.snipvia.settings.get();
      if (!current.ok) throw new Error(current.error);
      return window.snipvia.settings.save({ ...current.value, provider: 'hunyuan', endpoint: 'https://api.hunyuan.cloud.tencent.com/v1', model: 'hunyuan-vision', apiKey: 'synthetic-retired-key' });
    });
    expect(saved.ok).toBe(true);
    const before = JSON.parse(await readFile(join(directory, 'settings.json'), 'utf8'));
    await page.getByRole('button', { name: '模型与设置' }).click();
    await expect(page.getByLabel('选择厂商')).toContainText('自定义服务 · hunyuan-vision');
    await page.getByRole('button', { name: '配置…' }).click();
    await expect(page.getByLabel('模型厂商')).toHaveValue('custom');
    await expect(page.getByLabel('API 地址')).toHaveValue('https://api.hunyuan.cloud.tencent.com/v1');
    await expect(page.getByLabel('API Key', { exact: true })).toHaveAttribute('placeholder', '留空保持不变');
    await expect(page.getByLabel('选择模型')).toHaveValue('hunyuan-vision');
    await page.getByRole('button', { name: '保存并使用' }).click();
    const after = JSON.parse(await readFile(join(directory, 'settings.json'), 'utf8'));
    expect(after.encryptedKeys).toEqual(before.encryptedKeys);
    expect(after.settings).toEqual(before.settings);
    expect(JSON.stringify(after)).not.toContain('synthetic-retired-key');
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});
