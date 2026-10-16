import { expect, test } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchDesktop } from '../helpers/desktop';

test('客户端厂商配置、接口密钥隔离及 DeepSeek 图片 Agent 对话', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'snipvia-provider-settings-'));
  const app = await launchDesktop({ args: ['.', `--user-data-dir=${directory}`], env: { ...process.env, SNIPVIA_CAPTURE_BACKEND: 'electron', SNIPVIA_CAPTURE_WARMUP: '0' } });
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ safeStorage }) => {
      const fetchAccount = globalThis.fetch;
      globalThis.fetch = async (input, init) => String(input) === 'https://api.deepseek.com/models'
        ? Response.json({ data: [{ id: 'deepseek-flash', input_modalities: ['text', 'image'], output_modalities: ['text'] }] })
        : fetchAccount(input, init);
      // Credential operations are simulated only in this temporary Electron instance.
      safeStorage.isEncryptionAvailable = () => true;
      safeStorage.encryptString = text => Buffer.from('fixture:' + Buffer.from(text).toString('base64'));
      safeStorage.decryptString = bytes => Buffer.from(bytes.toString().slice('fixture:'.length), 'base64').toString();
    });
    await page.getByRole('button', { name: '模型与设置' }).click();
    await page.getByRole('button', { name: '配置…' }).click();
    await expect(page.getByLabel('模型厂商').locator('option')).toHaveText(['OpenAI', 'Anthropic Claude', 'xAI Grok', '通义千问', 'Google Gemini', 'DeepSeek', 'Kimi', '智谱 GLM', '豆包', '自定义服务']);
    await page.getByLabel('模型厂商').selectOption('deepseek');
    await expect(page.getByLabel('选择模型')).toHaveValue('deepseek-flash');
    await expect(page.getByLabel('API 地址')).toHaveValue('https://api.deepseek.com');
    await page.getByLabel('选择模型').selectOption('__custom__');
    await page.getByLabel('模型名称').fill('deepseek-v4-pro');
    await page.getByRole('button', { name: '保存并使用' }).click();
    await expect(page.getByRole('alert')).toContainText('不支持图片输入');
    await page.getByLabel('选择模型').selectOption('deepseek-flash');
    await page.getByLabel('API Key', { exact: true }).fill('synthetic-deepseek-key');
    await page.screenshot({ path: 'docs/ui/client-provider-deepseek.png' });
    await page.getByRole('button', { name: '保存并使用' }).click();
    await expect(page.getByRole('dialog', { name: '配置厂商' })).toHaveCount(0);
    await page.getByRole('button', { name: '配置…' }).click();
    await page.getByLabel('模型厂商').selectOption('qwen');
    await page.getByLabel('接口来源').selectOption('https://maas.qianwenaiapi.com/compatible-mode/v1');
    await page.getByLabel('选择模型').selectOption('qwen3-vl-plus');
    await page.getByLabel('API Key', { exact: true }).fill('synthetic-qwen-platform-key');
    await page.screenshot({ path: 'docs/ui/client-provider-qwen-platform.png' });
    await page.getByRole('button', { name: '保存并使用' }).click();
    await expect(page.getByRole('dialog', { name: '配置厂商' })).toHaveCount(0);
    await page.getByRole('button', { name: '配置…' }).click();
    await page.getByLabel('接口来源').selectOption('https://dashscope.aliyuncs.com/compatible-mode/v1');
    await expect(page.getByLabel('API Key', { exact: true })).toHaveAttribute('placeholder', '输入 API Key');
    await page.getByLabel('API Key', { exact: true }).fill('synthetic-qwen-beijing-key');
    await page.getByRole('button', { name: '保存并使用' }).click();
    await expect(page.getByRole('dialog', { name: '配置厂商' })).toHaveCount(0);
    await page.getByLabel('选择厂商').selectOption('deepseek:https://api.deepseek.com');
    await expect(page.locator('.preference-status[role="status"]')).toContainText('DeepSeek · deepseek-flash');
    const publicSettings = await page.evaluate(() => window.snipvia.settings.get());
    expect(publicSettings.ok && publicSettings.value.configuredModels).toHaveLength(4); // Original OpenAI plus three new scopes.
    const stored = await readFile(join(directory, 'settings.json'), 'utf8');
    expect(stored).not.toMatch(/synthetic-deepseek-key|synthetic-qwen-platform-key|synthetic-qwen-beijing-key/);
    expect(JSON.parse(stored).settings.provider).toBe('deepseek');
    await app.evaluate(({ desktopCapturer, nativeImage, screen, systemPreferences }) => {
      systemPreferences.getMediaAccessStatus = () => 'granted';
      desktopCapturer.getSources = async options => {
        const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()), size = options.thumbnailSize!;
        return [{ id: 'screen:synthetic', name: 'Synthetic screen', display_id: String(display.id), appIcon: nativeImage.createEmpty(), thumbnail: nativeImage.createFromBuffer(Buffer.alloc(size.width * size.height * 4, 255), size) }];
      };
      const original = globalThis.fetch;
      globalThis.fetch = async (input, init) => {
        if (String(input) === 'https://api.deepseek.com/chat/completions') {
          const body = JSON.parse(String(init?.body));
          (globalThis as typeof globalThis & { providerFixture?: unknown }).providerFixture = { body, keyMatched: new Headers(init?.headers).get('authorization') === 'Bearer synthetic-deepseek-key' };
          return Response.json({ choices: [{ finish_reason: 'stop', message: { content: 'DeepSeek 图片对话模拟通过。' } }] });
        }
        if (!['localhost', '127.0.0.1'].includes(new URL(String(input)).hostname)) throw new Error('Blocked non-fixture request');
        return original(input, init);
      };
    });
    expect((await page.evaluate(() => window.snipvia.capture.start())).ok).toBe(true);
    const overlay = app.windows().find(window => window.url().endsWith('#capture'))!;
    await expect(overlay.locator('.screen-frame')).toBeVisible();
    await overlay.mouse.move(100, 100); await overlay.mouse.down(); await overlay.mouse.move(400, 300); await overlay.mouse.up();
    await expect.poll(() => app.windows().some(window => window.url().endsWith('#quick-chat'))).toBe(true);
    const quick = app.windows().find(window => window.url().endsWith('#quick-chat'))!;
    await expect(quick.getByLabel('对话模型')).toHaveValue('deepseek:https://api.deepseek.com');
    await quick.getByLabel('悬浮对话问题').fill('解释这张合成截图'); await quick.getByLabel('悬浮对话问题').press('Enter');
    await expect(quick.locator('.agent-answer')).toContainText('DeepSeek 图片对话模拟通过');
    const recorded = await app.evaluate(() => (globalThis as typeof globalThis & { providerFixture?: { body: { model: string; thinking: unknown; messages: { content: unknown }[]; tools: unknown[] }; keyMatched: boolean } }).providerFixture!);
    expect(recorded.keyMatched).toBe(true); expect(recorded.body.model).toBe('deepseek-flash'); expect(recorded.body.thinking).toEqual({ type: 'disabled' });
    expect(JSON.stringify(recorded.body.messages)).toContain('data:image/jpeg;base64,'); expect(recorded.body.tools.length).toBeGreaterThan(0);
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});
