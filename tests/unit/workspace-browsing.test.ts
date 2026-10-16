import { describe, expect, it } from 'vitest';
import { entriesForDate, capturesForDate, captureDay, moveMonth, eventTimeLabel, eventSpanLabel } from '../../src/renderer/src/schedule/display';
import { filterConversations, groupConversations } from '../../src/renderer/src/history/display';
import { defaults, type ConversationSummary, type ScheduleEvent, type ScheduleJobSummary } from '../../src/shared/contracts';

const event: ScheduleEvent = { id: 'event', kind: 'event', title: '跨日学习', allDay: false, startAt: '2026-10-08T23:00:00+08:00', endAt: '2026-10-10T00:00:00+08:00', startDate: null, endDate: null,
  dueAt: null, dueDate: null, timezone: 'Asia/Shanghai', location: '', people: [], notes: '', unresolvedFields: [], warnings: [], savedLocal: true };
const item: ConversationSummary = { id: 'first', title: '二分查找边界', createdAt: '2026-10-08T01:00:00Z', updatedAt: '2026-10-08T17:00:00Z', messageCount: 2, profile: defaults };

describe('date agenda presentation', () => {
  it('includes cross-day events but excludes midnight end dates using the existing date rules', () => {
    const entries = [{ jobId: 'job', event }];
    expect(entriesForDate(entries, '2026-10-08')).toHaveLength(1);
    expect(entriesForDate(entries, '2026-10-09')).toHaveLength(1);
    expect(entriesForDate(entries, '2026-10-10')).toHaveLength(0);
    expect(eventTimeLabel(entries[0])).toBe('23:00');
    expect(eventSpanLabel(entries[0])).toBe('2026-10-08 23:00 → 2026-10-10 00:00');
  });
  it('keeps incomplete events undated and shows all-day and deadline records accurately', () => {
    const invalid = { ...event, startAt: null }; const allDay = { ...event, id: 'all', allDay: true, startDate: '2026-10-09', endDate: '2026-10-09' };
    const deadline = { ...event, id: 'due', kind: 'deadline' as const, allDay: true, dueDate: '2026-10-09' };
    expect(entriesForDate([invalid, allDay, deadline].map(event => ({ jobId: 'job', event })), '2026-10-09')).toHaveLength(2);
    expect(eventTimeLabel({ jobId: 'job', event: deadline })).toBe('截止');
    expect(eventTimeLabel({ jobId: 'job', event: allDay })).toBe('全天');
  });
  it('groups source screenshots by real local creation day, including failed records', () => {
    const jobs = [{ id: 'first', createdAt: '2026-10-08T17:00:00Z', status: 'failed' }, { id: 'second', createdAt: '2026-10-09T17:00:00Z', status: 'draft' }] as ScheduleJobSummary[];
    expect(capturesForDate(jobs, '2026-10-09', 'Asia/Shanghai').map(job => job.id)).toEqual(['first']);
    expect(captureDay('invalid', 'Asia/Shanghai')).toBeNull();
  });
  it('clamps selected day when moving between month lengths and leap years', () => {
    expect(moveMonth('2026-01-31', 1)).toBe('2026-02-28');
    expect(moveMonth('2028-01-31', 1)).toBe('2028-02-29');
    expect(moveMonth('2026-12-31', 1)).toBe('2027-01-31');
  });
});

describe('local history browsing', () => {
  it('filters titles, models and providers with all query terms without mutating the source', () => {
    const other = { ...item, id: 'other', title: '链表反转', profile: { ...defaults, provider: 'qwen' as const, model: 'qwen-test' } };
    const items = [item, other];
    expect(filterConversations(items, '二分 OpenAI', 'all')).toEqual([item]);
    expect(filterConversations(items, 'QWEN', 'qwen')).toEqual([other]);
    expect(filterConversations(items, '二分', 'qwen')).toEqual([]);
    expect(items).toEqual([item, other]);
  });
  it('groups today and yesterday in the local time zone instead of slicing a UTC string', () => {
    const yesterday = { ...item, id: 'yesterday', updatedAt: '2026-10-07T17:00:00Z' };
    const groups = groupConversations([item, yesterday], '2026-10-09', 'Asia/Shanghai');
    expect(groups.map(group => [group.date, group.label])).toEqual([['2026-10-09', '今天'], ['2026-10-08', '昨天']]);
  });
  it('sorts instants accurately across offsets and preserves invalid dates as an unknown group', () => {
    const later = { ...item, id: 'later', updatedAt: '2026-10-08T20:00:00-07:00' };
    const invalid = { ...item, id: 'unknown', updatedAt: 'invalid' };
    const sorted = filterConversations([invalid, item, later], '', 'all');
    expect(sorted.map(item => item.id)).toEqual(['later', 'first', 'unknown']);
    expect(groupConversations(sorted, '2026-10-09', 'Asia/Shanghai').at(-1)?.label).toBe('日期未知');
  });
});
