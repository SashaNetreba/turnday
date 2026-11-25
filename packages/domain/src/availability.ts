import type { LocalDate } from './local-date.js';

/** R10: required for every active housekeeper on every day of the planning week, reserves included. */
export interface Availability {
  readonly housekeeperId: string;
  readonly date: LocalDate;
  /** Days off, holidays, sickness. */
  readonly available: boolean;
}
