import type { LocalDate } from './local-date.js';
import type { LocalTime } from './local-time.js';

export type BookingStatus = 'CONFIRMED' | 'CHECKED_OUT' | 'CANCELLED';

/** A stay in one cottage, imported from the PMS. */
export interface Booking {
  readonly externalRef: string;
  readonly cottageNumber: number;
  readonly arrivalDate: LocalDate;
  readonly departureDate: LocalDate;
  /** R5: overrides SchedulingConfig.defaultCheckoutTime. A manager override (R5a) will take precedence. */
  readonly checkoutTime?: LocalTime;
  /** R5: overrides SchedulingConfig.defaultCheckinTime. A manager override (R5a) will take precedence. */
  readonly checkinTime?: LocalTime;
  readonly status: BookingStatus;
}
