import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { Booking, CleaningTask, Headcount, WeekPlan } from './index.js';
import { addDays, deriveCleaningTasks, localDate, planWeek } from './index.js';
import {
  headcountFor,
  lastStay,
  nextDayBoundaryScenarioArb,
  planningScenarioArb,
  seedConfig,
  seedCottages,
  stay,
  turnover,
} from './test-fixtures.js';

const cottages = seedCottages();
const config = seedConfig(); // workdayStart 10:00, STABLE 270, PREMIUM 300, check-in 16:00
const week = { start: localDate('2026-11-16') }; // Mon 16 – Sun 22 Nov 2026

function plan(bookings: readonly Booking[], headcount: readonly Headcount[]): WeekPlan {
  return planWeek({
    tasks: deriveCleaningTasks(bookings, cottages, week, config),
    headcount,
    week,
    config,
  });
}

const onDay = (p: WeekPlan, date: string): number[] =>
  p.tasks.filter((t) => t.plannedDate === date).map((t) => t.cottageNumber);
const taskOf = (p: WeekPlan, cottage: number): CleaningTask | undefined =>
  p.tasks.find((t) => t.cottageNumber === cottage);
const dayOf = (p: WeekPlan, date: string) => p.days.find((d) => d.date === date);
const shortOf = (p: WeekPlan) =>
  p.shortfall.map((s) => [s.task.cottageNumber, s.reason, s.lastPossibleDate]);

const MONDAY = '2026-11-16';
const SUNDAY = '2026-11-22';

