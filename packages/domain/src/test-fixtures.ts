// Test-only helpers. Excluded from the build (tsconfig.json) and from coverage (vitest.config.ts).
import fc from 'fast-check';

import type {
  Booking,
  BookingStatus,
  Cottage,
  Headcount,
  LocalTime,
  PlanningWeek,
  SchedulingConfig,
} from './index.js';
import { addDays, daysOf, localDate, localTime } from './index.js';

/** Seed reference data (docs/domain-model.md §3): 1–10 STABLE, 11/12/15 PREMIUM, 14 not schedulable, 13 missing. */
export function seedCottages(): Cottage[] {
  const stable = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((number): Cottage => ({
    number,
    type: 'STABLE',
    schedulable: true,
  }));
  const premium = [11, 12, 15].map((number): Cottage => ({
    number,
    type: 'PREMIUM',
    schedulable: true,
  }));
  const staff: Cottage = {
    number: 14,
    type: 'STABLE',
    schedulable: false,
    note: 'staff accommodation',
  };
  return [...stable, ...premium, staff];
}

export function booking(
  externalRef: string,
  cottageNumber: number,
  arrival: string,
  departure: string,
  status: BookingStatus = 'CONFIRMED',
): Booking {
  return {
    externalRef,
    cottageNumber,
    arrivalDate: localDate(arrival),
    departureDate: localDate(departure),
    status,
  };
}

/** Headcount for every day of `week`: `available` by default, `perDay` overrides by ISO date. */
export function headcountFor(
  week: PlanningWeek,
  available: number,
  perDay: Readonly<Record<string, number>> = {},
): Headcount[] {
  return daysOf(week).map((date) => ({ date, available: perDay[date] ?? available }));
}

// ---- Booking scenarios for planning tests ----

/** Out on `out`; the next guest arrives on `arrival` (default check-in 16:00 unless `checkin` is given). */
export const stay = (
  cottage: number,
  out: string,
  arrival: string,
  checkin?: string,
): Booking[] => [
  booking(`OUT/${String(cottage)}`, cottage, '2026-11-10', out),
  {
    ...booking(`IN/${String(cottage)}`, cottage, arrival, '2026-11-30'),
    ...(checkin === undefined ? {} : { checkinTime: localTime(checkin) }),
  },
];
/** Out on `out` with the next guest arriving the same day: cannot wait. */
export const turnover = (cottage: number, out: string): Booking[] => stay(cottage, out, out);
/** Out on `out`, no next arrival known: no deadline. */
export const lastStay = (cottage: number, out: string): Booking[] => [
  booking(`OUT/${String(cottage)}`, cottage, '2026-11-10', out),
];

/** Seed SchedulingConfig (docs/domain-model.md §3): the manager's planning values. */
export function seedConfig(): SchedulingConfig {
  return {
    estimatedMinutes: { STABLE: 270, PREMIUM: 300 },
    defaultCheckoutTime: localTime('10:00'),
    defaultCheckinTime: localTime('16:00'),
    workdayStart: localTime('10:00'),
  };
}

// ---- Property-test generators (fast-check) ----

/** Generated dates are offsets from Mon 16 Nov 2026. */
const propertyBase = localDate('2026-11-16');

export const timeArb: fc.Arbitrary<LocalTime> = fc
  .tuple(fc.integer({ min: 0, max: 23 }), fc.integer({ min: 0, max: 59 }))
  .map(([h, m]) => localTime(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`));

const statusArb = fc.constantFrom<BookingStatus>('CONFIRMED', 'CHECKED_OUT', 'CANCELLED');

/**
 * Random bookings around the base week, incl. invalid (departure <= arrival), cancelled,
 * unknown (13, 0, 16) and non-schedulable (14) cottages. `withTimes = false` → default times only.
 */
export const bookingArb = (withTimes = true): fc.Arbitrary<Booking> =>
  fc
    .record({
      ref: fc.stringMatching(/^[A-Z]{2}\d{1,3}\/\d$/),
      cottageNumber: fc.integer({ min: 0, max: 16 }),
      arrivalOffset: fc.integer({ min: -10, max: 14 }),
      nights: fc.integer({ min: -2, max: 10 }),
      status: statusArb,
      checkoutTime: withTimes ? fc.option(timeArb, { nil: undefined }) : fc.constant(undefined),
      checkinTime: withTimes ? fc.option(timeArb, { nil: undefined }) : fc.constant(undefined),
    })
    .map(
      ({
        ref,
        cottageNumber,
        arrivalOffset,
        nights,
        status,
        checkoutTime,
        checkinTime,
      }): Booking => ({
        externalRef: ref,
        cottageNumber,
        arrivalDate: addDays(propertyBase, arrivalOffset),
        departureDate: addDays(propertyBase, arrivalOffset + nights),
        status,
        ...(checkoutTime ? { checkoutTime } : {}),
        ...(checkinTime ? { checkinTime } : {}),
      }),
    );

/** Planning weeks starting up to 3 days before/after the base date. */
export const weekArb: fc.Arbitrary<PlanningWeek> = fc
  .integer({ min: -3, max: 3 })
  .map((offset) => ({ start: addDays(propertyBase, offset) }));

/** Headcount 0–`max` for every day of `week`. */
export const headcountArb = (week: PlanningWeek, max = 4): fc.Arbitrary<Headcount[]> =>
  fc
    .array(fc.integer({ min: 0, max }), { minLength: 7, maxLength: 7 })
    .map((counts) => daysOf(week).map((date, i) => ({ date, available: counts[i] ?? 0 })));
