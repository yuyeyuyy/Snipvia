import { expect, test, type ElectronApplication } from '@playwright/test';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { launchDesktop } from '../helpers/desktop';
import { expectNeutralChrome } from '../helpers/neutral-chrome';

type Probe = { jev: number; classifications: number; executions: number; authorized: boolean; images: { width: number; height: number }[]; bodies: string[]; opened: string[]; blocked: string[]; mode: 'match' | 'none' | 'error' | 'delay'; release: (() => void) | null };
async function probe(app: ElectronApplication) {
  return app.evaluate(() => { const value = (globalThis as typeof globalThis & { jevProbe: Probe }).jevProbe;return { ...value, release: null }; });
}
async function predict(app: ElectronApplication) {
  const page = await app.firstWindow();expect((await page.evaluate(() => window.snipvia.capture.start())).ok).toBe(true);
  const overlay = app.windows().find(window => window.url().endsWith('#capture'))!;await expect(overlay.locator('.screen-frame')).toBeVisible();
  await overlay.mouse.move(100, 100);await overlay.mouse.down();await overlay.mouse.move(160, 140);await overlay.mouse.up();
  await expect.poll(() => app.windows().some(window => window.url().endsWith('#quick-chat'))).toBe(true);
  const quick = app.windows().find(window => window.url().endsWith('#quick-chat'))!;
  await quick.getByLabel('悬浮对话问题').press('Enter');return quick;
}

