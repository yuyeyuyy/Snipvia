import { expectNeutralChrome } from '../helpers/neutral-chrome';
import { expect, test } from '@playwright/test';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Temporal } from '@js-temporal/polyfill';
import { defaults, type ScheduleEvent } from '../../src/shared/contracts';
import { launchMemberDesktop } from '../helpers/desktop-account';
import { tokenColor } from '../helpers/appearance';

// NativeImage makes genuine JPEGs from deterministic pixels before the existing stores load.
test('calendar date agenda and readonly history preserve records, restore actions and Monochrome layouts', async () => {
  test.setTimeout(120_000);
  const directory = await mkdtemp(join(tmpdir(), 'snipvia-workspace-browsing-')); const output = 'docs/ui/ui2-stage3';
  await mkdir(output, { recursive: true });
  const storage = join(directory, 'app'); const timezone = Temporal.Now.timeZoneId();
  const today = Temporal.Now.plainDateISO(); const tomorrow = today.add({ days: 1 });
  const at = (day: typeof today, hour: number) => day.toZonedDateTime({ timeZone: timezone, plainTime: `${String(hour).padStart(2, '0')}:00` }).toInstant().toString();
  const history = Array.from({ length: 18 }, (_, index) => {
    const updatedAt = at(index < 9 ? today : index < 13 ? today.subtract({ days: 1 }) : today.subtract({ days: 6 }), 20 - index % 9);
    const title = index === 0 ? '二分查找：边界与循环不变量' : index === 1 ? '栈与括号匹配' : ['链表反转的三步操作', 'BFS 与最短路径', '动态规划状态转移'][index % 3];
    return { id: randomUUID(), title, createdAt: updatedAt, updatedAt, profile: index % 2 ? { provider: 'qwen', endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen3-vl-plus' } : defaults,
      messages: [{ role: 'user', content: title, createdAt: updatedAt }, { role: 'assistant', content: `## ${title}\n\n明确边界，逐步检查每一次状态变化。\n\n${'### 学习记录\n\n先确定循环不变量，再用空数组、重复元素和边界位置验证实现。\n\n'.repeat(12)}`, createdAt: updatedAt }],
      capture: { id: randomUUID(), fileName: '', width: 360, height: 180, createdAt: updatedAt, continuesConversation: false } };
  });
  history.forEach(item => { item.capture.fileName = `${item.capture.id}.jpg`; });
  const base: ScheduleEvent = { id: randomUUID(), title: '数据结构复习讨论', kind: 'event', allDay: false, startAt: at(today, 10), endAt: at(today, 11), startDate: null, endDate: null, dueAt: null, dueDate: null, timezone,
    location: '线上会议', people: [], notes: '复习二分查找与循环不变量。', warnings: [], unresolvedFields: [], savedLocal: true };
  const jobs = [
    { id: randomUUID(), status: 'draft', title: base.title, events: [base, { ...base, id: randomUUID(), title: '算法作业提交', kind: 'deadline', startAt: null, endAt: null, dueAt: at(today, 18) }], createdAt: at(today, 9) },
    { id: randomUUID(), status: 'draft', title: '学习周计划', events: [{ ...base, id: randomUUID(), title: '学习周计划', allDay: true, startAt: null, endAt: null, startDate: tomorrow.toString(), endDate: tomorrow.add({ days: 4 }).toString() }], createdAt: at(today, 8) },
    { id: randomUUID(), status: 'failed', title: '识别失败', events: [], error: '模拟识别失败', createdAt: at(today, 7) }
  ].map(job => ({ ...job, updatedAt: job.createdAt, profile: defaults, capture: { id: randomUUID(), fileName: '', width: 360, height: 180, createdAt: job.createdAt } }));
  jobs.forEach(job => { job.capture.fileName = `${job.capture.id}.jpg`; });
  const bootstrap = join(directory, 'bootstrap.cjs');
  await writeFile(bootstrap, `
    const { app, nativeImage } = require('electron'); const fs = require('node:fs'); const path = require('node:path');
    app.setAppPath(${JSON.stringify(resolve('.'))});
    const root = ${JSON.stringify(storage)}, history = ${JSON.stringify(history)}, jobs = ${JSON.stringify(jobs)};
    const bitmap = Buffer.alloc(360 * 180 * 4, 255);
    for (let y = 0; y < 180; y++) for (let x = 0; x < 360; x++) { const i = (y * 360 + x) * 4; bitmap[i] = x > 240 ? 210 : 245; bitmap[i + 1] = x > 240 ? 90 : 245; bitmap[i + 2] = x > 240 ? 40 : 245; }
    const jpeg = nativeImage.createFromBitmap(bitmap, { width: 360, height: 180 }).toJPEG(90);
    for (const [folder, list, filename] of [['history', history, 'conversations.json'], ['schedule', jobs, 'jobs.json']]) {
      fs.mkdirSync(path.join(root, folder, 'captures'), { recursive: true });
      for (const item of list) fs.writeFileSync(path.join(root, folder, 'captures', item.capture.fileName), jpeg);
      fs.writeFileSync(path.join(root, folder, filename), JSON.stringify(list));
    }
    require(${JSON.stringify(resolve('out/main/index.js'))});
  `);
  const app = await launchMemberDesktop({ args: [bootstrap, `--user-data-dir=${storage}`], env: { ...process.env, SNIPVIA_CAPTURE_BACKEND: 'electron', SNIPVIA_CAPTURE_WARMUP: '0' } });
  try {
    const page = await app.firstWindow(); const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    const historyFile = join(storage, 'history/conversations.json'), scheduleFile = join(storage, 'schedule/jobs.json');
    const originalHistory = await readFile(historyFile, 'utf8'), originalSchedule = await readFile(scheduleFile, 'utf8');
    const date = (day: string) => page.locator(`.schedule-day[data-date="${day}"]`);
    await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '截图日程', exact: true }).click();
    await expect(date(today.toString())).toHaveClass(/today.*selected/);
    await expect(page.locator('.schedule-detail-event')).toHaveCount(2);
    await expect(page.locator('.schedule-detail-capture')).toHaveCount(3);
    await expect(page.locator('.schedule-date-detail')).toContainText('已存截然');
    await date(tomorrow.toString()).click(); await expect(page.locator('.schedule-detail-event')).toContainText('学习周计划');
    await date(tomorrow.toString()).press('ArrowRight'); await expect(date(tomorrow.add({ days: 1 }).toString())).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.schedule-detail-event')).toContainText('学习周计划');
    await page.getByRole('button', { name: '下个月', exact: true }).click();
    await page.getByRole('button', { name: '今天', exact: true }).click();
    await page.locator('.schedule-detail-event').filter({ hasText: base.title }).click();
    const editor = page.getByRole('dialog', { name: `编辑日程：${base.title}` }); await expect(editor).toBeVisible();
    await expect(page.getByLabel('日程标题')).toHaveValue(base.title); await page.keyboard.press('Escape'); await expect(editor).toHaveCount(0);
    await page.locator('.schedule-detail-capture').filter({ hasText: '识别失败' }).click();
    await expect(page.getByRole('dialog', { name: '识别记录' })).toContainText('模拟识别失败');
    await expect(page.getByAltText('日程来源截图')).toBeVisible(); await page.keyboard.press('Escape');
    expect(await readFile(scheduleFile, 'utf8')).toBe(originalSchedule);

    await page.evaluate(id => window.snipvia.history.open(id), history[1].id);
    const before = await page.evaluate(() => window.snipvia.chat.state());
    await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '历史对话', exact: true }).click();
    await expect(page.locator('.history-message.assistant')).toContainText('循环不变量');
    expect(await page.evaluate(() => window.snipvia.chat.state())).toEqual(before);
    expect(await readFile(historyFile, 'utf8')).toBe(originalHistory);
    await expect(page.locator('.history-group').first().getByRole('heading')).toHaveText('今天');
    await page.getByLabel('搜索历史对话', { exact: true }).fill('二分'); await expect(page.locator('.history-item')).toHaveCount(1);
    await page.getByLabel('筛选历史厂商').selectOption('qwen'); await expect(page.getByText('没有匹配的对话', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '清除筛选', exact: true }).click(); await expect(page.locator('.history-item')).toHaveCount(18);
    await page.locator('.history-open').first().press('ArrowDown');
    await expect(page.locator('.history-preview-heading')).toContainText(history[1].title);
    await page.locator('.history-open[aria-current="true"]').press('Home');
    await expect(page.locator('.history-preview-heading')).toContainText(history[0].title);
    const list = page.locator('.history-list'); const preview = page.locator('.history-preview-scroll');
    await preview.evaluate(element => { element.scrollTop = 120; }); await expect.poll(() => preview.evaluate(element => element.scrollTop)).toBe(120);
    await page.getByRole('button', { name: history[1].title, exact: false }).first().click();
    await expect(page.locator('.history-preview-heading')).toContainText(history[1].title);
    await page.locator('.history-open').filter({ hasText: history[0].title }).click();
    await expect.poll(() => preview.evaluate(element => element.scrollTop)).toBe(120);

    const pin = app.windows().find(window => window.url().endsWith('#pin'))!;
    const denied = await pin.evaluate(id => window.snipvia.history.read(id), history[0].id); expect(denied.ok).toBe(false);
    const malformed = await page.evaluate(() => window.snipvia.history.read('invalid-id')); expect(malformed.ok).toBe(false);
    for (const theme of ['light', 'dark'] as const) {
      expect((await page.evaluate(theme => window.snipvia.appearance.set(theme), theme)).ok).toBe(true);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(page.locator('.history-item.selected')).toHaveCSS('background-color', await tokenColor(list, 'bg-selected'));
      for (const [width, height] of [[1120, 780], [840, 600], [1600, 1000]]) {
        await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows().find(window => !new URL(window.webContents.getURL()).hash)!.setSize(size[0], size[1]), [width, height]);
        await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width);
        for (const surface of ['history', 'schedule'] as const) {
          await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: surface === 'history' ? '历史对话' : '截图日程', exact: true }).click();
          if (surface === 'history') {
            await expect(page.locator('.history-message.assistant')).toBeVisible();
            await preview.evaluate(element => { element.scrollTop = 0; });
          }
          expect(await page.locator(`.${surface}-content`).evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
          await expectNeutralChrome(page);
          await page.screenshot({ animations: 'disabled', path: `${output}/${surface}-${theme}-${width}.png` });
        }
      }
    }
    await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '历史对话', exact: true }).click();
    await page.getByText('查看来源截图', { exact: true }).click();
    const image = page.getByAltText('历史对话来源截图'); await expect(image).toBeVisible();
    await expect(image).toHaveCSS('filter', 'none');
    await expect(image).toHaveAttribute('src', `data:image/jpeg;base64,${(await readFile(join(storage, 'history/captures', history[0].capture.fileName))).toString('base64')}`);
    await page.getByRole('button', { name: '继续对话', exact: true }).click();
    await expect(page.locator('.ai-workspace .workspace-message.assistant')).toContainText('循环不变量');
    const restored = await page.evaluate(() => window.snipvia.chat.state());
    expect(restored).toEqual(before);
    await expect(page.getByLabel('选择对话', { exact: true })).toHaveValue(history[0].id);
    expect(await readFile(historyFile, 'utf8')).toBe(originalHistory);
    await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '历史对话', exact: true }).click();
    await page.locator('.history-delete').first().click();
    await expect(page.getByRole('dialog', { name: '删除历史对话', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '取消', exact: true }).click(); expect(await readFile(historyFile, 'utf8')).toBe(originalHistory);

    await page.locator('.history-open').filter({ hasText: history[1].title }).click();
    const jpeg = join(storage, 'history/captures', history[0].capture.fileName); await rename(jpeg, `${jpeg}.backup`);
    await page.locator('.history-open').filter({ hasText: history[0].title }).click();
    await expect(page.getByRole('alert')).toContainText('历史截图文件不存在'); await rename(`${jpeg}.backup`, jpeg);
    await page.getByRole('button', { name: '重新读取', exact: true }).click(); await expect(page.locator('.history-message.assistant')).toBeVisible();
    await page.locator('.history-delete').first().click(); await page.getByRole('button', { name: '删除对话', exact: true }).click();
    await expect(page.locator('.history-item')).toHaveCount(17); expect(JSON.parse(await readFile(historyFile, 'utf8'))).toHaveLength(17);
    await page.getByRole('button', { name: '清空全部', exact: true }).click(); await page.keyboard.press('Escape');
    await expect(page.locator('.history-item')).toHaveCount(17);
    await page.getByRole('button', { name: '清空全部', exact: true }).click(); await page.getByRole('button', { name: '清空全部历史', exact: true }).click();
    await expect(page.getByText('还没有历史对话', { exact: true })).toBeVisible(); expect(JSON.parse(await readFile(historyFile, 'utf8'))).toEqual([]);
    expect(errors).toEqual([]);
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});
