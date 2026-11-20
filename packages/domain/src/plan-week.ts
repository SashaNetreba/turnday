import type { CleaningTask } from './cleaning-task.js';
import { atTime, minutesBetween } from './local-date-time.js';
import { addDays, type LocalDate } from './local-date.js';
import { contains, daysOf, type PlanningWeek } from './planning-week.js';
import type { SchedulingConfig } from './scheduling-config.js';

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
  /** Staffed tasks, in planned-date order. */
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
  readonly config: SchedulingConfig;
}

/**
 * Plans the week day by day from each day's headcount — R5c–R5e, R10a, invariants 1, 8, 9, 14, 15.
 * A day's candidates (that day's departures + tasks still waiting) are staffed in priority order (R5d);
 * the rest wait for the next day while they still fit before their deadline, otherwise go to shortfall.
 * Throws on invalid input (headcount missing / duplicated / not an integer ≥ 0, task departing outside the week).
 */
export function planWeek({ tasks, headcount, week, config }: PlanWeekInput): WeekPlan {
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

  let waiting: CleaningTask[] = [];
  for (const date of daysOf(week)) {
    const available = availableOn.get(date) ?? 0; // never 0 by default: validHeadcount has checked every day
    const candidates = [...waiting, ...tasks.filter((t) => t.departureDate === date)].sort(
      byPriority,
    );
    const next = addDays(date, 1);
    waiting = [];

    let free = available;
    for (const task of candidates) {
      if (task.requiredCrewSize <= free) {
        staffed.push(plannedOn(task, date, config));
        free -= task.requiredCrewSize;
      } else if (contains(week, next) && fitsOn(task, next, config)) {
        waiting.push(task); // R5c: deferred, still finishes before the next arrival
      } else {
        // Past the week's last day: shortfall for now; carry-over (R5g) is not implemented yet.
        shortfall.push({ task, reason: 'NO_STAFF', lastPossibleDate: date });
      }
    }
    days.push({ date, needed: sumCrew(candidates), available });
  }

  return { tasks: staffed, days, shortfall };
}

/**
 * R5d: earliest deadline first, no deadline last; ties by cottage number (lowest first), then departure date.
 * Total order on distinct tasks, so the input order never changes the plan (invariant 7).
 */
function byPriority(a: CleaningTask, b: CleaningTask): number {
  if (a.deadline !== b.deadline) {
    if (a.deadline === undefined) return 1;
    if (b.deadline === undefined) return -1;
    return a.deadline < b.deadline ? -1 : 1;
  }
  if (a.cottageNumber !== b.cottageNumber) return a.cottageNumber - b.cottageNumber;
  return a.departureDate < b.departureDate ? -1 : a.departureDate > b.departureDate ? 1 : 0;
}

/** R5c: a task can be cleaned on a later `day` if it has no deadline or workdayStart + estimate ≤ deadline. */
function fitsOn(task: CleaningTask, day: LocalDate, config: SchedulingConfig): boolean {
  return (
    task.deadline === undefined ||
    minutesBetween(atTime(day, config.workdayStart), task.deadline) >= task.estimatedMinutes
  );
}

/**
 * The task as cleaned on `date`. On its departure day it is unchanged; later it is deferred and its
 * tight / at-risk flags are recalculated from `date + workdayStart` (R5c, invariant 14).
 * departureDate and earliestStart never change (invariant 15).
 */
function plannedOn(task: CleaningTask, date: LocalDate, config: SchedulingConfig): CleaningTask {
  if (date === task.departureDate) return task;
  const window =
    task.deadline === undefined
      ? undefined
      : minutesBetween(atTime(date, config.workdayStart), task.deadline);
  return {
    ...task,
    plannedDate: date,
    deferred: true,
    tight: window !== undefined && window - task.estimatedMinutes <= 0, // R5
    atRisk: window !== undefined && window < task.estimatedMinutes, // R5b
  };
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
