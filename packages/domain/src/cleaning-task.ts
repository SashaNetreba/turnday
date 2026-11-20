import type { LocalDate } from './local-date.js';
import type { LocalDateTime } from './local-date-time.js';

/** Derived from bookings, never entered manually. */
export interface CleaningTask {
  readonly bookingRef: string;
  readonly cottageNumber: number;
  readonly kind: 'DEPARTURE';
  readonly departureDate: LocalDate;
  readonly plannedDate: LocalDate;
  readonly deferred: boolean;
  /** R4: from SchedulingConfig by cottage type. */
  readonly estimatedMinutes: number;
  /** R6: always 1 for now; R7a / R8 raise it later. */
  readonly requiredCrewSize: 1 | 2;
  /** R5: departure date + checkout time. */
  readonly earliestStart: LocalDateTime;
  /** R5: next arrival into this cottage + check-in time; absent when no next arrival is known. */
  readonly deadline?: LocalDateTime;
  /** R5: a deadline exists and deadline − earliestStart − estimatedMinutes ≤ 0. */
  readonly tight: boolean;
  /** R5b: a deadline exists and deadline − earliestStart < estimatedMinutes — one person cannot finish in time. */
  readonly atRisk: boolean;
}
