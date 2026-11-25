// Public entry point of the domain package. Business rules live in docs/domain-model.md.
export type { Availability } from './availability.js';
export type { Booking, BookingStatus } from './booking.js';
export type { CleaningTask } from './cleaning-task.js';
export type { Cottage, CottageType } from './cottage.js';
export { deriveCleaningTasks } from './derive-cleaning-tasks.js';
export { deriveHeadcount, type DeriveHeadcountInput } from './derive-headcount.js';
export type { Housekeeper } from './housekeeper.js';
export { addDays, localDate, type LocalDate } from './local-date.js';
export { atTime, minutesBetween, type LocalDateTime } from './local-date-time.js';
export { localTime, type LocalTime } from './local-time.js';
export {
  planWeek,
  type DayLoad,
  type Headcount,
  type PlanWeekInput,
  type Shortfall,
  type ShortfallReason,
  type WeekPlan,
} from './plan-week.js';
export {
  DAYS_IN_PLANNING_WEEK,
  contains,
  daysOf,
  lastDayOf,
  type PlanningWeek,
} from './planning-week.js';
export type { SchedulingConfig } from './scheduling-config.js';
export type { TimeOverride, TimeOverrideKind } from './time-override.js';
