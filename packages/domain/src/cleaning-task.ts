import type { CottageType } from './cottage.js';
import type { LocalDate } from './local-date.js';
import type { LocalDateTime } from './local-date-time.js';

/** Derived from bookings, never entered manually. */
export interface CleaningTask {
  readonly bookingRef: string;
  readonly cottageNumber: number;
  /** R4: the cottage's type; R7a chooses by it. */
  readonly cottageType: CottageType;
  readonly kind: 'DEPARTURE';
  readonly departureDate: LocalDate;
  readonly plannedDate: LocalDate;
  readonly deferred: boolean;
  /** R4: from SchedulingConfig by cottage type. */
  readonly estimatedMinutes: number;
  /** R6: always 1; only R8 (manual crew of 2) raises it. */
  readonly requiredCrewSize: 1 | 2;
  /** R5: departure date + checkout time. */
  readonly earliestStart: LocalDateTime;
  /** R5: next arrival into this cottage + check-in time; absent when no next arrival is known. */
  readonly deadline?: LocalDateTime;
  /**
   * R5: a deadline exists and deadline − windowStart − estimatedMinutes ≤ 0.
   * windowStart = earliestStart, or plannedDate + workdayStart if deferred (R5c).
   */
  readonly tight: boolean;
  /** R5b: a deadline exists and deadline − windowStart < estimatedMinutes — one person cannot finish in time. */
  readonly atRisk: boolean;
}
