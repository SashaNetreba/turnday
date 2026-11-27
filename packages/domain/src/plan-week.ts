import type { CleaningTask } from './cleaning-task.js';
import { atTime, minutesBetween } from './local-date-time.js';
import { addDays, followingMonday, isWeekend, type LocalDate } from './local-date.js';
import {
  DAYS_IN_PLANNING_WEEK,
  contains,
  daysOf,
  lastDayOf,
  type PlanningWeek,
} from './planning-week.js';
import type { SchedulingConfig } from './scheduling-config.js';

/**
 * R10a: housekeepers available on one date — input to planning, one entry for every day of the week.
 * Regular and reserve housekeepers are counted separately (R10b).
 */
export interface Headcount {
  readonly date: LocalDate;
  readonly regular: number;
  readonly reserve: number;
}

/** R10a: staff needed (Σ requiredCrewSize of the day's candidates) vs available; R10b: reserve calls made. */
export interface DayLoad {
  readonly date: LocalDate;
  readonly needed: number;
  readonly regular: number;
  readonly reserve: number;
  /** R10b: tasks staffed by a reserve housekeeper that day. */
  readonly reserveCalls: number;
}

/**
 * NO_STAFF: no housekeeper on any day it still fitted. DEADLINE_PASSED: a carried task that no longer fits (R5g).
 * WEEKLY_LIMIT: found when people are assigned (scheduleWeek) — a 7th shift would staff it (R9a).
 */
export type ShortfallReason = 'NO_STAFF' | 'DEADLINE_PASSED' | 'WEEKLY_LIMIT';

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
  /** R5g: still waiting after the week's last day, planned for the next week's first day → next week's input. */
  readonly carriedOver: readonly CleaningTask[];
}

export interface PlanWeekInput {
  /** From deriveCleaningTasks for the same week. */
  readonly tasks: readonly CleaningTask[];
  readonly headcount: readonly Headcount[];
  readonly week: PlanningWeek;
  readonly config: SchedulingConfig;
  /** R5g: the previous week's `carriedOver`; each must have departed before this week starts. */
  readonly carriedOver?: readonly CleaningTask[];
}

/**
 * Plans the week day by day from each day's headcount — R5c–R5g, R10a, R10b, invariants 1, 8, 9, 14–17, 19.
 * A day's candidates (that day's departures + tasks still waiting, incl. carried-in ones) are staffed in priority
 * order (R5d) by the regular housekeepers; the rest wait for the next day while they still fit before their deadline,
 * otherwise go to a reserve housekeeper while one is free (R10b), else to shortfall.
 * On Saturday and Sunday only tasks that cannot wait until Monday are staffed (R5f).
 * After the last day, waiting tasks are carried over to the next week (R5g).
 * Throws on invalid input (headcount missing / duplicated / not an integer ≥ 0, task departing outside the week,
 * carried task not departed before the week or given twice).
 */
export function planWeek(input: PlanWeekInput): WeekPlan {
  return planDays(input).plan;
}

/** Day planning (ADR 0004, step 1): which tasks one day's regular and reserve places staff, in R5d order. */
export interface DayStaffing {
  readonly date: LocalDate;
  /** Tasks staffed by regular housekeepers, as planned that day, in R5d order. */
  readonly byRegular: readonly CleaningTask[];
  /** Tasks staffed by a reserve call (R10b), as planned that day, in R5d order. */
  readonly byReserve: readonly CleaningTask[];
}

/**
 * `planWeek` plus, for each day, which tasks the regular and the reserve places staff — the input of the
 * assignment step (ADR 0004, step 2). Internal: not exported from the package.
 */
export function planDays({ tasks, headcount, week, config, carriedOver = [] }: PlanWeekInput): {
  readonly plan: WeekPlan;
  readonly staffing: readonly DayStaffing[];
} {
  const staffOn = validHeadcount(headcount, week);
  const outside = tasks.filter((t) => !contains(week, t.departureDate));
  if (outside.length > 0) {
    throw new Error(
      `Invalid tasks: departing outside the planning week: ${outside.map(describe).join(', ')}`,
    );
  }
  validCarriedOver(carriedOver, week);

  const staffed: CleaningTask[] = [];
  const shortfall: Shortfall[] = [];
  const days: DayLoad[] = [];
  const staffing: DayStaffing[] = [];
  const carried: CleaningTask[] = [];
  const nextWeekStart = addDays(week.start, DAYS_IN_PLANNING_WEEK); // R5g
  const lastDay = lastDayOf(week);

  // R5g: carried-in tasks are candidates from the first day, unless they no longer fit there.
  let waiting: CleaningTask[] = [];
  for (const task of carriedOver) {
    if (fitsOn(task, week.start, config)) waiting.push(task);
    else shortfall.push({ task, reason: 'DEADLINE_PASSED' });
  }

  for (const date of daysOf(week)) {
    // never 0 by default: validHeadcount has checked every day
    const { regular, reserve } = staffOn.get(date) ?? { regular: 0, reserve: 0 };
    const next = date === lastDay ? nextWeekStart : addDays(date, 1);
    const candidates = [...waiting, ...tasks.filter((t) => t.departureDate === date)].sort(
      byPriorityOn(next, config),
    );
    waiting = [];
    // R5f: on a weekend day only tasks that cannot wait until Monday are staffed (and needed).
    const weekend = isWeekend(date);
    const monday = followingMonday(date);
    const needsToday = (task: CleaningTask): boolean => !weekend || !fitsOn(task, monday, config);

    // R10b: regulars by R5d priority → defer what can wait → reserve for what cannot wait → shortfall.
    let freeRegular = regular;
    let freeReserve = reserve;
    const byRegular: CleaningTask[] = [];
    const byReserve: CleaningTask[] = [];
    for (const task of candidates) {
      if (needsToday(task) && task.requiredCrewSize <= freeRegular) {
        const planned = plannedOn(task, date, config);
        staffed.push(planned);
        byRegular.push(planned);
        freeRegular -= task.requiredCrewSize;
      } else if (fitsOn(task, next, config)) {
        // A task that can wait is deferred (or carried over), never given to the reserve.
        if (next === nextWeekStart)
          carried.push(plannedOn(task, next, config)); // R5g
        else waiting.push(task); // R5c / R5f: deferred, still finishes before the next arrival
      } else if (task.requiredCrewSize <= freeReserve) {
        const planned = plannedOn(task, date, config); // R10b: cannot be deferred → reserve call
        staffed.push(planned);
        byReserve.push(planned);
        freeReserve -= task.requiredCrewSize;
      } else {
        shortfall.push({ task, reason: 'NO_STAFF', lastPossibleDate: date });
      }
    }
    days.push({
      date,
      needed: sumCrew(candidates.filter(needsToday)),
      regular,
      reserve,
      reserveCalls: byReserve.length,
    });
    staffing.push({ date, byRegular, byReserve });
  }

  return { plan: { tasks: staffed, days, shortfall, carriedOver: carried }, staffing };
}

