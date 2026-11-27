/**
 * R5h: a weekday on which a free reserve could have cleaned a task that was deferred onto Saturday or Sunday.
 * A suggestion for the manager — the schedule itself is not changed. Internal to the domain.
 */
import type { CleaningTask } from './cleaning-task.js';
import { MAX_SHIFTS } from './even-distribution.js';
import type { Housekeeper } from './housekeeper.js';
import { addDays, isWeekend, type LocalDate } from './local-date.js';
import { byPriorityOn } from './plan-week.js';
import { lastDayOf, type PlanningWeek } from './planning-week.js';
import type { SchedulingConfig } from './scheduling-config.js';

/** R5h: the earliest weekday a reserve was free, and that reserve (`requiredCrewSize` ids). */
export interface WeekendAlternative {
  readonly date: LocalDate;
  readonly housekeeperIds: readonly string[];
}

interface Assigned {
  readonly task: CleaningTask;
  readonly housekeeperIds: readonly string[];
}

/**
 * For each task deferred onto Saturday or Sunday — in planned-date order, then R5d order — the earliest weekday from
 * its departure (within the week) up to the day before its planned date on which enough reserves were free: available,
 * not assigned that day, not already offered that day, and under 6 shifts counting earlier offers (R9a, R9). Among
 * free reserves the fewest shifts (offers included) first, ties by lowest id (R10b). Returns the alternatives by task.
 */
export function weekendAlternatives(
  assignments: readonly Assigned[],
  reserves: readonly Housekeeper[],
  isAvailable: (h: Housekeeper, date: LocalDate) => boolean,
  week: PlanningWeek,
  config: SchedulingConfig,
): Map<CleaningTask, WeekendAlternative> {
  const shifts = new Map<string, number>();
  const busy = new Set<string>();
  for (const a of assignments) {
    for (const id of a.housekeeperIds) {
      shifts.set(id, (shifts.get(id) ?? 0) + 1);
      busy.add(key(id, a.task.plannedDate));
    }
  }

  const lastDay = lastDayOf(week);
  const weekendDeferrals = assignments
    .map((a) => a.task)
    .filter((t) => t.deferred && isWeekend(t.plannedDate))
    .sort(
      (a, b) =>
        compare(a.plannedDate, b.plannedDate) ||
        byPriorityOn(addDays(a.plannedDate, 1), config)(a, b),
    );

  const alternatives = new Map<CleaningTask, WeekendAlternative>();
  for (const task of weekendDeferrals) {
    const first = task.departureDate < week.start ? week.start : task.departureDate;
    for (let date = first; date < task.plannedDate && date <= lastDay; date = addDays(date, 1)) {
      if (isWeekend(date)) continue;
      const free = reserves
        .filter(
          (h) =>
            isAvailable(h, date) &&
            !busy.has(key(h.id, date)) &&
            (shifts.get(h.id) ?? 0) < MAX_SHIFTS,
        )
        .sort((a, b) => (shifts.get(a.id) ?? 0) - (shifts.get(b.id) ?? 0) || compare(a.id, b.id))
        .slice(0, task.requiredCrewSize)
        .map((h) => h.id);
      if (free.length < task.requiredCrewSize) continue;
      for (const id of free) {
        busy.add(key(id, date)); // offered at most once a day (R9)
        shifts.set(id, (shifts.get(id) ?? 0) + 1); // an offer counts as a shift (R9a)
      }
      alternatives.set(task, { date, housekeeperIds: free });
      break;
    }
  }
  return alternatives;
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const key = (id: string, date: string): string => `${id} ${date}`;
