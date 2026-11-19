import type { Booking } from './booking.js';
import type { CleaningTask } from './cleaning-task.js';
import type { Cottage, CottageType } from './cottage.js';
import { atTime, minutesBetween, type LocalDateTime } from './local-date-time.js';
import type { LocalDate } from './local-date.js';
import type { LocalTime } from './local-time.js';
import { contains, type PlanningWeek } from './planning-week.js';
import type { SchedulingConfig } from './scheduling-config.js';

/**
 * Cleaning demand for one planning week, with effort and time window — R1–R5, invariants 11–13.
 * Only departures produce tasks, so stayovers and empty cottages never do (R2).
 * `bookings` must also cover the days after the week up to each cottage's next arrival (R5 input coverage);
 * otherwise a task has no deadline.
 */
export function deriveCleaningTasks(
  bookings: readonly Booking[],
  cottages: readonly Cottage[],
  week: PlanningWeek,
  config: SchedulingConfig,
): CleaningTask[] {
  const schedulableTypes = new Map<number, CottageType>(
    cottages.filter((c) => c.schedulable).map((c) => [c.number, c.type]),
  );

  // R1: cancelled and invalid bookings neither depart nor arrive.
  const valid = bookings.filter((b) => b.status !== 'CANCELLED' && b.departureDate > b.arrivalDate);

  // Invariant 11: one task per cottage per day.
  const byCottageAndDay = new Map<string, { type: CottageType; group: Booking[] }>();
  for (const b of valid) {
    const type = schedulableTypes.get(b.cottageNumber); // R3: unknown (13) or non-schedulable (14)
    if (type === undefined || !contains(week, b.departureDate)) continue; // R1
    const key = `${String(b.cottageNumber)}@${b.departureDate}`;
    byCottageAndDay.set(key, { type, group: [...(byCottageAndDay.get(key)?.group ?? []), b] });
  }

  return [...byCottageAndDay.values()]
    .map(({ type, group }): CleaningTask => {
      // Lowest externalRef represents the task, independent of input order.
      const first = group.reduce((a, b) => (b.externalRef < a.externalRef ? b : a));
      const estimatedMinutes = config.estimatedMinutes[type]; // R4

      // R5: the latest checkout among collapsed bookings counts.
      const checkout = latest(group.map((b) => b.checkoutTime ?? config.defaultCheckoutTime));
      const earliestStart = atTime(first.departureDate, checkout);
      const deadline = nextArrivalDeadline(valid, first.cottageNumber, first.departureDate, config);

      return {
        bookingRef: first.externalRef,
        cottageNumber: first.cottageNumber,
        kind: 'DEPARTURE',
        departureDate: first.departureDate,
        plannedDate: first.departureDate,
        deferred: false,
        estimatedMinutes,
        earliestStart,
        ...(deadline === undefined ? {} : { deadline }),
        tight:
          deadline !== undefined && minutesBetween(earliestStart, deadline) - estimatedMinutes <= 0,
      };
    })
    .sort((a, b) =>
      a.plannedDate === b.plannedDate
        ? a.cottageNumber - b.cottageNumber
        : a.plannedDate < b.plannedDate
          ? -1
          : 1,
    );
}

/**
 * R5: the next arrival is the earliest valid booking into the same cottage arriving on or after the
 * departure date; if several arrive that day, the earliest check-in counts. None known → no deadline.
 */
function nextArrivalDeadline(
  valid: readonly Booking[],
  cottageNumber: number,
  departureDate: LocalDate,
  config: SchedulingConfig,
): LocalDateTime | undefined {
  const arrivals = valid.filter(
    (b) => b.cottageNumber === cottageNumber && b.arrivalDate >= departureDate,
  );
  if (arrivals.length === 0) return undefined;

  const nextDate = arrivals.map((b) => b.arrivalDate).reduce((a, b) => (b < a ? b : a));
  const checkins = arrivals
    .filter((b) => b.arrivalDate === nextDate)
    .map((b) => b.checkinTime ?? config.defaultCheckinTime);
  return atTime(nextDate, earliest(checkins));
}

const latest = (times: readonly LocalTime[]): LocalTime => times.reduce((a, b) => (b > a ? b : a));
const earliest = (times: readonly LocalTime[]): LocalTime =>
  times.reduce((a, b) => (b < a ? b : a));
