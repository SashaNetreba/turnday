import type { Availability } from './availability.js';
import type { CleaningTask } from './cleaning-task.js';
import { deriveHeadcount } from './derive-headcount.js';
import { chooseRegulars, MAX_SHIFTS } from './even-distribution.js';
import type { Housekeeper } from './housekeeper.js';
import { addDays } from './local-date.js';
import { fitsOn, planDays, type Shortfall, type WeekPlan } from './plan-week.js';
import { DAYS_IN_PLANNING_WEEK, lastDayOf, type PlanningWeek } from './planning-week.js';
import type { SchedulingConfig } from './scheduling-config.js';

/** Who cleans a staffed task (docs/domain-model.md §3). */
export interface Assignment {
  readonly task: CleaningTask;
  /** The crew: `requiredCrewSize` housekeepers. */
  readonly housekeeperIds: readonly string[];
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
  const nextWeekStart = addDays(week.start, DAYS_IN_PLANNING_WEEK);
  staffing.forEach(({ date, byRegular, byReserve }, i) => {
    // R7a placeholder: the day's working regulars in id order take its tasks in R5d order.
    const regular = crews(byRegular, [...(working[i] ?? [])].sort());
    assignments.push(...regular.assigned);

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
      assignments.push({ task, housekeeperIds: crew });
      reserveCalls.set(date, (reserveCalls.get(date) ?? 0) + 1);
      return true;
    };
    // R9a: a regular place the 6-shift limit left unfilled — the tasks last in R5d order lose it. A task that cannot
    // wait goes to a reserve; otherwise, or with no reserve left, it is a WEEKLY_LIMIT shortfall.
    const next = date === lastDayOf(week) ? nextWeekStart : addDays(date, 1);
    const fallback = regular.unstaffed.filter((task) => !fitsOn(task, next, config));
    for (const task of [...byReserve, ...fallback]) {
      if (!callReserves(task)) weeklyLimit.push({ task, reason: 'WEEKLY_LIMIT' });
    }
    for (const task of regular.unstaffed.filter((t) => fitsOn(t, next, config))) {
      weeklyLimit.push({ task, reason: 'WEEKLY_LIMIT' });
    }
  });

  const lost = new Set(weeklyLimit.map((s) => s.task));
  return {
    ...plan,
    tasks: plan.tasks.filter((t) => !lost.has(t)),
    days: plan.days.map((d) => ({ ...d, reserveCalls: reserveCalls.get(d.date) ?? 0 })),
    shortfall: [...plan.shortfall, ...weeklyLimit],
    assignments,
  };
}

/** Plain string order, as for booking refs (R1). */
const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Gives each task, in R5d order, the next `requiredCrewSize` people from `people` — each person at most one task (R9).
 * Tasks left when the people run out are `unstaffed`.
 */
function crews(
  tasks: readonly CleaningTask[],
  people: readonly string[],
): { assigned: Assignment[]; unstaffed: CleaningTask[] } {
  const assigned: Assignment[] = [];
  const unstaffed: CleaningTask[] = [];
  let next = 0;
  for (const task of tasks) {
    if (next + task.requiredCrewSize > people.length) {
      unstaffed.push(task);
      continue;
    }
    assigned.push({ task, housekeeperIds: people.slice(next, next + task.requiredCrewSize) });
    next += task.requiredCrewSize;
  }
  return { assigned, unstaffed };
}

const sumCrew = (tasks: readonly CleaningTask[]): number =>
  tasks.reduce((sum, t) => sum + t.requiredCrewSize, 0);

const key = (housekeeperId: string, date: string): string => `${housekeeperId} ${date}`;
