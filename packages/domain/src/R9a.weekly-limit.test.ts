import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { Booking, CleaningTask, Housekeeper, WeekSchedule } from './index.js';
import { addDays, daysOf, deriveCleaningTasks, localDate, scheduleWeek } from './index.js';
import {
  availableAllWeek,
  housekeeper,
  mondayTeamWeekArb,
  seedConfig,
  seedCottages,
  stay,
  turnover,
} from './test-fixtures.js';

const cottages = seedCottages();
const config = seedConfig(); // workdayStart 10:00, STABLE 270, PREMIUM 300, check-in 16:00
const week = { start: localDate('2026-11-16') }; // Mon 16 – Sun 22 Nov 2026
const days = daysOf(week).map(String);
const SUN = days[6] ?? '';

function schedule(
  bookings: readonly Booking[],
  housekeepers: readonly Housekeeper[],
  unavailable: Readonly<Record<string, readonly string[]>> = {},
): WeekSchedule {
  return scheduleWeek({
    tasks: deriveCleaningTasks(bookings, cottages, week, config),
    housekeepers,
    availability: availableAllWeek(
      week,
      housekeepers.map((h) => h.id),
      unavailable,
    ),
    week,
    config,
  });
}

/** Cottages 1–6 turn over Monday to Saturday, one a day. */
const mondayToSaturday = (): Booking[] =>
  [1, 2, 3, 4, 5, 6].flatMap((c, d) => turnover(c, days[d] ?? ''));

describe('R9a — weekly rest', () => {
  it('R9a: A is the only regular; cottages 1–6 turn over Monday to Saturday → A has 6 shifts; Sunday’s cottage 7 is a WEEKLY_LIMIT shortfall', () => {
    const s = schedule([...mondayToSaturday(), ...turnover(7, SUN)], [housekeeper('A')]);

    expect(s.assignments.map((a) => [a.task.cottageNumber, a.housekeeperIds])).toEqual(
      [1, 2, 3, 4, 5, 6].map((c) => [c, ['A']]),
    );
    expect(s.shortfall.map((x) => [x.task.cottageNumber, x.reason])).toEqual([[7, 'WEEKLY_LIMIT']]);
    expect(s.tasks.map((t) => t.cottageNumber)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('R9a: on a day with fewer filled places than tasks, the task last in R5d order loses its place', () => {
    // A works Mon–Sat alone (6 shifts); B is available only on Sunday. Sunday: 8 (check-in 15:00) comes before
    // 7 (check-in 16:00) in R5d order → B cleans 8, 7 is WEEKLY_LIMIT.
    const s = schedule(
      [...mondayToSaturday(), ...turnover(7, SUN), ...stay(8, SUN, SUN, '15:00')],
      [housekeeper('A'), housekeeper('B')],
      { B: days.slice(0, 6) },
    );

    expect(
      s.assignments
        .filter((a) => a.task.plannedDate === SUN)
        .map((a) => [a.task.cottageNumber, a.housekeeperIds]),
    ).toEqual([[8, ['B']]]);
    expect(s.shortfall.map((x) => [x.task.cottageNumber, x.reason])).toEqual([[7, 'WEEKLY_LIMIT']]);
  });
});

describe('R9a — properties', () => {
  /** R5c test oracle: the task can still be finished on `day` (no deadline, or workdayStart + estimate ≤ deadline). */
  const fitsOn = (t: CleaningTask, day: string): boolean =>
    t.deadline === undefined ||
    (Date.parse(`${t.deadline}:00Z`) - Date.parse(`${day}T${config.workdayStart}:00Z`)) / 60_000 >=
      t.estimatedMinutes;

  it('invariant 23 / R9a: in a week starting on Monday, WEEKLY_LIMIT happens only on Sunday and only for a task that cannot wait', () => {
    fc.assert(
      fc.property(mondayTeamWeekArb, ({ week: w, housekeepers, availability, bookings }) => {
        const s = scheduleWeek({
          tasks: deriveCleaningTasks(bookings, cottages, w, config),
          housekeepers,
          availability,
          week: w,
          config,
        });
        const sunday = addDays(w.start, 6);
        for (const { task } of s.shortfall.filter((x) => x.reason === 'WEEKLY_LIMIT')) {
          expect(task.plannedDate, `cottage ${String(task.cottageNumber)}`).toBe(sunday);
          expect(fitsOn(task, addDays(sunday, 1)), `cottage ${String(task.cottageNumber)}`).toBe(
            false,
          );
        }
      }),
    );
  });
});
