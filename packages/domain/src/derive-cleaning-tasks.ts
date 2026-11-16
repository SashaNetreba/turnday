import type { Booking } from './booking.js';
import type { CleaningTask } from './cleaning-task.js';
import type { Cottage } from './cottage.js';
import { contains, type PlanningWeek } from './planning-week.js';

/**
 * Cleaning demand for one planning week — R1, R2, R3, invariant 11.
 * Only departures produce tasks, so stayovers and empty cottages never do (R2).
 */
export function deriveCleaningTasks(
  bookings: readonly Booking[],
  cottages: readonly Cottage[],
  week: PlanningWeek,
): CleaningTask[] {
  const schedulable = new Set(cottages.filter((c) => c.schedulable).map((c) => c.number));

  const departing = bookings.filter(
    (b) =>
      b.status !== 'CANCELLED' && // R1
      b.departureDate > b.arrivalDate && // R1: invalid bookings are skipped
      contains(week, b.departureDate) && // R1
      schedulable.has(b.cottageNumber), // R3: unknown (13) or non-schedulable (14)
  );

  // Invariant 11: one task per cottage per day; lowest externalRef wins, independent of input order.
  const byCottageAndDay = new Map<string, Booking>();
  for (const b of departing) {
    const key = `${String(b.cottageNumber)}@${b.departureDate}`;
    const current = byCottageAndDay.get(key);
    if (!current || b.externalRef < current.externalRef) byCottageAndDay.set(key, b);
  }

  return [...byCottageAndDay.values()]
    .map((b): CleaningTask => ({
      bookingRef: b.externalRef,
      cottageNumber: b.cottageNumber,
      kind: 'DEPARTURE',
      departureDate: b.departureDate,
      plannedDate: b.departureDate,
      deferred: false,
    }))
    .sort((a, b) =>
      a.plannedDate === b.plannedDate
        ? a.cottageNumber - b.cottageNumber
        : a.plannedDate < b.plannedDate
          ? -1
          : 1,
    );
}
