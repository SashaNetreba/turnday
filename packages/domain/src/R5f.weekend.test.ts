import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { Booking, CleaningTask, Headcount, WeekPlan } from './index.js';
import { deriveCleaningTasks, localDate, planWeek } from './index.js';
import {
  canWaitUntilMonday,
  headcountFor,
  isWeekendDay,
  lastStay,
  planningScenarioArb,
  seedConfig,
  seedCottages,
  stay,
  turnover,
} from './test-fixtures.js';

const cottages = seedCottages();
const config = seedConfig(); // workdayStart 10:00, STABLE 270 (4.5 h), check-in 16:00
const week = { start: localDate('2026-11-16') }; // Mon 16 – Sun 22 Nov 2026; next Monday = 23

function plan(bookings: readonly Booking[], headcount: readonly Headcount[]): WeekPlan {
  return planWeek({
    tasks: deriveCleaningTasks(bookings, cottages, week, config),
    headcount,
    week,
    config,
  });
}

const cottagesOf = (tasks: readonly CleaningTask[]): number[] =>
  tasks.map((t) => t.cottageNumber).sort((a, b) => a - b);
const onDay = (p: WeekPlan, date: string): number[] =>
  cottagesOf(p.tasks.filter((t) => t.plannedDate === date));
const dayOf = (p: WeekPlan, date: string) => p.days.find((d) => d.date === date);

describe('R5f — weekend', () => {
  it('R5f: on Sunday only the task that cannot wait (7) is cleaned and needed; 2, 4, 8 are carried to Monday', () => {
    const p = plan(
      [
        ...stay(2, '2026-11-22', '2026-11-25'), // next let Wed
        ...lastStay(4, '2026-11-22'), // no next arrival
        ...turnover(7, '2026-11-22'), // Sunday 16:00 arrival
        ...stay(8, '2026-11-22', '2026-11-24'), // next let Tue
      ],
      headcountFor(week, 1),
    );

    expect(onDay(p, '2026-11-22')).toEqual([7]);
    expect(dayOf(p, '2026-11-22')).toEqual({ date: '2026-11-22', needed: 1, available: 1 });
    expect(cottagesOf(p.carriedOver)).toEqual([2, 4, 8]);
    expect(p.shortfall).toEqual([]);
  });

  it('R5f: a task that cannot wait until Monday is cleaned on Saturday when a housekeeper is free', () => {
    // 5 out Sat 21, next guest Sun 22 16:00.
    const p = plan(stay(5, '2026-11-21', '2026-11-22'), headcountFor(week, 1));

    expect(onDay(p, '2026-11-21')).toEqual([5]);
    expect(p.tasks[0]).toMatchObject({ plannedDate: '2026-11-21', deferred: false });
  });

  it('R5f: a task that cannot wait until Monday is cleaned on Sunday when nobody is free on Saturday', () => {
    const p = plan(stay(5, '2026-11-21', '2026-11-22'), headcountFor(week, 1, { '2026-11-21': 0 }));

    expect(p.tasks).toEqual([
      expect.objectContaining({ cottageNumber: 5, plannedDate: '2026-11-22', deferred: true }),
    ]);
    expect(p.shortfall).toEqual([]);
  });

  it('R5f: a task that cannot wait until Monday goes to shortfall when nobody is free on Saturday or Sunday', () => {
    const p = plan(
      stay(5, '2026-11-21', '2026-11-22'),
      headcountFor(week, 1, { '2026-11-21': 0, '2026-11-22': 0 }),
    );

    expect(p.tasks).toEqual([]);
    expect(p.shortfall.map((s) => [s.task.cottageNumber, s.reason, s.lastPossibleDate])).toEqual([
      [5, 'NO_STAFF', '2026-11-22'],
    ]);
  });

  it('R5f: Monday check-in 14:30 — 10:00 + 4:30 = 14:30 fits, so the task waits until Monday although Sunday has a free housekeeper', () => {
    const p = plan(stay(3, '2026-11-22', '2026-11-23', '14:30'), headcountFor(week, 1));

    expect(p.tasks).toEqual([]);
    expect(dayOf(p, '2026-11-22')).toEqual({ date: '2026-11-22', needed: 0, available: 1 });
    expect(p.carriedOver).toEqual([
      expect.objectContaining({ cottageNumber: 3, plannedDate: '2026-11-23', deferred: true }),
    ]);
  });

  it('R5f: Monday check-in 14:00 — 14:30 > 14:00, so the task cannot wait and is cleaned on Sunday', () => {
    const p = plan(stay(3, '2026-11-22', '2026-11-23', '14:00'), headcountFor(week, 1));

    expect(onDay(p, '2026-11-22')).toEqual([3]);
    expect(dayOf(p, '2026-11-22')).toEqual({ date: '2026-11-22', needed: 1, available: 1 });
    expect(p.carriedOver).toEqual([]);
  });

  it('R5f: a weekend task without a deadline waits until Monday even when a housekeeper is free', () => {
    const p = plan(lastStay(4, '2026-11-21'), headcountFor(week, 2));

    expect(p.tasks).toEqual([]);
    expect(dayOf(p, '2026-11-21')).toMatchObject({ needed: 0, available: 2 });
    expect(dayOf(p, '2026-11-22')).toMatchObject({ needed: 0, available: 2 });
    expect(p.carriedOver).toEqual([
      expect.objectContaining({
        cottageNumber: 4,
        departureDate: '2026-11-21',
        plannedDate: '2026-11-23',
        deferred: true,
      }),
    ]);
  });

  it('R5f: a Sunday task that cannot wait goes to shortfall when nobody works on Sunday, not carried over', () => {
    const p = plan(turnover(7, '2026-11-22'), headcountFor(week, 1, { '2026-11-22': 0 }));

    expect(p.carriedOver).toEqual([]);
    expect(p.shortfall.map((s) => [s.task.cottageNumber, s.reason, s.lastPossibleDate])).toEqual([
      [7, 'NO_STAFF', '2026-11-22'],
    ]);
  });
});

describe('R5f — properties', () => {
  it('invariant 16 / R5f: a task is planned on a Saturday or Sunday only if it cannot wait until the following Monday', () => {
    fc.assert(
      fc.property(planningScenarioArb, ([bookings, w, headcount]) => {
        const tasks = deriveCleaningTasks(bookings, cottages, w, config);
        const p = planWeek({ tasks, headcount, week: w, config });
        for (const t of p.tasks.filter((x) => isWeekendDay(x.plannedDate))) {
          expect(canWaitUntilMonday(t, t.plannedDate, config)).toBe(false);
        }
      }),
    );
  });
});
