import type { LocalDate } from './local-date.js';

/**
 * Derived from bookings, never entered manually.
 * Effort, crew size and time window are added with R4–R6.
 */
export interface CleaningTask {
  readonly bookingRef: string;
  readonly cottageNumber: number;
  readonly kind: 'DEPARTURE';
  readonly departureDate: LocalDate;
  readonly plannedDate: LocalDate;
  readonly deferred: boolean;
}
