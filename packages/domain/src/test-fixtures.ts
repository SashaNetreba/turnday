// Test-only helpers. Excluded from the build (tsconfig.json) and from coverage (vitest.config.ts).
import type { Booking, BookingStatus, Cottage } from './index.js';
import { localDate } from './index.js';

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
