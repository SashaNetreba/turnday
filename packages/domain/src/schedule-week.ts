import {
  assignCottages,
  isStable,
  swapWithReserves,
  type WorkingRegular,
} from './assign-cottages.js';
import type { Availability } from './availability.js';
import type { CleaningTask } from './cleaning-task.js';
import { deriveHeadcount } from './derive-headcount.js';
import { chooseRegulars, MAX_SHIFTS } from './even-distribution.js';
import type { Housekeeper } from './housekeeper.js';
import { addDays } from './local-date.js';
import { fitsOn, planDays, type Shortfall, type WeekPlan } from './plan-week.js';
import { DAYS_IN_PLANNING_WEEK, lastDayOf, type PlanningWeek } from './planning-week.js';
import type { SchedulingConfig } from './scheduling-config.js';
import { weekendAlternatives, type WeekendAlternative } from './weekend-alternative.js';

/** Who cleans a staffed task (docs/domain-model.md §3). */
export interface Assignment {
  readonly task: CleaningTask;
  /** The crew: `requiredCrewSize` housekeepers. */
  readonly housekeeperIds: readonly string[];
  /** R10b: ⇔ the crew includes a reserve (day-planning call or R9a fallback); the manager confirms the call. */
  readonly needsReserveCall: boolean;
  /** R5h: only on a task deferred onto Saturday or Sunday — a weekday a reserve was free; the plan is unchanged. */
  readonly weekendAlternative?: WeekendAlternative;
}

/** WeekPlan + who cleans each staffed task — output of scheduleWeek (ADR 0004, step 2). */
export interface WeekSchedule extends WeekPlan {
  readonly assignments: readonly Assignment[];
}

export interface ScheduleWeekInput {
  /** From deriveCleaningTasks for the same week. */
  readonly tasks: readonly CleaningTask[];
  readonly housekeepers: readonly Housekeeper[];
  /** R10: an entry for every active housekeeper on every day of the week. */
  readonly availability: readonly Availability[];
  readonly week: PlanningWeek;
  readonly config: SchedulingConfig;
  /** R5g: the previous week's `carriedOver`. */
  readonly carriedOver?: readonly CleaningTask[];
}

/**
 * Plans the week and assigns people (ADR 0004): headcount from availability (R10) → day planning (R5c–R5g, R10a,
 * R10b) → who cleans each staffed task.
 */
