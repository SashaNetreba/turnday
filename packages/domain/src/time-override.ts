import type { LocalTime } from './local-time.js';

export type TimeOverrideKind = 'LATE_CHECKOUT' | 'EARLY_CHECKIN';

/**
 * R5a: a manager's late checkout / early check-in for one booking — highest precedence over the
 * booking time and the config default. A pure input: `setBy` / `setAt` and surviving re-imports
 * are the adapter's job.
 */
export interface TimeOverride {
  /** Booking.externalRef */
  readonly bookingRef: string;
  /** LATE_CHECKOUT acts on the booking's departure, EARLY_CHECKIN on its arrival. */
  readonly kind: TimeOverrideKind;
  readonly time: LocalTime;
}