test('Jev vision configuration, direct prediction, existing execution, explicit failures and LLM fallback stay local-first', async () => {
  test.setTimeout(120_000);
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'snipvia-jev-'))), data = join(directory, 'data'), bootstrap = join(directory, 'bootstrap.cjs');
  await writeFile(bootstrap, `
    const {app,desktopCapturer,nativeImage,screen,systemPreferences,shell,session}=require('electron');
    const probe=globalThis.jevProbe={jev:0,classifications:0,executions:0,authorized:true,images:[],bodies:[],opened:[],blocked:[],mode:'match',release:null};
    shell.openExternal=async url=>{probe.opened.push(url)};
    globalThis.fetch=async (input,init={})=>{
      const url=String(input),headers=new Headers(init.headers),body=init.body?JSON.parse(String(init.body)):{};
      if(url==='https://api.typesafe.ai/v1/systemone'){
        probe.jev++;probe.authorized&&=headers.get('authorization')==='Bearer synthetic-jev-key'&&!headers.has('cookie')&&headers.get('TypeSafe-Danger-Zone-Images')==='true'&&init.credentials==='omit'&&init.redirect==='error';probe.bodies.push(String(init.body));
        const asset=body.assets['snipvia-selected-crop'];probe.images.push(nativeImage.createFromBuffer(Buffer.from(asset.data_base64,'base64')).getSize());
        if(probe.mode==='error')return new Response('PRIVATE_RESPONSE_DO_NOT_LEAK',{status:401});
        const choice=(criteria,key)=>({type:'choice',choice:key,confidence:0.98,probabilities:Object.fromEntries(Object.keys(criteria).map(id=>[id,id===key?1:0]))});
        const result={model:body.model,answers:{branch:choice(body.questions.branch.criteria,probe.mode==='none'?'no_match':'branch_0'),content:choice(body.questions.content.criteria,'code'),schedule:{type:'noul',noul:0}},usage:{input_tokens:100,output_tokens:10}};
        if(probe.mode==='delay')await new Promise(resolve=>{probe.release=resolve});
        return Response.json(result);
      }
      if(url.startsWith('http://127.0.0.1:9191/v1/')){
        probe.authorized&&=headers.get('authorization')==='Bearer synthetic-chat-key'&&!String(init.body).includes('synthetic-jev-key');
        if(url.endsWith('/models'))return Response.json({data:[]});
        const classification=String(body.messages?.[0]?.content).includes('You are a screenshot classifier');
        if(classification)probe.classifications++;else probe.executions++;
        return Response.json({choices:[{finish_reason:'stop',message:{content:classification?JSON.stringify({contentType:'code',confidence:0.98,matchedBranchId:'explain-code',signals:{hasCode:true}}):'沿用原 Agent 执行流程。'}}]});
      }
      if(url.startsWith('https://api.github.com/'))return new Response('',{status:404});
      probe.blocked.push(new URL(url).origin);throw new TypeError('External service blocked in synthetic Jev acceptance');
    };
    app.whenReady().then(()=>{
      session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_details,callback)=>callback({cancel:true}));
      systemPreferences.getMediaAccessStatus=()=> 'granted';
      desktopCapturer.getSources=async options=>{const display=screen.getDisplayNearestPoint(screen.getCursorScreenPoint()),size=options.thumbnailSize;return [{id:'screen:synthetic',name:'Synthetic screen',display_id:String(display.id),appIcon:nativeImage.createEmpty(),thumbnail:nativeImage.createFromBitmap(Buffer.alloc(size.width*size.height*4,255),size)}]};
      require(${JSON.stringify(resolve('out/main/index.js'))});
    });
  `);
  let app: ElectronApplication | undefined, logs = '';
  const launch = async () => {
    app = await launchDesktop({ args: [bootstrap, `--user-data-dir=${data}`], env: { ...process.env, ELECTRON_RENDERER_URL: '', SNIPVIA_CAPTURE_BACKEND: 'electron', SNIPVIA_CAPTURE_WARMUP: '0' } });
    for (const stream of [app.process().stdout, app.process().stderr]) stream?.on('data', chunk => { logs += String(chunk); });
    return app;
  };
  try {
    app = await launch();let page = await app.firstWindow();
    expect((await page.evaluate(() => window.snipvia.prediction.get()))).toMatchObject({ ok: true, value: { enabled: false, hasApiKey: false } });
    expect((await page.evaluate(async () => {
      const value = await window.snipvia.settings.get();if (!value.ok) throw new Error(value.error);
      return window.snipvia.settings.save({ ...value.value, provider: 'custom', endpoint: 'http://127.0.0.1:9191/v1', model: 'synthetic-chat', apiKey: 'synthetic-chat-key',
        predictionBranches: value.value.predictionBranches.map(branch => ({ ...branch, enabled: branch.id === 'explain-code', prompt: branch.id === 'explain-code' ? 'PRIVATE_EXECUTION_PROMPT' : branch.prompt })) });
    })).ok).toBe(true);
    const chatSettingsBefore = await readFile(join(data, 'settings.json'), 'utf8');
    await page.getByRole('button', { name: '模型与设置', exact: true }).click();
    await page.getByRole('button', { name: '配置 Jev…', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: '配置 Jev 图片预测' });
    await dialog.getByRole('button', { name: '前往 TypeSafe 官网获取 Key ↗' }).click();expect((await probe(app)).opened).toEqual(['https://console.typesafe.ai/']);
    await dialog.getByLabel('Jev API Key').fill('synthetic-jev-key');await dialog.getByRole('button', { name: '保存并启用', exact: true }).click();
    await expect(page.getByLabel('启用 Jev 图片预测')).toBeChecked();
    const encrypted = await readFile(join(data, 'prediction-settings.json'), 'utf8');expect(encrypted).not.toContain('synthetic-jev-key');expect(await readFile(join(data, 'settings.json'), 'utf8')).toBe(chatSettingsBefore);
    const publicValue = await page.evaluate(() => window.snipvia.prediction.get());expect(JSON.stringify(publicValue)).not.toContain('synthetic-jev-key');expect(publicValue).toMatchObject({ ok: true, value: { enabled: true, model: 'jev-1.14.0', hasApiKey: true } });
    await page.getByRole('button', { name: '配置 Jev…', exact: true }).click();dialog = page.getByRole('dialog', { name: '配置 Jev 图片预测' });
    await expect(dialog.getByLabel('Jev API Key')).toHaveValue('');await expectNeutralChrome(page);
    await page.screenshot({ path: 'docs/ui/jev-prediction-light.png', animations: 'disabled' });
    await page.evaluate(() => window.snipvia.appearance.set('dark'));await expectNeutralChrome(page);await page.screenshot({ path: 'docs/ui/jev-prediction-dark.png', animations: 'disabled' });
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    await app.close();app = await launch();page = await app.firstWindow();
    expect(await page.evaluate(() => window.snipvia.prediction.get())).toMatchObject({ ok: true, value: { enabled: true, hasApiKey: true } });
    let quick = await predict(app);await expect(quick.getByLabel('预测分支')).toHaveText('解释代码');await expect(quick.locator('.agent-answer')).toContainText('沿用原 Agent');
    let value = await probe(app);expect(value).toMatchObject({ jev: 1, classifications: 0, executions: 1, authorized: true, blocked: [] });
    expect(value.images).toEqual([{ width: 280, height: 280 }]);expect(value.bodies[0]).not.toMatch(/PRIVATE_EXECUTION_PROMPT|synthetic-chat-key|notebookId/);
    expect((await quick.evaluate(() => window.snipvia.prediction.save({ enabled: false, model: 'jev-1.14.0' })))).toMatchObject({ ok: false });
    expect((await page.evaluate(() => window.snipvia.prediction.save({ enabled: true, model: 'jev-1.14.0', endpoint: 'https://evil.test' } as unknown as Parameters<typeof window.snipvia.prediction.save>[0])))).toMatchObject({ ok: false });
    expect(await readFile(join(data, 'prediction-settings.json'), 'utf8')).toBe(encrypted);
    await quick.getByRole('button', { name: '返回软件' }).click();
    await app.evaluate(() => { (globalThis as typeof globalThis & { jevProbe: Probe }).jevProbe.mode = 'error'; });
    quick = await predict(app);await expect(quick.getByRole('alert')).toContainText('分支预测模型鉴权失败');await expect(quick.getByRole('alert')).not.toContainText('PRIVATE');
    await expect(quick.getByRole('alert')).toContainText('HTTP 401');expect(await probe(app)).toMatchObject({ jev: 2, classifications: 0, executions: 1 });
    await quick.getByLabel('悬浮对话问题').press('Enter');await expect.poll(async () => (await probe(app!)).jev).toBe(3);
    await quick.getByRole('button', { name: '返回软件' }).click();
    await app.evaluate(() => { (globalThis as typeof globalThis & { jevProbe: Probe }).jevProbe.mode = 'delay'; });
    quick = await predict(app);await expect.poll(async () => (await probe(app!)).jev).toBe(4);
    expect((await page.evaluate(() => window.snipvia.prediction.save({ enabled: false, model: 'jev-1.14.0' })))).toMatchObject({ ok: true });
    await app.evaluate(() => { (globalThis as typeof globalThis & { jevProbe: Probe }).jevProbe.release?.(); });
    await expect.poll(async () => { const state = await quick.evaluate(() => window.snipvia.chat.state());return state.ok && state.value.autoAction?.state; }).not.toBe('analyzing');
    expect((await probe(app)).executions).toBe(1);await quick.getByRole('button', { name: '返回软件' }).click();
    await page.getByRole('button', { name: '模型与设置', exact: true }).click();
    await page.getByRole('button', { name: '配置 Jev…', exact: true }).click();
    dialog = page.getByRole('dialog', { name: '配置 Jev 图片预测' });
    await dialog.getByLabel('删除 Jev Key').check();
    await dialog.getByRole('button', { name: '删除并使用对话模型', exact: true }).click();
    expect(await page.evaluate(() => window.snipvia.prediction.get())).toMatchObject({ ok: true, value: { hasApiKey: false, enabled: false } });
    // A valid enabled configuration without a key still uses the existing LLM.
    expect(await page.evaluate(() => window.snipvia.prediction.save({ enabled: true, model: 'jev-1.14.0' }))).toMatchObject({ ok: true, value: { hasApiKey: false } });
    quick = await predict(app);await expect(quick.locator('.agent-answer')).toContainText('沿用原 Agent');
    value = await probe(app);expect(value).toMatchObject({ jev: 4, classifications: 1, executions: 2, authorized: true, blocked: [] });
    expect(logs).not.toMatch(/synthetic-jev-key|synthetic-chat-key/);expect(await readFile(join(data, 'settings.json'), 'utf8')).not.toContain('synthetic-jev-key');
  } finally { await app?.close();await rm(directory, { recursive: true, force: true }); }
});

