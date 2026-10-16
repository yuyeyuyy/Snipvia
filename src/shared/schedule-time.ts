import { Temporal } from '@js-temporal/polyfill';

export function instantToLocalInput(value: string | null, timezone: string) {
  if (!value) return '';
  try { return Temporal.Instant.from(value).toZonedDateTimeISO(timezone).toPlainDateTime().toString({ smallestUnit: 'minute' }); }
  catch { return value.slice(0, 16); }
}

export function localInputToInstant(value: string, timezone: string) {
  if (!value) return null;
  return Temporal.PlainDateTime.from(value)
    .toZonedDateTime(timezone, { disambiguation: 'reject' })
    .toInstant()
    .toString();
}
