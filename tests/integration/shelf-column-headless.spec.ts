import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, readFile, writeFile, rm, mkdir, readdir, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test('offscreen Shelf supports photo layers, compact rows, centered preview, edge docking and persistent settings', async () => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(join(tmpdir(), 'snipvia-shelf-column-')), root = resolve('.');
  const exportRoot = join(directory, 'exports'); await mkdir(exportRoot);
  const dragRoot = join(directory, 'drag'); await mkdir(dragRoot);
  const mainPath = resolve('out/main/index.js'), original = await readFile(mainPath, 'utf8');
  expect(original).toContain('show: !launchedAtLogin()'); expect(original).toContain('const webPreferences = {');
  const source = original.replace('show: !launchedAtLogin()', 'show: false').replace('const webPreferences = {', 'const webPreferences = { offscreen: true,');
  const bootstrap = join(directory, 'bootstrap.cjs');
  await writeFile(bootstrap, [
    "const{app,BrowserWindow,globalShortcut,clipboard,dialog,nativeImage}=require('electron');",
    "if(process.platform==='darwin'){app.setActivationPolicy('prohibited');app.setActivationPolicy=()=>{};if(app.dock){app.dock.show=async()=>{};app.dock.setIcon=()=>{};}}",
    "BrowserWindow.prototype.show=()=>{};BrowserWindow.prototype.showInactive=()=>{};BrowserWindow.prototype.focus=()=>{};",
    "const visible=BrowserWindow.prototype.isVisible;globalThis.realVisible=w=>visible.call(w);BrowserWindow.prototype.isVisible=function(){return this.webContents.getURL().endsWith('#shelf')||visible.call(this);};app.whenReady().then(()=>{require('electron').screen.getCursorScreenPoint=()=>globalThis.shelfProbe.cursor||({x:-100000,y:-100000});});",
    "globalShortcut.register=()=>true;globalShortcut.unregisterAll=()=>{};globalThis.shelfProbe={copies:0,batches:[],fileBatches:[],fail:false,nativeDrags:[],settingsShows:0};let clipboardItems=[];clipboard.read=async()=>clipboardItems;clipboard.write=async(items)=>{const probe=globalThis.shelfProbe;if(probe.fail)throw Error('synthetic clipboard denied');probe.copies++;const batch=[],files=[];for(const item of items){const type=item.types[0],blob=await item.getType(type);if(type==='text/uri-list'){for(const uri of (await blob.text()).split(/\\r?\\n/)){const file=require('node:url').fileURLToPath(uri),bytes=require('node:fs').readFileSync(file);files.push(file);batch.push({type:file.endsWith('.png')?'image/png':'image/jpeg',sha:require('node:crypto').createHash('sha256').update(bytes).digest('hex'),...nativeImage.createFromBuffer(bytes).getSize()});}}else{const bytes=Buffer.from(await blob.arrayBuffer());batch.push({type,sha:require('node:crypto').createHash('sha256').update(bytes).digest('hex'),...nativeImage.createFromBuffer(bytes).getSize()});}}probe.batches.push(batch);probe.fileBatches.push({files,types:items.map(item=>item.types)});clipboardItems=items;};",
    "app.on('web-contents-created',(_event,contents)=>{contents.startDrag=item=>{const bytes=require('node:fs').readFileSync(item.file);globalThis.shelfProbe.nativeDrags.push({file:item.file,sha:require('node:crypto').createHash('sha256').update(bytes).digest('hex'),icon:item.icon.getSize(),empty:item.icon.isEmpty()});};});",
    "dialog.showOpenDialog=async()=>({canceled:false,filePaths:[" + JSON.stringify(exportRoot) + "]});",
    'app.setPath("temp",' + JSON.stringify(dragRoot) + ');',
    'app.setAppPath(' + JSON.stringify(root) + ');',
    'require("node:module")._extensions[".js"]=((original)=>(module,path)=>path===' + JSON.stringify(mainPath) + '?module._compile(' + JSON.stringify(source) + ',path):original(module,path))(require("node:module")._extensions[".js"]);',
    'globalThis.client=require(' + JSON.stringify(mainPath) + ');',
    "globalThis.seedShelf=(sources)=>{for(const src of sources){const image=nativeImage.createFromDataURL(src),png=image.toPNG();const item=globalThis.client.screenshots.create(png,{...image.getSize(),mimeType:'image/png'});globalThis.client.collection.append(item.id);}};"
  ].join('\n'));
  const launch = () => electron.launch({ args: [bootstrap, '--user-data-dir=' + join(directory, 'data')], env: { ...process.env, ELECTRON_RENDERER_URL: '', SNIPVIA_CAPTURE_BACKEND: 'electron', SNIPVIA_CAPTURE_WARMUP: '0', SNIPVIA_PERF: '' } });
  let app: ElectronApplication | undefined;
  const click = (page: Page, name: string) => page.getByRole('button', { name, exact: true }).evaluate(button => (button as HTMLButtonElement).click());
  try {
    process.stderr.write('[shelf edge] launch\n');
    app = await launch();
    const main = await app.firstWindow(); await main.locator('.app-shell').waitFor({ state: 'attached' });
    process.stderr.write('[shelf edge] config\n');
    const configuration = await main.evaluate(() => window.snipvia.collection.current()); if (!configuration.ok) throw Error(configuration.error);
    expect((await main.evaluate(value => window.snipvia.collection.configure(value), { ...configuration.value.preferences, autoHide: false })).ok).toBe(true);
    process.stderr.write('[shelf edge] seed\n');
    const sources = await main.evaluate(() => Array.from({ length: 8 }, (_, i) => {
      const canvas = document.createElement('canvas'); canvas.width = 600; canvas.height = 380;
      const ctx = canvas.getContext('2d')!; ctx.fillStyle = i % 2 ? '#e9edf1' : '#fff'; ctx.fillRect(0, 0, 600, 380);
      ctx.fillStyle = '#181818'; ctx.font = 'bold 32px system-ui'; ctx.fillText('CAPTURE / ' + String(i + 1).padStart(2, '0'), 28, 54);
      ctx.font = '18px system-ui'; ctx.fillStyle = '#636363'; ctx.fillText('A small collection of useful things.', 28, 90);
      ctx.fillStyle = ['#9cb8b4', '#b1a5c6', '#b9b2a0'][i % 3]; ctx.fillRect(28, 120, 544, 225);
      ctx.fillStyle = '#fafafa'; ctx.font = 'bold 54px system-ui'; ctx.fillText('Keep your flow.', 62, 255); return canvas.toDataURL();
    }));
    await app.evaluate((_electron, sources) => (globalThis as typeof globalThis & { seedShelf(s: string[]): void }).seedShelf(sources), sources);
    process.stderr.write('[shelf edge] show\n');
    expect((await main.evaluate(() => window.snipvia.collection.toggle())).ok).toBe(true);
    await expect.poll(() => app!.windows().some(page => page.url().endsWith('#shelf'))).toBe(true);
    const shelf = app.windows().find(page => page.url().endsWith('#shelf'))!;
    await shelf.emulateMedia({ reducedMotion: 'no-preference' });
    const still = () => expect.poll(() => shelf.evaluate(() => document.getAnimations().every(animation => animation.playState !== 'running'))).toBe(true);
    const tools = async (index = 0) => {
      await shelf.locator('.shelf-preview').nth(index).evaluate(button => {
        button.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }));
        (button as HTMLButtonElement).focus({ preventScroll: true });
      });
      if (await shelf.locator('.shelf.expanded').count()) await expect(shelf.locator('.workspace-header .shelf-output-actions')).toHaveCount(1);
      else await expect(shelf.locator('.shelf-tools')).toHaveAttribute('aria-hidden', 'false');
    };
    await mkdir('test-results/shelf-edge', { recursive: true });
    const snapshot = async (name: string, checkEdge = true) => {
      await still();
      await expect(shelf.locator('[data-action-state="success"]')).toHaveCount(0);
      const png = await app!.evaluate(async ({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('#shelf'))!;
        const image = await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
        const bitmap = image.toBitmap(), size = image.getSize(), edges: number[] = [];
        for (let x = 0; x < size.width; x++) edges.push(bitmap[x * 4 + 3], bitmap[((size.height - 1) * size.width + x) * 4 + 3]);
        for (let y = 0; y < size.height; y++) edges.push(bitmap[y * size.width * 4 + 3], bitmap[(y * size.width + size.width - 1) * 4 + 3]);
        return { bytes: [...image.toPNG()], edge: Math.max(...edges), size };
      });
      await writeFile('test-results/shelf-edge/' + name + '.png', Buffer.from(png.bytes));
      if (checkEdge) expect(png.edge).toBe(0);
      return png.size;
    };
    process.stderr.write('[shelf edge] layout\n');
    await expect(shelf.locator('.shelf.expanded')).toHaveCount(1); await still();
    await expect(shelf.locator('.shelf-preview img')).toHaveCount(8);
    const border = await shelf.locator('.shelf-preview img').first().evaluate(image => {
      const style = getComputedStyle(image), card = image.closest('.shelf-card')!;
      const scale = new DOMMatrix(getComputedStyle(card).transform).a;
      // The first zero-blur shadow is a fractional-width ring, avoiding outline pixel snapping.
      const ring = style.boxShadow.match(/\) 0px 0px 0px ([\d.]+)px/);
      return { width: ring ? Number(ring[1]) * scale : 0, shadows: style.boxShadow };
    });
    expect(border.width).toBeCloseTo(1, 1); expect(border.shadows).not.toBe('none');
    await expect(shelf.locator('.shelf-tools')).toHaveCount(0);
    await expect(shelf.getByRole('checkbox')).toHaveCount(0);
    for (const name of ['合并选项', '调整收纳区大小', '拖动调整收纳区大小', '加宽收纳区', '恢复收纳宽度']) await expect(shelf.getByRole('button', { name, exact: true })).toHaveCount(0);
    const layout = await shelf.locator('.shelf-card').evaluateAll(nodes => nodes.map(node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, bottom: r.bottom, width: r.width }; }));
    expect(new Set(layout.map(r => Math.round(r.x))).size).toBe(1);
    expect(layout[0].width).toBeGreaterThan(350);
    for (let i = 1; i < layout.length; i++) expect(Math.abs(layout[i].y - layout[i - 1].bottom - 12)).toBeLessThan(.5);
    const controls = await shelf.locator('.shelf-card-action').evaluateAll(nodes => nodes.map(node => { const r = node.getBoundingClientRect(); return { width: r.width, height: r.height }; }));
    expect(controls).toHaveLength(16); for (const r of controls) { expect(r.width).toBeCloseTo(28); expect(r.height).toBeCloseTo(28); }
    const workAreaHeight = await app.evaluate(({ screen }) => screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea.height);
    expect(configuration.value.preferences.heightMode).toBe('screen');
    const initialBounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('#shelf'))!.getBounds());
    expect(initialBounds.height).toBe(Math.round(workAreaHeight * .75));
    process.stderr.write('[shelf edge] copy\n');
    await tools(); expect(await shelf.locator('.shelf-output-actions button').allTextContents()).toEqual(['', '', '']);
    await click(shelf, '复制截图 1');
    await expect(shelf.getByRole('button', { name: '复制截图 1', exact: true })).toHaveAttribute('data-action-state', 'success');
    await expect(shelf.getByRole('status')).toHaveCount(0);
    const copiedAt = Date.now(); await expect(shelf.getByRole('button', { name: '复制截图 1', exact: true })).toHaveAttribute('data-action-state', 'idle');
    expect(Date.now() - copiedAt).toBeGreaterThanOrEqual(850);
    process.stderr.write('[shelf edge] native-file-drag\n');
    const dragState = await main.evaluate(() => window.snipvia.collection.current()); if (!dragState.ok) throw Error(dragState.error);
    const dragRequest = { id: dragState.value.collection.items[0].id, revision: dragState.value.collection.revision };
    expect((await main.evaluate(request => window.snipvia.collection.startDrag(request), dragRequest)).ok).toBe(false);
    expect((await shelf.evaluate(request => window.snipvia.collection.startDrag({ ...request, revision: request.revision - 1 }), dragRequest)).ok).toBe(false);
    expect((await shelf.evaluate(request => window.snipvia.collection.startDrag({ ...request, id: crypto.randomUUID() }), dragRequest)).ok).toBe(false);
    expect((await shelf.evaluate(request => { const forged = { ...request, path: '/untrusted' }; return window.snipvia.collection.startDrag(forged); }, dragRequest)).ok).toBe(false);
    // CDP input stays inside this hidden Chromium page and never moves the OS cursor.
    const dragSource = await shelf.locator('.shelf-preview').first().boundingBox(); if (!dragSource) throw Error('Drag source missing');
    await shelf.mouse.move(dragSource.x + dragSource.width / 2, dragSource.y + dragSource.height / 2);
    await shelf.mouse.down();
    await shelf.mouse.move(dragSource.x + dragSource.width / 2 + 36, dragSource.y + dragSource.height / 2 + 12, { steps: 6 });
    await shelf.mouse.up(); await shelf.mouse.move(0, 0);
    type DragProbe = { nativeDrags: { file: string; sha: string; icon: { width: number; height: number }; empty: boolean }[]; settingsShows: number; cursor?: { x: number; y: number } };
    await expect.poll(() => app!.evaluate(() => (globalThis as typeof globalThis & { shelfProbe: DragProbe }).shelfProbe.nativeDrags.length)).toBe(1);
    const dragged = await app.evaluate((_electron, id) => {
      const probe = (globalThis as typeof globalThis & { shelfProbe: DragProbe }).shelfProbe;
      const client = (globalThis as typeof globalThis & { client: { screenshots: { image(id: string): { bytes: Buffer } } } }).client;
      return { ...probe.nativeDrags[0], sourceSha: process.getBuiltinModule('node:crypto').createHash('sha256').update(client.screenshots.image(id).bytes).digest('hex') };
    }, dragRequest.id);
    expect(dragged.file.startsWith(dragRoot)).toBe(true); expect(dragged.file.endsWith('.png')).toBe(true); expect(dragged.sha).toBe(dragged.sourceSha);
    expect(dragged.empty).toBe(false); expect(dragged.icon.width).toBeLessThanOrEqual(96); expect(dragged.icon.height).toBeLessThanOrEqual(96);
    await click(shelf, '预览截图 1'); await expect(shelf.locator('.shelf-preview-scene')).toHaveCount(0);
    const topButtons = await shelf.locator('.workspace-header .shelf-output-actions button').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().bottom));
    expect(topButtons).toHaveLength(3); expect(Math.max(...topButtons)).toBeLessThan(44);
    process.stderr.write('[shelf edge] reorder\n');
    const initial = await main.evaluate(() => window.snipvia.collection.current()); if (!initial.ok) throw Error(initial.error);
    await shelf.evaluate(() => {
      const cards = [...document.querySelectorAll<HTMLElement>('.shelf-card')], source = cards[0], scroll = document.querySelector('.shelf-scroll')!;
      source.setPointerCapture = () => {}; source.hasPointerCapture = () => false;
      const start = source.getBoundingClientRect(), x = start.x + start.width / 2, y = start.y + start.height / 2;
      source.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1, altKey: true, clientX: x, clientY: y }));
      cards[2].scrollIntoView({ block: 'center' });
      const end = cards[2].getBoundingClientRect(), endY = end.y + end.height / 2;
      source.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, altKey: true, clientX: x + 12, clientY: endY }));
      source.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, altKey: true, clientX: x + 12, clientY: endY })); scroll.scrollTop = 0;
    });
    await expect.poll(async () => { const r = await main.evaluate(() => window.snipvia.collection.current()); return r.ok ? r.value.collection.items[2].id : ''; }).toBe(initial.value.collection.items[0].id);
    process.stderr.write('[shelf edge] selection\n');
    await click(shelf, '多选截图'); await expect(shelf.getByRole('checkbox')).toHaveCount(8);
    for (const index of [1, 3]) await shelf.getByRole('checkbox', { name: '选择截图 ' + index, exact: true }).evaluate(input => (input as HTMLInputElement).click());
    await tools(); await click(shelf, '导出 PNG');
    await expect(shelf.getByRole('button', { name: '导出 PNG', exact: true })).toHaveAttribute('data-action-state', 'success');
    const selectedFolder = (await readdir(exportRoot))[0]; expect((await readdir(join(exportRoot, selectedFolder))).length).toBe(2);
    process.stderr.write('[shelf edge] copy-all\n');
    await click(shelf, '全部复制');
    await expect(shelf.getByRole('button', { name: '全部复制', exact: true })).toHaveAttribute('data-action-state', 'success');
    const batch = await app.evaluate(() => (globalThis as typeof globalThis & { shelfProbe: { batches: { type: string; sha: string; width: number; height: number }[][] } }).shelfProbe.batches.at(-1)!);
    expect(batch).toHaveLength(8);
    const originals = await app.evaluate(() => {
      const client = (globalThis as typeof globalThis & { client: { collection: { snapshot(): { items: { id: string }[] } }; screenshots: { image(id: string): { bytes: Buffer } } } }).client;
      return client.collection.snapshot().items.map(item => process.getBuiltinModule('node:crypto').createHash('sha256').update(client.screenshots.image(item.id).bytes).digest('hex'));
    });
    expect(batch.map(item => item.sha)).toEqual(originals);
    const copiedFiles = await app.evaluate(() => (globalThis as typeof globalThis & { shelfProbe: { fileBatches: { files: string[]; types: string[][] }[] } }).shelfProbe.fileBatches.at(-1)!);
    expect(copiedFiles.types).toEqual([['text/uri-list']]); expect(copiedFiles.files).toHaveLength(8);
    for (const [index, path] of copiedFiles.files.entries()) {
      expect((await realpath(path)).startsWith(await realpath(join(directory, 'data', 'clipboard-files')))).toBe(true);
      expect((await import('node:crypto')).createHash('sha256').update(await readFile(path)).digest('hex')).toBe(originals[index]);
    }
    expect(batch.every(item => item.type === 'image/png' && item.width === 600 && item.height === 380)).toBe(true);
    expect((await main.evaluate(() => window.snipvia.collection.copyAll({ revision: 0 }))).ok).toBe(false);
    expect((await shelf.evaluate(() => window.snipvia.collection.copyAll({ revision: 0 }))).ok).toBe(false);
    await click(shelf, '退出多选'); await expect(shelf.getByRole('checkbox')).toHaveCount(0);
    await tools(1); await click(shelf, '删除截图 2'); await expect(shelf.locator('.shelf-card')).toHaveCount(7);
    process.stderr.write('[shelf edge] collapse\n');
    const expandedBounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('#shelf'))!.getBounds());
    await click(shelf, '收起收纳区'); await expect(shelf.locator('.shelf.collapsed')).toHaveCount(1); await still();
    const collapsedBounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('#shelf'))!.getBounds());
    expect(collapsedBounds.height).toBeLessThan(expandedBounds.height);
    await shelf.evaluate(() => { (document.activeElement as HTMLElement)?.blur(); document.querySelector('.shelf-preview')?.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, relatedTarget: document.body })); });
    await expect(shelf.locator('.shelf-tools')).toHaveAttribute('aria-hidden', 'true');
    process.stderr.write('[shelf edge] idle-snapshot\n');
    await snapshot('collapsed-idle');
    await tools(6);
    const toolbar = await shelf.locator('.shelf-tools').boundingBox(), photo = await shelf.locator('.shelf-card').last().boundingBox();
    expect(toolbar!.y).toBeGreaterThan(photo!.y); expect(toolbar!.y + toolbar!.height).toBeLessThanOrEqual(photo!.y + photo!.height);
    await snapshot('collapsed-hover');
    process.stderr.write('[shelf edge] outputs\n');
    await click(shelf, '合并复制'); await expect(shelf.getByRole('button', { name: '合并复制', exact: true })).toHaveAttribute('data-action-state', 'success');
    await click(shelf, '导出 PNG'); await expect(shelf.getByRole('button', { name: '导出 PNG', exact: true })).toHaveAttribute('data-action-state', 'success');
    expect((await readdir(exportRoot)).length).toBe(2);
    await expect(shelf.getByRole('button', { name: '导出 PNG', exact: true })).toHaveAttribute('data-action-state', 'idle');
    await app.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] }); });
    await click(shelf, '导出 PNG'); await expect(shelf.getByRole('button', { name: '导出 PNG', exact: true })).toHaveAttribute('data-action-state', 'idle');
    await expect(shelf.getByRole('status')).toHaveCount(0);
    await app.evaluate(() => { (globalThis as typeof globalThis & { shelfProbe: { fail: boolean } }).shelfProbe.fail = true; });
    await click(shelf, '全部复制'); await expect(shelf.getByRole('status')).toContainText('synthetic clipboard denied');
    await expect(shelf.getByRole('button', { name: '全部复制', exact: true })).toHaveAttribute('data-action-state', 'idle');
    await app.evaluate(() => { (globalThis as typeof globalThis & { shelfProbe: { fail: boolean } }).shelfProbe.fail = false; });
    await shelf.getByRole('status').evaluate(button => (button as HTMLButtonElement).click());
    const current = await main.evaluate(() => window.snipvia.collection.current()); if (!current.ok) throw Error(current.error);
    expect((await shelf.evaluate(config => window.snipvia.collection.configure(config), current.value.preferences)).ok).toBe(false);
    expect((await main.evaluate(() => window.snipvia.collection.resize({ width: 500, height: 740 }))).ok).toBe(false);
    expect((await shelf.evaluate(() => window.snipvia.collection.resize({ width: NaN, height: 740 }))).ok).toBe(false);
    expect((await shelf.evaluate(() => window.snipvia.collection.interaction('bad' as unknown as boolean))).ok).toBe(false);
    process.stderr.write('[shelf edge] settings\n');
    await click(main, '收纳区');
    const number = async (label: string, value: string) => {
      const input = main.getByRole('spinbutton', { name: label, exact: true });
      await expect(input).toBeEnabled();
      await input.evaluate((element, value) => { const e = element as HTMLInputElement; e.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(e, value); e.dispatchEvent(new Event('input', { bubbles: true })); }, value);
      await input.evaluate(element => (element as HTMLInputElement).blur());
    };
    await number('收纳区宽度', '500'); await expect.poll(async () => JSON.parse(await readFile(join(directory, 'data/shelf-preferences.json'), 'utf8')).width).toBe(500);
    await main.getByRole('combobox', { name: '展开高度模式', exact: true }).selectOption('fixed');
    await number('展开高度', '740'); await expect.poll(async () => JSON.parse(await readFile(join(directory, 'data/shelf-preferences.json'), 'utf8')).height).toBe(740);
    process.stderr.write('[shelf edge] expand-before-preview\n');
    await shelf.getByRole('button', { name: '展开截图收纳区', exact: true }).last().evaluate(button => (button as HTMLButtonElement).click());
    await expect(shelf.locator('.shelf.expanded')).toHaveCount(1);
    await expect(shelf.locator('.shelf-preview-scene')).toHaveCount(0);
    const opened = await main.evaluate(() => window.snipvia.collection.current()); if (!opened.ok) throw Error(opened.error);
    expect(opened.value.viewport).toEqual({ width: 500, height: Math.min(740, workAreaHeight) });
    expect(opened.value.wide).toBe(false);
    await still();
    await shelf.getByRole('button', { name: '预览截图 7', exact: true }).evaluate(button => button.scrollIntoView({ block: 'center' }));
    await click(shelf, '预览截图 7'); await expect(shelf.locator('.shelf-preview-scene')).toHaveCount(1);
    await expect(shelf.getByAltText('原图预览')).toHaveAttribute('src', /^blob:/); await still();
    const centered = await shelf.getByAltText('原图预览').evaluate(node => { const r = node.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, viewX: innerWidth / 2, viewY: innerHeight / 2, width: r.width }; });
    expect(centered.x).toBeCloseTo(centered.viewX, 0); expect(centered.y).toBeCloseTo(centered.viewY, 0); expect(centered.width).toBeGreaterThan(500);
    const animation = await shelf.getByAltText('原图预览').evaluate(node => node.getAnimations().map(a => ({ frames: (a.effect as KeyframeEffect).getKeyframes().map(k => k.transform), duration: a.effect?.getTiming().duration })));
    expect(animation[0].frames[0]).not.toBe(animation[0].frames.at(-1)); expect(animation[0].duration).toBe(340);
    process.stderr.write('[shelf edge] center-snapshot\n');
    await snapshot('centered-preview');
    const previewState = await main.evaluate(() => window.snipvia.collection.current()); if (!previewState.ok) throw Error(previewState.error);
    expect((await shelf.evaluate(p => window.snipvia.collection.previewFinished(p - 1), previewState.value.presentation)).ok).toBe(true);
    await click(shelf, '关闭原图预览'); await expect(shelf.locator('.shelf.expanded')).toHaveCount(1);
    expect((await main.evaluate(() => window.snipvia.collection.openPreview({ id: crypto.randomUUID(), source: { x: 0, y: 0, width: 10, height: 10 } }))).ok).toBe(false);
    process.stderr.write('[shelf edge] expanded-snapshot\n');
    await tools(); await snapshot('expanded-hover');
    await main.evaluate(() => window.snipvia.appearance.set('dark')); await expect(shelf.locator('html')).toHaveAttribute('data-theme', 'dark'); await snapshot('expanded-dark');
    process.stderr.write('[shelf edge] narrow\n');
    const narrow = await main.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 10; canvas.height = 700; const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 10, 700); return canvas.toDataURL(); });
    await app.evaluate((_electron, source) => (globalThis as typeof globalThis & { seedShelf(s: string[]): void }).seedShelf([source]), narrow);
    await click(shelf, '收起收纳区'); await click(shelf, '展开图堆'); await click(shelf, '多选截图'); await still();
    const narrowImage = await shelf.locator('.shelf-card').last().locator('img').evaluate(image => {
      const r = image.getBoundingClientRect(); return { width: r.width, height: r.height };
    });
    expect(narrowImage.width).toBeCloseTo(narrowImage.height * 10 / 700, 1);
    expect(narrowImage.width).toBeLessThan(20);
    const controlBoxes = await shelf.locator('.shelf-card').last().evaluate(card => ['.copy-action', '.shelf-select', '.delete-action'].map(selector => { const r = card.querySelector(selector)!.getBoundingClientRect(); return { left: r.left, right: r.right }; }));
    expect(controlBoxes[0].right).toBeLessThan(controlBoxes[1].left); expect(controlBoxes[1].right).toBeLessThan(controlBoxes[2].left);
    await click(shelf, '退出多选'); await click(shelf, '收起收纳区');
    const beforeNarrow = await main.evaluate(() => window.snipvia.collection.current()); if (!beforeNarrow.ok) throw Error(beforeNarrow.error);
    expect((await main.evaluate(value => window.snipvia.collection.configure({ ...value, width: 280 }), beforeNarrow.value.preferences)).ok).toBe(true);
    await click(shelf, '展开图堆'); await click(shelf, '多选截图'); await still();
    const header = await shelf.locator('.workspace-header button').evaluateAll(nodes => nodes.map(node => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right }; }));
    for (const r of header) { expect(r.left).toBeGreaterThanOrEqual(15); expect(r.right).toBeLessThanOrEqual(265); }
    await click(shelf, '退出多选'); await click(shelf, '收起收纳区');
    expect((await main.evaluate(value => window.snipvia.collection.configure(value), beforeNarrow.value.preferences)).ok).toBe(true);
    process.stderr.write('[shelf edge] auto-hide\n');
    const valid = await main.evaluate(() => window.snipvia.collection.current()); if (!valid.ok) throw Error(valid.error);
    expect((await main.evaluate(value => window.snipvia.collection.configure(value), { ...valid.value.preferences, autoHide: true, hideDelayMs: 600 })).ok).toBe(true);
    await expect.poll(async () => { const r = await main.evaluate(() => window.snipvia.collection.current()); return r.ok ? r.value.edge : ''; }).toBe('docked');
    const dockSize = await snapshot('edge-tab', false); expect(dockSize.width).toBe(22); expect(dockSize.height).toBe(84);
    const collapsedDock = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('#shelf'))!.getBounds());
    process.stderr.write('[shelf edge] reveal\n');
    const settingsShows = await app.evaluate(async ({ BrowserWindow, app }) => {
      const probe = (globalThis as typeof globalThis & { shelfProbe: DragProbe }).shelfProbe;
      const mainWindow = BrowserWindow.getAllWindows().find(w => !new URL(w.webContents.getURL()).hash)!;
      mainWindow.show = () => { probe.settingsShows++; };
      const dock = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('#shelf'))!.getBounds();
      probe.cursor = { x: dock.x + 10, y: dock.y + 40 };
      app.emit('activate'); await new Promise<void>(resolve => setImmediate(resolve));
      return probe.settingsShows;
    });
    expect(settingsShows).toBe(0);
    await expect.poll(async () => { const r = await main.evaluate(() => window.snipvia.collection.current()); return r.ok ? r.value.edge : ''; }).toBe('shown');
    expect((await main.evaluate(value => window.snipvia.collection.configure(value), { ...valid.value.preferences, autoHide: false })).ok).toBe(true);
    await click(shelf, '展开图堆'); await expect(shelf.locator('.shelf.expanded')).toHaveCount(1);
    await app.evaluate(() => { (globalThis as typeof globalThis & { shelfProbe: DragProbe }).shelfProbe.cursor = { x: -100000, y: -100000 }; });
    expect((await main.evaluate(value => window.snipvia.collection.configure(value), { ...valid.value.preferences, autoHide: true, hideDelayMs: 600 })).ok).toBe(true);
    await expect.poll(async () => { const r = await main.evaluate(() => window.snipvia.collection.current()); return r.ok ? r.value.edge : ''; }).toBe('docked');
    const expandedDock = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('#shelf'))!.getBounds());
    expect(expandedDock).toEqual(collapsedDock);
    expect((await main.evaluate(value => window.snipvia.collection.configure(value), { ...valid.value.preferences, autoHide: false })).ok).toBe(true);
    await expect.poll(async () => { const r = await main.evaluate(() => window.snipvia.collection.current()); return r.ok ? r.value.edge : ''; }).toBe('shown');
    expect((await main.evaluate(() => window.snipvia.collection.current())).ok).toBe(true);
    expect(await app.evaluate(async ({ app }) => {
      const probe = (globalThis as typeof globalThis & { shelfProbe: DragProbe }).shelfProbe;
      probe.cursor = { x: -100000, y: -100000 }; app.emit('activate');
      await new Promise<void>(resolve => setImmediate(resolve)); return probe.settingsShows;
    })).toBe(1);
    process.stderr.write('[shelf edge] native-hidden\n');
    const actualHidden = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every(w => !(globalThis as typeof globalThis & { realVisible(w: unknown): boolean }).realVisible(w)));
    expect(actualHidden).toBe(true); expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(4);
    // Clear still requires the original Main confirmation and preserves images on cancellation.
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false }); });
    const cancel = await main.evaluate(() => window.snipvia.collection.clear()); expect(cancel.ok && cancel.value.collection.count).toBe(8);
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); });
    const cleared = await main.evaluate(() => window.snipvia.collection.clear()); expect(cleared.ok && cleared.value.collection.count).toBe(0);
    for (const [index, path] of copiedFiles.files.entries()) expect((await import('node:crypto')).createHash('sha256').update(await readFile(path)).digest('hex')).toBe(originals[index]);
    await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) if (w.webContents.isOffscreen()) w.webContents.stopPainting(); });
    process.stderr.write('[shelf edge] restart\n');
    await app.close(); await expect(readFile(dragged.file)).rejects.toThrow(); process.stderr.write('[shelf edge] exited; relaunch\n'); app = await launch(); process.stderr.write('[shelf edge] relaunched\n'); const restored = await app.firstWindow(); await restored.locator('.app-shell').waitFor({ state: 'attached' });
    for (const [index, path] of copiedFiles.files.entries()) expect((await import('node:crypto')).createHash('sha256').update(await readFile(path)).digest('hex')).toBe(originals[index]);
    const restoredState = await restored.evaluate(() => window.snipvia.collection.current());
    expect(restoredState.ok && restoredState.value.size).toEqual({ width: 500, height: 740 });
    expect(restoredState.ok && restoredState.value.preferences.autoHide).toBe(false);
  } finally {
    // Offscreen paint production must stop before closing the relaunched app too.
    // Otherwise teardown can wait for a hidden renderer's compositor indefinitely.
    await app?.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) if (w.webContents.isOffscreen()) w.webContents.stopPainting(); }).catch(() => {});
    await app?.close(); await rm(directory, { recursive: true, force: true });
  }
});
