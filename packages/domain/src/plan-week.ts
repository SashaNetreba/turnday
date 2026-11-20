import type { CleaningTask } from './cleaning-task.js';
import type { LocalDate } from './local-date.js';
import { contains, daysOf, type PlanningWeek } from './planning-week.js';

/** R10a: housekeepers available on one date — input to planning, one entry for every day of the week. */
export interface Headcount {
  readonly date: LocalDate;
  readonly available: number;
}

/** R10a: staff needed (Σ requiredCrewSize of the day's candidates) vs available. */
export interface DayLoad {
  readonly date: LocalDate;
  readonly needed: number;
  readonly available: number;
}

export type ShortfallReason = 'NO_STAFF';

/** R10a: a task that cannot be staffed — reported, never dropped. */
export interface Shortfall {
  readonly task: CleaningTask;
  readonly reason: ShortfallReason;
  /** NO_STAFF: the last day the task could still have been cleaned. */
  readonly lastPossibleDate?: LocalDate;
}

export interface WeekPlan {
  /** Staffed tasks, in date order. */
  readonly tasks: readonly CleaningTask[];
  /** One entry per day of the planning week. */
  readonly days: readonly DayLoad[];
  readonly shortfall: readonly Shortfall[];
}

export interface PlanWeekInput {
  /** From deriveCleaningTasks for the same week. */
  readonly tasks: readonly CleaningTask[];
  readonly headcount: readonly Headcount[];
  readonly week: PlanningWeek;
}

/**
 * Staffs each day's tasks from that day's headcount — R10a, invariant 1.
 * Throws on invalid input (headcount missing / duplicated / not an integer ≥ 0, task departing outside the week).
 */
export function planWeek({ tasks, headcount, week }: PlanWeekInput): WeekPlan {
  const availableOn = validHeadcount(headcount, week);
  const outside = tasks.filter((t) => !contains(week, t.departureDate));
  if (outside.length > 0) {
    throw new Error(
      `Invalid tasks: departing outside the planning week: ${outside.map((t) => `cottage ${String(t.cottageNumber)} on ${t.departureDate}`).join(', ')}`,
    );
  }

  const staffed: CleaningTask[] = [];
  const shortfall: Shortfall[] = [];
  const days: DayLoad[] = [];

  for (const date of daysOf(week)) {
    const available = availableOn.get(date) ?? 0; // never 0 by default: validHeadcount has checked every day
    // Deterministic order until the priority rule replaces it: cottage number, lowest first.
    const candidates = tasks
      .filter((t) => t.departureDate === date)
      .sort((a, b) => a.cottageNumber - b.cottageNumber);

    let free = available;
    for (const task of candidates) {
      if (task.requiredCrewSize <= free) {
        staffed.push(task);
        free -= task.requiredCrewSize;
      } else {
        shortfall.push({ task, reason: 'NO_STAFF', lastPossibleDate: date });
      }
    }
    days.push({ date, needed: sumCrew(candidates), available });
  }

  return { tasks: staffed, days, shortfall };
}

/** R10a: every day of the week exactly once, an integer ≥ 0; otherwise the input is rejected, listing the dates. */
function validHeadcount(
  headcount: readonly Headcount[],
  week: PlanningWeek,
): ReadonlyMap<LocalDate, number> {
  const inWeek = headcount.filter((h) => contains(week, h.date));
  const byDate = new Map(inWeek.map((h) => [h.date, h.available]));

  const days = daysOf(week);
  const missing = days.filter((d) => !byDate.has(d));
  const duplicated = days.filter((d) => inWeek.filter((h) => h.date === d).length > 1);
  const invalid = inWeek
    .filter((h) => !Number.isInteger(h.available) || h.available < 0)
    .map((h) => h.date);

  const problems = [
    missing.length > 0 ? `missing ${missing.join(', ')}` : '',
    duplicated.length > 0 ? `duplicated ${duplicated.join(', ')}` : '',
    invalid.length > 0 ? `not an integer ≥ 0 on ${invalid.join(', ')}` : '',
  ].filter((p) => p !== '');
  if (problems.length > 0) throw new Error(`Invalid headcount: ${problems.join('; ')}`);

  return byDate;
}

const sumCrew = (tasks: readonly CleaningTask[]): number =>
  tasks.reduce((sum, t) => sum + t.requiredCrewSize, 0);
