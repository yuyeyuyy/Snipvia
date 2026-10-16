import { Temporal } from '@js-temporal/polyfill';
import type { ScheduleEvent } from './contracts';

export type CalendarEntry = { jobId: string; event: ScheduleEvent };
export type WeekSegment = { entry: CalendarEntry; start: number; end: number; lane: number; continuesBefore: boolean; continuesAfter: boolean };

export function eventDateRange(event: ScheduleEvent): { start: string; end: string } | null {
  if (event.kind === 'deadline') {
    const day = event.allDay ? event.dueDate : event.dueAt && Temporal.Instant.from(event.dueAt).toZonedDateTimeISO(event.timezone).toPlainDate().toString();
    return day ? { start: day, end: day } : null;
  }
  if (event.allDay) return event.startDate && event.endDate ? { start: event.startDate, end: event.endDate } : null;
  if (!event.startAt || !event.endAt) return null;
  return {
    start: Temporal.Instant.from(event.startAt).toZonedDateTimeISO(event.timezone).toPlainDate().toString(),
    end: Temporal.Instant.from(event.endAt).subtract({ nanoseconds: 1 }).toZonedDateTimeISO(event.timezone).toPlainDate().toString()
  };
}

export function monthWeeks(month: string): string[][] {
  const first = Temporal.PlainDate.from(`${month}-01`);
  const firstCell = first.subtract({ days: first.dayOfWeek - 1 });
  const count = Math.ceil((first.dayOfWeek - 1 + first.daysInMonth) / 7);
  return Array.from({ length: count }, (_, week) => Array.from({ length: 7 }, (_, day) => firstCell.add({ days: week * 7 + day }).toString()));
}

export function weekSegments(entries: CalendarEntry[], dates: string[]): WeekSegment[] {
  const first = dates[0], last = dates[6];
  const spans = entries.flatMap((entry) => {
    const range = eventDateRange(entry.event);
    if (!range || range.end < first || range.start > last) return [];
    const start = Math.max(0, Temporal.PlainDate.from(first).until(range.start).days);
    const end = Math.min(6, Temporal.PlainDate.from(first).until(range.end).days);
    return [{ entry, start, end, continuesBefore: range.start < first, continuesAfter: range.end > last }];
  }).sort((a, b) => a.start - b.start || b.end - a.end || a.entry.event.title.localeCompare(b.entry.event.title));
  const laneEnds: number[] = [];
  return spans.map((span) => {
    let lane = laneEnds.findIndex((end) => end < span.start);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = span.end;
    return { ...span, lane };
  });
}