test('damaged Jev configuration preserves its original file and does not prevent account-free startup', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'snipvia-jev-corrupt-'))), file = join(directory, 'prediction-settings.json'), bootstrap = join(directory, 'bootstrap.cjs');
  const original = '{"version":99,"private":"synthetic-unreadable-config"}';await writeFile(file, original);
  await writeFile(bootstrap, `globalThis.fetch=async()=>{throw new TypeError('Offline fixture')};require(${JSON.stringify(resolve('out/main/index.js'))});`);
  const app = await launchDesktop({ args: [bootstrap, `--user-data-dir=${directory}`], env: { ...process.env, ELECTRON_RENDERER_URL: '', SNIPVIA_CAPTURE_BACKEND: 'electron', SNIPVIA_CAPTURE_WARMUP: '0' } });
  try {
    const page = await app.firstWindow();await page.getByRole('button', { name: '模型与设置', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Jev 配置读取失败');await expect(page.locator('body')).toContainText('其他本地功能仍可使用');
    await expect(page.getByRole('button', { name: '配置 Jev…', exact: true })).toBeDisabled();
    expect(await page.evaluate(() => window.snipvia.prediction.save({ enabled: false, model: 'jev-1.14.0' }))).toMatchObject({ ok: false });
    expect(await readFile(file, 'utf8')).toBe(original);
    await page.getByRole('button', { name: 'AI 笔记', exact: true }).click();await expect(page.getByRole('button', { name: 'AI 笔记', exact: true })).toHaveAttribute('aria-current', 'page');
    expect((await page.evaluate(() => window.snipvia.settings.get())).ok).toBe(true);
  } finally { await app.close();await rm(directory, { recursive: true, force: true }); }
});
