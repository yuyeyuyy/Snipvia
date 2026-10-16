import { describe, expect, it } from 'vitest';
import { eventDateRange, monthWeeks, weekSegments } from '../../src/shared/schedule-calendar';
import type { ScheduleEvent } from '../../src/shared/contracts';

const event: ScheduleEvent = { id: 'event', kind: 'event', title: '连续出差', allDay: true, startAt: null, endAt: null,
  startDate: '2026-09-04', endDate: '2026-09-09', dueAt: null, dueDate: null, timezone: 'Asia/Shanghai', location: '', people: [], notes: '', unresolvedFields: [], warnings: [], savedLocal: false };

describe('schedule month layout', () => {
  it('connects a multi-day event across calendar weeks', () => {
    const weeks = monthWeeks('2026-09');
    expect(weeks).toHaveLength(5);
    const first = weekSegments([{ jobId: 'job', event }], weeks[0])[0];
    const second = weekSegments([{ jobId: 'job', event }], weeks[1])[0];
    expect(first).toMatchObject({ start: 4, end: 6, continuesBefore: false, continuesAfter: true });
    expect(second).toMatchObject({ start: 0, end: 2, continuesBefore: true, continuesAfter: false });
  });
  it('treats a midnight end as exclusive', () => {
    expect(eventDateRange({ ...event, allDay: false, startDate: null, endDate: null,
      startAt: '2026-09-17T23:00:00+08:00', endAt: '2026-09-18T00:00:00+08:00' })).toEqual({ start: '2026-09-17', end: '2026-09-17' });
  });
});
