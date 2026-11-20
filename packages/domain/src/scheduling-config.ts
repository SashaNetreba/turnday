import type { CottageType } from './cottage.js';
import type { LocalTime } from './local-time.js';

/** Planning values supplied by the caller (seed in docs/domain-model.md §3) — never hard-coded in the domain. */
export interface SchedulingConfig {
  /** R4: planning estimate per cottage type, in minutes. */
  readonly estimatedMinutes: Readonly<Record<CottageType, number>>;
  /** R5: used when a booking has no checkoutTime. */
  readonly defaultCheckoutTime: LocalTime;
  /** R5: used when the next booking has no checkinTime. */
  readonly defaultCheckinTime: LocalTime;
  /** R5c: housekeepers start work; the window of a deferred task starts here. */
  readonly workdayStart: LocalTime;
}
