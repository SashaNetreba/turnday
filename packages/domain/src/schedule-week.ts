import type { Availability } from './availability.js';
import type { CleaningTask } from './cleaning-task.js';
import { deriveHeadcount } from './derive-headcount.js';
import type { Housekeeper } from './housekeeper.js';
import { planDays, type WeekPlan } from './plan-week.js';
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
  const assignments: Assignment[] = [];
  for (const { date, byRegular, byReserve } of staffing) {
    // R10: only active housekeepers available that day; R9: each takes at most one task.
    const working = (reserve: boolean): string[] =>
      housekeepers
        .filter((h) => h.active && h.reserve === reserve && available.has(key(h.id, date)))
        .map((h) => h.id)
        .sort();
    assignments.push(...crews(byRegular, working(false)), ...crews(byReserve, working(true)));
  }
  return { ...plan, assignments };
}

/**
 * Gives each task, in R5d order, the next `requiredCrewSize` people from `people` — each person at most one task (R9).
 * Day planning never staffs more crew than the headcount, which counts exactly these people (R10, invariant 1).
 */
function crews(tasks: readonly CleaningTask[], people: readonly string[]): Assignment[] {
  let next = 0;
  return tasks.map((task) => {
    const housekeeperIds = people.slice(next, next + task.requiredCrewSize);
    if (housekeeperIds.length < task.requiredCrewSize) {
      throw new Error(`Not enough housekeepers for cottage ${String(task.cottageNumber)}`);
    }
    next += task.requiredCrewSize;
    return { task, housekeeperIds };
  });
}

const key = (housekeeperId: string, date: string): string => `${housekeeperId} ${date}`;
