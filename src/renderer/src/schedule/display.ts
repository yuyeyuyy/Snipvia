import { Temporal } from '@js-temporal/polyfill';
import type { ScheduleJobSummary } from '../../../shared/contracts';
import { eventDateRange, type CalendarEntry } from '../../../shared/schedule-calendar';

export function captureDay(instant: string, timezone = Temporal.Now.timeZoneId()): string | null {
  try { return Temporal.Instant.from(instant).toZonedDateTimeISO(timezone).toPlainDate().toString(); }
  catch { return null; }
}

export function entriesForDate(entries: CalendarEntry[], date: string): CalendarEntry[] {
  return entries.filter(({ event }) => {
    const range = eventDateRange(event);
    return range && range.start <= date && range.end >= date;
  }).sort((left, right) => Number(right.event.allDay) - Number(left.event.allDay)
    || eventTime(left).localeCompare(eventTime(right)) || left.event.title.localeCompare(right.event.title));
}

function eventTime({ event }: CalendarEntry) {
  const instant = event.kind === 'deadline' ? event.dueAt : event.startAt;
  return instant ? Temporal.Instant.from(instant).toZonedDateTimeISO(event.timezone).toPlainTime().toString() : '';
}

export function capturesForDate(items: ScheduleJobSummary[], date: string, timezone = Temporal.Now.timeZoneId()) {
  return items.filter(item => captureDay(item.createdAt, timezone) === date);
}

export function moveMonth(date: string, months: number) {
  return Temporal.PlainDate.from(date).add({ months }, { overflow: 'constrain' }).toString();
}

export function eventTimeLabel({ event }: CalendarEntry) {
  if (event.allDay) return event.kind === 'deadline' ? '截止' : '全天';
  const instant = event.kind === 'deadline' ? event.dueAt : event.startAt;
  if (!instant) return '未定时间';
  return Temporal.Instant.from(instant).toZonedDateTimeISO(event.timezone).toPlainTime().toString().slice(0, 5);
}

/** Explicit dates prevent a previous-day start from looking like an appointment tonight. */
export function eventSpanLabel({ event }: CalendarEntry) {
  if (event.kind !== 'event') return '';
  if (event.allDay) return event.startDate && event.endDate && event.startDate !== event.endDate ? `${event.startDate} → ${event.endDate}` : '';
  if (!event.startAt || !event.endAt) return '';
  const start = Temporal.Instant.from(event.startAt).toZonedDateTimeISO(event.timezone);
  const end = Temporal.Instant.from(event.endAt).toZonedDateTimeISO(event.timezone);
  if (start.toPlainDate().equals(end.toPlainDate())) return '';
  const label = (value: typeof start) => `${value.toPlainDate()} ${value.toPlainTime().toString().slice(0, 5)}`;
  return `${label(start)} → ${label(end)}`;
}
