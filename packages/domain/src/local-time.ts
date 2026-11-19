/** A wall-clock time of day without date or zone, as `HH:MM` (00:00–23:59). Sorts chronologically. */
export type LocalTime = string & { readonly __brand: 'LocalTime' };

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function localTime(value: string): LocalTime {
  if (!HH_MM.test(value))
    throw new Error(`Invalid LocalTime "${value}": expected HH:MM, 00:00–23:59`);
  return value as LocalTime;
}
