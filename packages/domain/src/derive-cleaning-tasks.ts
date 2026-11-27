import type { Booking } from './booking.js';
import type { CleaningTask } from './cleaning-task.js';
import type { Cottage, CottageType } from './cottage.js';
import { atTime, minutesBetween, type LocalDateTime } from './local-date-time.js';
import type { LocalDate } from './local-date.js';
import type { LocalTime } from './local-time.js';
import { contains, type PlanningWeek } from './planning-week.js';
import type { SchedulingConfig } from './scheduling-config.js';
import type { TimeOverride } from './time-override.js';

/** Effective check-out / check-in time of one booking: manager override → booking time → default (R5, R5a). */
interface EffectiveTimes {
  readonly checkoutOf: (b: Booking) => LocalTime;
  readonly checkinOf: (b: Booking) => LocalTime;
}

/**
 * Cleaning demand for one planning week, with effort, time window and crew size — R1–R5b, R6, invariants 11–14.
 * Only departures produce tasks, so stayovers and empty cottages never do (R2).
 * `bookings` must also cover the days after the week up to each cottage's next arrival (R5 input coverage);
 * otherwise a task has no deadline.
 * `overrides` (R5a) only ever act through a valid booking; any other override is ignored.
 */
export function deriveCleaningTasks(
  bookings: readonly Booking[],
  cottages: readonly Cottage[],
  week: PlanningWeek,
  config: SchedulingConfig,
  overrides: readonly TimeOverride[] = [],
): CleaningTask[] {
  const times = effectiveTimes(overrides, config);
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

      // R5 / R5a: resolve per booking first, then the latest checkout among collapsed bookings counts.
      const checkout = latest(group.map(times.checkoutOf));
      const earliestStart = atTime(first.departureDate, checkout);
      const deadline = nextArrivalDeadline(valid, first.cottageNumber, first.departureDate, times);
      // Minutes available to clean; negative when an override or booking time crosses the deadline.
      const window = deadline === undefined ? undefined : minutesBetween(earliestStart, deadline);

      return {
        bookingRef: first.externalRef,
        cottageNumber: first.cottageNumber,
        cottageType: type, // R4, used by R7a
        kind: 'DEPARTURE',
        departureDate: first.departureDate,
        plannedDate: first.departureDate,
        deferred: false,
        estimatedMinutes,
        requiredCrewSize: 1, // R6
        earliestStart,
        ...(deadline === undefined ? {} : { deadline }),
        tight: window !== undefined && window - estimatedMinutes <= 0, // R5
        atRisk: window !== undefined && window < estimatedMinutes, // R5b
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
  times: EffectiveTimes,
): LocalDateTime | undefined {
  const arrivals = valid.filter(
    (b) => b.cottageNumber === cottageNumber && b.arrivalDate >= departureDate,
  );
  if (arrivals.length === 0) return undefined;

  const nextDate = arrivals.map((b) => b.arrivalDate).reduce((a, b) => (b < a ? b : a));
  const checkins = arrivals.filter((b) => b.arrivalDate === nextDate).map(times.checkinOf);
  return atTime(nextDate, earliest(checkins));
}

/**
 * R5a: duplicate overrides for one booking resolve conservatively — the latest LATE_CHECKOUT and the
 * earliest EARLY_CHECKIN win — so the order of `overrides` never changes the result.
 */
function effectiveTimes(
  overrides: readonly TimeOverride[],
  config: SchedulingConfig,
): EffectiveTimes {
  const lateCheckout = new Map<string, LocalTime>();
  const earlyCheckin = new Map<string, LocalTime>();
  for (const o of overrides) {
    if (o.kind === 'LATE_CHECKOUT') {
      const seen = lateCheckout.get(o.bookingRef);
      lateCheckout.set(o.bookingRef, seen === undefined ? o.time : latest([seen, o.time]));
    } else {
      const seen = earlyCheckin.get(o.bookingRef);
      earlyCheckin.set(o.bookingRef, seen === undefined ? o.time : earliest([seen, o.time]));
    }
  }
  return {
    checkoutOf: (b) =>
      lateCheckout.get(b.externalRef) ?? b.checkoutTime ?? config.defaultCheckoutTime,
    checkinOf: (b) => earlyCheckin.get(b.externalRef) ?? b.checkinTime ?? config.defaultCheckinTime,
  };
}

const latest = (times: readonly LocalTime[]): LocalTime => times.reduce((a, b) => (b > a ? b : a));
const earliest = (times: readonly LocalTime[]): LocalTime =>
  times.reduce((a, b) => (b < a ? b : a));
