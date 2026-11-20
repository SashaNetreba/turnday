/** A calendar date without time or zone, as ISO `YYYY-MM-DD`. ISO strings sort chronologically. */
export type LocalDate = string & { readonly __brand: 'LocalDate' };

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function localDate(value: string): LocalDate {
  const match = ISO_DATE.exec(value);
  if (!match) throw new Error(`Invalid LocalDate "${value}": expected YYYY-MM-DD`);
  const [, y, m, d] = match.map(Number) as [number, number, number, number];
  const utc = new Date(Date.UTC(y, m - 1, d));
  if (utc.getUTCFullYear() !== y || utc.getUTCMonth() !== m - 1 || utc.getUTCDate() !== d) {
    throw new Error(`Invalid LocalDate "${value}": no such calendar day`);
  }
  return value as LocalDate;
}

/** Pure calendar arithmetic (UTC-based, so no DST effects). Does not read the system clock. */
export function addDays(date: LocalDate, days: number): LocalDate {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10) as LocalDate;
}

/** Day of week, 0 = Sunday … 6 = Saturday. Pure calendar arithmetic, no clock. */
function weekdayOf(date: LocalDate): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** R5f: Saturday or Sunday, by calendar weekday. */
export function isWeekend(date: LocalDate): boolean {
  const day = weekdayOf(date);
  return day === 0 || day === 6;
}

/** R5f: the first Monday after `date`. */
export function followingMonday(date: LocalDate): LocalDate {
  return addDays(date, (8 - weekdayOf(date)) % 7 || 7);
}
