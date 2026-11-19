import type { LocalDate } from './local-date.js';
import type { LocalTime } from './local-time.js';

/** Local wall-clock date and time without zone, as `YYYY-MM-DDTHH:MM` (ADR 0003). Sorts chronologically. */
export type LocalDateTime = string & { readonly __brand: 'LocalDateTime' };

export function atTime(date: LocalDate, time: LocalTime): LocalDateTime {
  return `${date}T${time}` as LocalDateTime;
}

/** Wall-clock minutes from `from` to `to`. Pure calendar arithmetic: no clock read, no DST (ADR 0003). */
export function minutesBetween(from: LocalDateTime, to: LocalDateTime): number {
  return toEpochMinutes(to) - toEpochMinutes(from);
}

function toEpochMinutes(value: LocalDateTime): number {
  const [y, mo, d, h, mi] = value.split(/[-T:]/).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  return Date.UTC(y, mo - 1, d, h, mi) / 60_000;
}