export function scheduleWeek({
  tasks,
  housekeepers,
  availability,
  week,
  config,
  carriedOver = [],
}: ScheduleWeekInput): WeekSchedule {
  const headcount = deriveHeadcount({ housekeepers, availability, week });
  const { plan, staffing } = planDays({ tasks, headcount, week, config, carriedOver });

  const available = new Set(
    availability.filter((a) => a.available).map((a) => key(a.housekeeperId, a.date)),
  );
  const isAvailable = (h: Housekeeper, date: string): boolean =>
    h.active && available.has(key(h.id, date));

  // R11 / R12: which regulars work each day — reserves excluded (R10b), weekend days part of the same week.
  const regulars = housekeepers.filter((h) => h.active && !h.reserve);
  const working = chooseRegulars(
    staffing.map((d) => sumCrew(d.byRegular)),
    regulars.map((h) => ({
      id: h.id,
      days: new Set(staffing.flatMap((d, i) => (isAvailable(h, d.date) ? [i] : []))),
    })),
  );

  const assignments: Assignment[] = [];
  const weeklyLimit: Shortfall[] = [];
  const reserveCalls = new Map<string, number>();
  const reserveShifts = new Map<string, number>();
  const shifts = new Map<string, number>(); // regulars' shifts this week before today (R7a)
  const premium = new Map<string, number>(); // regulars' premium tasks this week before today (R7a)
  const byHousekeeperId = new Map(housekeepers.map((h) => [h.id, h]));
  const nextWeekStart = addDays(week.start, DAYS_IN_PLANNING_WEEK);
  staffing.forEach(({ date, byRegular, byReserve }, i) => {
    const next = date === lastDayOf(week) ? nextWeekStart : addDays(date, 1);
    const cannotWait = (task: CleaningTask): boolean => !fitsOn(task, next, config);

    // R7a: which cottage each regular R11 chose for today cleans.
    const people = (working[i] ?? []).map((id): WorkingRegular => ({
      id,
      stableFirst: byHousekeeperId.get(id)?.stableFirst ?? false,
      shifts: shifts.get(id) ?? 0,
      premium: premium.get(id) ?? 0,
    }));
    const regular = assignCottages(byRegular, people);
    const todayReserve: Assignment[] = [];

    // R10b: each reserve call goes to an available reserve under the limit (R9a) not yet called today — fewest
    // shifts this week, then lowest id. Day planning's own reserve calls first, then the R9a fallback.
    const calledToday = new Set<string>();
    const callReserves = (task: CleaningTask): boolean => {
      const free = housekeepers
        .filter(
          (h) =>
            h.reserve &&
            isAvailable(h, date) &&
            !calledToday.has(h.id) &&
            (reserveShifts.get(h.id) ?? 0) < MAX_SHIFTS,
        )
        .map((h) => h.id)
        .sort((a, b) => (reserveShifts.get(a) ?? 0) - (reserveShifts.get(b) ?? 0) || byId(a, b));
      const crew = free.slice(0, task.requiredCrewSize);
      if (crew.length < task.requiredCrewSize) return false;
      for (const id of crew) {
        calledToday.add(id);
        reserveShifts.set(id, (reserveShifts.get(id) ?? 0) + 1);
      }
      todayReserve.push({ task, housekeeperIds: crew, needsReserveCall: true });
      reserveCalls.set(date, (reserveCalls.get(date) ?? 0) + 1);
      return true;
    };
    // R9a: a regular place the 6-shift limit left unfilled — the tasks last in R5d order lose it. A task that cannot
    // wait goes to a reserve; otherwise, or with no reserve left, it is a WEEKLY_LIMIT shortfall.
    const fallback = regular.unstaffed.filter(cannotWait);
    for (const task of [...byReserve, ...fallback]) {
      if (!callReserves(task)) weeklyLimit.push({ task, reason: 'WEEKLY_LIMIT' });
    }
    for (const task of regular.unstaffed.filter((t) => !cannotWait(t))) {
      weeklyLimit.push({ task, reason: 'WEEKLY_LIMIT' });
    }

    // R7a before a reserve: both tasks cannot wait, so the reserve still cleans only such a task (R10b).
    const today = swapWithReserves(
      regular.assigned.map((c): Assignment => ({ ...c, needsReserveCall: false })),
      todayReserve,
      people,
      cannotWait,
    );
    assignments.push(...today.regular, ...today.reserve);
    for (const a of today.regular) {
      for (const id of a.housekeeperIds) {
        shifts.set(id, (shifts.get(id) ?? 0) + 1);
        if (!isStable(a.task)) premium.set(id, (premium.get(id) ?? 0) + 1);
      }
    }
  });

  // R5h: mark weekend deferrals with a weekday a reserve was free — a suggestion, the schedule is unchanged.
  const alternatives = weekendAlternatives(
    assignments,
    housekeepers.filter((h) => h.active && h.reserve),
    isAvailable,
    week,
    config,
  );

  const lost = new Set(weeklyLimit.map((s) => s.task));
  return {
    ...plan,
    tasks: plan.tasks.filter((t) => !lost.has(t)),
    days: plan.days.map((d) => ({ ...d, reserveCalls: reserveCalls.get(d.date) ?? 0 })),
    shortfall: [...plan.shortfall, ...weeklyLimit],
    assignments: assignments.map((a) => {
      const weekendAlternative = alternatives.get(a.task);
      return weekendAlternative === undefined ? a : { ...a, weekendAlternative };
    }),
  };
}

/** Plain string order, as for booking refs (R1). */
const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const sumCrew = (tasks: readonly CleaningTask[]): number =>
  tasks.reduce((sum, t) => sum + t.requiredCrewSize, 0);

const key = (housekeeperId: string, date: string): string => `${housekeeperId} ${date}`;
