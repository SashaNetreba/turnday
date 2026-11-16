import type { LocalDate } from './local-date.js';

export type BookingStatus = 'CONFIRMED' | 'CHECKED_OUT' | 'CANCELLED';

/** A stay in one cottage, imported from the PMS. Check-in/out times arrive with R5. */
export interface Booking {
  readonly externalRef: string;
  readonly cottageNumber: number;
  readonly arrivalDate: LocalDate;
  readonly departureDate: LocalDate;
  readonly status: BookingStatus;
}
