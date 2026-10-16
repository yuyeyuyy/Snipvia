import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaults, type ScheduleDraft } from '../../src/shared/contracts';

const runtime = vi.hoisted(() => ({ directory: '' }));
vi.mock('electron', () => ({ app: { getPath: () => runtime.directory } }));
const draft: ScheduleDraft = { kind: 'event', title: '设计评审', allDay: false, startAt: '2026-09-18T14:00:00+08:00', endAt: '2026-09-18T15:00:00+08:00',
  startDate: null, endDate: null, dueAt: null, dueDate: null, timezone: 'Asia/Shanghai', location: '线上', people: ['Alice'], notes: '带方案', unresolvedFields: [], warnings: [] };

beforeEach(() => { vi.resetModules(); runtime.directory = mkdtempSync(join(tmpdir(), 'snipvia-schedule-')); });
afterEach(() => rmSync(runtime.directory, { recursive: true, force: true }));

describe('local schedule drafts', () => {
  it('persists one capture with multiple editable event drafts', async () => {
    let storage = await import('../../src/main/storage/schedule'); storage.loadSchedule();
    const captureId = crypto.randomUUID();
    const id = storage.createScheduleJob({ id: captureId, width: 80, height: 60, createdAt: '2026-09-16T08:00:00.000Z' }, Buffer.from('calendar jpeg'), defaults);
    expect(storage.listScheduleJobs()[0]).toMatchObject({ id, status: 'extracting', eventCount: 0 });
    storage.completeScheduleJob(id, [draft, { ...draft, title: '第二场会议' }]);
    let job = storage.readScheduleJob(id);
    expect(job.events).toHaveLength(2);
    expect(job.capture.dataUrl).toContain(Buffer.from('calendar jpeg').toString('base64'));
    job = storage.saveScheduleEvent(id, job.events[0].id, { ...draft, location: '4B 会议室' });
    expect(job.events[0]).toMatchObject({ location: '4B 会议室', savedLocal: true });
    job = storage.markMacSaved(id, job.events[0].id, job.events[0], { id: 'calendar-1', name: '工作' });
    job = storage.markMacReminderSaved(id, job.events[0].id, job.events[0], { id: 'list-1', name: '提醒' });
    expect(job.events[0]).toMatchObject({
      macCalendar: { id: 'calendar-1', name: '工作' },
      macReminder: { id: 'list-1', name: '提醒' }
    });

    vi.resetModules(); storage = await import('../../src/main/storage/schedule'); storage.loadSchedule();
    expect(storage.readScheduleJob(id).events[0]).toMatchObject({
      location: '4B 会议室',
      macCalendar: { id: 'calendar-1', name: '工作' },
      macReminder: { id: 'list-1', name: '提醒' }
    });
    expect(JSON.parse(readFileSync(join(runtime.directory, 'schedule', 'jobs.json'), 'utf8'))[0].capture).not.toHaveProperty('dataUrl');
    expect(existsSync(join(runtime.directory, 'schedule', 'captures', `${captureId}.jpg`))).toBe(true);
    storage.deleteScheduleJob(id);
    expect(existsSync(join(runtime.directory, 'schedule', 'captures', `${captureId}.jpg`))).toBe(false);
  });

  it('keeps failed extraction visible instead of reporting success', async () => {
    const storage = await import('../../src/main/storage/schedule'); storage.loadSchedule();
    const id = storage.createScheduleJob({ id: crypto.randomUUID(), width: 20, height: 20, createdAt: new Date().toISOString() }, Buffer.from('bad'), defaults);
    storage.failScheduleJob(id, '模型未返回有效 JSON');
    expect(storage.listScheduleJobs()[0]).toMatchObject({ status: 'failed', error: '模型未返回有效 JSON' });
  });
  it('stores a date-only completion deadline without a fabricated start time', async () => {
    const storage = await import('../../src/main/storage/schedule'); storage.loadSchedule();
    const id = storage.createScheduleJob({ id: crypto.randomUUID(), width: 20, height: 20, createdAt: new Date().toISOString() }, Buffer.from('deadline'), defaults);
    storage.completeScheduleJob(id, [{ ...draft, kind: 'deadline', title: '完成项目方案', allDay: true,
      startAt: null, endAt: null, dueDate: '2026-09-30', notes: '9 月 30 日前完成' }]);
    expect(storage.readScheduleJob(id).events[0]).toMatchObject({ kind: 'deadline', dueDate: '2026-09-30', startAt: null, endAt: null });
  });
});
