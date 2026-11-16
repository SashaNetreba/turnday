// Public entry point of the domain package. Business rules live in docs/domain-model.md.
export type { Booking, BookingStatus } from './booking.js';
export type { CleaningTask } from './cleaning-task.js';
export type { Cottage, CottageType } from './cottage.js';
export { deriveCleaningTasks } from './derive-cleaning-tasks.js';
export { addDays, localDate, type LocalDate } from './local-date.js';
export {
  DAYS_IN_PLANNING_WEEK,
  contains,
  daysOf,
  lastDayOf,
  type PlanningWeek,
} from './planning-week.js';
