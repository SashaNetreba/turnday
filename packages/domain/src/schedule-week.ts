import type { Availability } from './availability.js';
import type { CleaningTask } from './cleaning-task.js';
import { deriveHeadcount } from './derive-headcount.js';
import { chooseRegulars } from './even-distribution.js';
import type { Housekeeper } from './housekeeper.js';
import { planDays, type Shortfall, type WeekPlan } from './plan-week.js';
import type { PlanningWeek } from './planning-week.js';
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
  staffing.forEach(({ date, byRegular, byReserve }, i) => {
    // R7a placeholder: the day's working regulars in id order take its tasks in R5d order.
    const regular = crews(byRegular, [...(working[i] ?? [])].sort());
    assignments.push(...regular.assigned);
    // R9a: a regular place the 6-shift limit left unfilled — the tasks last in R5d order lose it.
    weeklyLimit.push(
      ...regular.unstaffed.map((task) => ({ task, reason: 'WEEKLY_LIMIT' as const })),
    );

    // Interim reserve choice: available reserves in id order (R10b's choice comes next). R9: one task each.
    const reserves = housekeepers
      .filter((h) => h.reserve && isAvailable(h, date))
      .map((h) => h.id)
      .sort();
    const reserve = crews(byReserve, reserves);
    if (reserve.unstaffed.length > 0) throw new Error(`Not enough reserves on ${date}`);
    assignments.push(...reserve.assigned);
  });

  const lost = new Set(weeklyLimit.map((s) => s.task));
  return {
    ...plan,
    tasks: plan.tasks.filter((t) => !lost.has(t)),
    shortfall: [...plan.shortfall, ...weeklyLimit],
    assignments,
  };
}

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
