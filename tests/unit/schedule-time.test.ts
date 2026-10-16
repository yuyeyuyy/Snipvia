import { describe, expect, it } from 'vitest';
import { instantToLocalInput, localInputToInstant } from '../../src/shared/schedule-time';

describe('schedule timezone conversion', () => {
  it('round trips a wall-clock time through its IANA timezone', () => {
    const instant = localInputToInstant('2026-09-18T14:30', 'Asia/Shanghai');
    expect(instant).toBe('2026-09-18T06:30:00Z');
    expect(instantToLocalInput(instant, 'Asia/Shanghai')).toBe('2026-09-18T14:30');
  });

  it.each(['2026-03-08T02:30', '2026-11-01T01:30'])('rejects nonexistent or ambiguous New York time %s', (value) => {
    expect(() => localInputToInstant(value, 'America/New_York')).toThrow();
  });
});