describe('R10b — reserve', () => {
  it('R10b: a task that can wait is deferred instead of calling the reserve', () => {
    // Mon: 5 regulars + 1 reserve; 1, 3, 4, 5, 6 have arrivals today, 2 is next let on Wednesday.
    const p = plan(
      [
        ...turnover(1, MONDAY),
        ...stay(2, MONDAY, '2026-11-18'),
        ...turnover(3, MONDAY),
        ...turnover(4, MONDAY),
        ...turnover(5, MONDAY),
        ...turnover(6, MONDAY),
      ],
      headcountFor(week, 5, {}, 1),
    );

    expect(onDay(p, MONDAY)).toEqual([1, 3, 4, 5, 6]);
    expect(taskOf(p, 2)).toMatchObject({ plannedDate: '2026-11-17', deferred: true });
    expect(dayOf(p, MONDAY)).toMatchObject({ regular: 5, reserve: 1, reserveCalls: 0 });
    expect(p.shortfall).toEqual([]);
  });

  it('R10b: when every regular has a task, the reserve takes the task that cannot wait', () => {
    // Mon: 5 regulars + 1 reserve; all 6 cottages have arrivals today.
    const p = plan(
      [1, 2, 3, 4, 5, 6].flatMap((c) => turnover(c, MONDAY)),
      headcountFor(week, 5, {}, 1),
    );

    expect(onDay(p, MONDAY)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(dayOf(p, MONDAY)).toMatchObject({ needed: 6, regular: 5, reserve: 1, reserveCalls: 1 });
    expect(p.shortfall).toEqual([]);
  });

  it('R10b: with no reserve available, the task that cannot wait goes to shortfall', () => {
    // Same Monday without a reserve: R5d tie on the deadline → the highest cottage number (6) is left.
    const p = plan(
      [1, 2, 3, 4, 5, 6].flatMap((c) => turnover(c, MONDAY)),
      headcountFor(week, 5, {}, 0),
    );

    expect(onDay(p, MONDAY)).toEqual([1, 2, 3, 4, 5]);
    expect(dayOf(p, MONDAY)).toMatchObject({ reserveCalls: 0 });
    expect(shortOf(p)).toEqual([[6, 'NO_STAFF', MONDAY]]);
  });

  it('R10b: the reserve is called only up to the reserves available that day; the rest goes to shortfall', () => {
    // Mon: 5 regulars + 1 reserve; 7 cottages with arrivals today.
    const p = plan(
      [1, 2, 3, 4, 5, 6, 7].flatMap((c) => turnover(c, MONDAY)),
      headcountFor(week, 5, {}, 1),
    );

    expect(onDay(p, MONDAY)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(dayOf(p, MONDAY)).toMatchObject({ reserveCalls: 1 });
    expect(shortOf(p)).toEqual([[7, 'NO_STAFF', MONDAY]]);
  });

  it('R10b / R5f: on Sunday with no regular, the reserve takes only the task that cannot wait (7); 2, 4, 8 are carried to Monday', () => {
    const p = plan(
      [
        ...lastStay(2, SUNDAY),
        ...lastStay(4, SUNDAY),
        ...turnover(7, SUNDAY),
        ...lastStay(8, SUNDAY),
      ],
      headcountFor(week, 1, { [SUNDAY]: { regular: 0, reserve: 1 } }),
    );

    expect(onDay(p, SUNDAY)).toEqual([7]);
    expect(dayOf(p, SUNDAY)).toEqual({
      date: SUNDAY,
      needed: 1,
      regular: 0,
      reserve: 1,
      reserveCalls: 1,
    });
    expect(p.carriedOver.map((t) => [t.cottageNumber, t.plannedDate])).toEqual([
      [2, '2026-11-23'],
      [4, '2026-11-23'],
      [8, '2026-11-23'],
    ]);
    expect(p.shortfall).toEqual([]);
  });

  it('R10b / R5g: on the week’s last day a task that can be carried over is carried over, never given to a free reserve', () => {
    // Sun: no regular, 2 reserves; 3 is next let Monday 14:30 → fits Monday (10:00 + 270 = 14:30), zero slack.
    const p = plan(
      stay(3, SUNDAY, '2026-11-23', '14:30'),
      headcountFor(week, 1, { [SUNDAY]: { regular: 0, reserve: 2 } }),
    );

    expect(p.tasks).toEqual([]);
    expect(p.carriedOver).toEqual([
      expect.objectContaining({
        cottageNumber: 3,
        plannedDate: '2026-11-23',
        deferred: true,
        tight: true,
      }),
    ]);
    expect(dayOf(p, SUNDAY)).toMatchObject({ reserveCalls: 0 });
    expect(p.shortfall).toEqual([]);
  });
});

describe('R10b — properties', () => {
  /** R5c test oracle: the task can still be finished on `day` (no deadline, or workdayStart + estimate ≤ deadline). */
  const fitsOn = (t: CleaningTask, day: string): boolean =>
    t.deadline === undefined ||
    (Date.parse(`${t.deadline}:00Z`) - Date.parse(`${day}T${config.workdayStart}:00Z`)) / 60_000 >=
      t.estimatedMinutes;

  it('invariant 17 / R10b: a reserve is called only when every regular has a task, and only for tasks that cannot be deferred', () => {
    fc.assert(
      fc.property(
        fc.oneof(planningScenarioArb, nextDayBoundaryScenarioArb),
        ([bookings, w, headcount]) => {
          const tasks = deriveCleaningTasks(bookings, cottages, w, config);
          const p = planWeek({ tasks, headcount, week: w, config });
          for (const day of p.days.filter((d) => d.reserveCalls > 0)) {
            const staffed = p.tasks.filter((t) => t.plannedDate === day.date);
            const crew = staffed.reduce((sum, t) => sum + t.requiredCrewSize, 0);
            // Every available regular has a task.
            expect(crew - day.reserveCalls).toBe(day.regular);
            // Regulars take the tasks that cannot be deferred first (R5d); a task that can wait is deferred instead
            // of calling the reserve — so on a day with a reserve call, nothing staffed could have been deferred.
            const next = addDays(day.date, 1); // after the week's last day: the next week's first day (R5g)
            expect(staffed.filter((t) => fitsOn(t, next)).map((t) => t.cottageNumber)).toEqual([]);
          }
        },
      ),
    );
  });
});