/**
 * R5d: tasks that cannot be deferred to `next` come first, then the ones that can (invariant 19); within each group
 * `byDeadline`. Total order on distinct tasks, so the input order never changes the plan (invariant 7).
 */
function byPriorityOn(
  next: LocalDate,
  config: SchedulingConfig,
): (a: CleaningTask, b: CleaningTask) => number {
  return (a, b) => {
    const aWaits = fitsOn(a, next, config);
    const bWaits = fitsOn(b, next, config);
    if (aWaits !== bWaits) return aWaits ? 1 : -1;
    return byDeadline(a, b);
  };
}

/** R5d within a group: earliest deadline first, no deadline last; ties by cottage number, then departure date. */
function byDeadline(a: CleaningTask, b: CleaningTask): number {
  if (a.deadline !== b.deadline) {
    if (a.deadline === undefined) return 1;
    if (b.deadline === undefined) return -1;
    return a.deadline < b.deadline ? -1 : 1;
  }
  if (a.cottageNumber !== b.cottageNumber) return a.cottageNumber - b.cottageNumber;
  return a.departureDate < b.departureDate ? -1 : a.departureDate > b.departureDate ? 1 : 0;
}

/**
 * R5c: a task can be cleaned on a later `day` if it has no deadline or workdayStart + estimate ≤ deadline.
 * Exported for the assignment step (R9a "cannot wait"); not exported from the package.
 */
export function fitsOn(task: CleaningTask, day: LocalDate, config: SchedulingConfig): boolean {
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

/**
 * R10a: every day of the week exactly once, `regular` and `reserve` each an integer ≥ 0 (a missing number is invalid,
 * never 0); otherwise the input is rejected, listing the dates.
 */
function validHeadcount(
  headcount: readonly Headcount[],
  week: PlanningWeek,
): ReadonlyMap<LocalDate, Headcount> {
  const inWeek = headcount.filter((h) => contains(week, h.date));
  const byDate = new Map(inWeek.map((h) => [h.date, h]));

  const days = daysOf(week);
  const missing = days.filter((d) => !byDate.has(d));
  const duplicated = days.filter((d) => inWeek.filter((h) => h.date === d).length > 1);
  const invalid = inWeek
    .filter((h) => !isCount(h.regular) || !isCount(h.reserve))
    .map((h) => h.date);

  const problems = [
    missing.length > 0 ? `missing ${missing.join(', ')}` : '',
    duplicated.length > 0 ? `duplicated ${duplicated.join(', ')}` : '',
    invalid.length > 0 ? `not an integer ≥ 0 on ${invalid.join(', ')}` : '',
  ].filter((p) => p !== '');
  if (problems.length > 0) throw new Error(`Invalid headcount: ${problems.join('; ')}`);

  return byDate;
}

/** R5g: carried tasks departed before the week starts, at most one per cottage and departure date (invariant 11). */
function validCarriedOver(carriedOver: readonly CleaningTask[], week: PlanningWeek): void {
  const notBefore = carriedOver.filter((t) => t.departureDate >= week.start);
  const seen = new Set<string>();
  const duplicated = carriedOver.filter((t) => {
    const key = describe(t);
    if (seen.has(key)) return true;
    seen.add(key);
    return false;
  });
  const problems = [
    notBefore.length > 0
      ? `not departed before ${week.start}: ${notBefore.map(describe).join(', ')}`
      : '',
    duplicated.length > 0 ? `duplicated ${duplicated.map(describe).join(', ')}` : '',
  ].filter((p) => p !== '');
  if (problems.length > 0) throw new Error(`Invalid carried tasks: ${problems.join('; ')}`);
}

const describe = (t: CleaningTask): string =>
  `cottage ${String(t.cottageNumber)} on ${t.departureDate}`;

/** An integer ≥ 0. `undefined` (a missing number in untyped input) is not a count. */
const isCount = (n: number): boolean => Number.isInteger(n) && n >= 0;

const sumCrew = (tasks: readonly CleaningTask[]): number =>
  tasks.reduce((sum, t) => sum + t.requiredCrewSize, 0);
