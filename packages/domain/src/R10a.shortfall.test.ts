import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { Booking, CleaningTask, Headcount, PlanningWeek, WeekPlan } from './index.js';
import { deriveCleaningTasks, localDate, planWeek } from './index.js';
import {
  booking,
  bookingArb,
  headcountArb,
  headcountFor,
  seedConfig,
  seedCottages,
  weekArb,
} from './test-fixtures.js';

const cottages = seedCottages();
const config = seedConfig();
const week = { start: localDate('2026-11-16') }; // Mon 16 – Sun 22 Nov 2026

function plan(
  bookings: readonly Booking[],
  headcount: readonly Headcount[],
  w: PlanningWeek = week,
): WeekPlan {
  return planWeek({
    tasks: deriveCleaningTasks(bookings, cottages, w, config),
    headcount,
    week: w,
    config,
  });
}

/** A departure on `date` with the next guest arriving the same day (16:00): it cannot wait. */
const turnover = (cottage: number, date: string): Booking[] => [
  booking(`OUT/${String(cottage)}`, cottage, '2026-11-10', date),
  booking(`IN/${String(cottage)}`, cottage, date, '2026-11-30'),
];

const key = (t: CleaningTask): string => `${String(t.cottageNumber)}@${t.departureDate}`;
const dayOf = (p: WeekPlan, date: string) => p.days.find((d) => d.date === date);

describe('R10a — staff needed vs available, shortfall', () => {
  it('R10a: on a short day the tasks that cannot be staffed are listed as shortfall, never dropped', () => {
    const p = plan(
      [...turnover(9, '2026-11-17'), ...turnover(2, '2026-11-17'), ...turnover(5, '2026-11-17')],
      headcountFor(week, 3, { '2026-11-17': 2 }),
    );

    expect(dayOf(p, '2026-11-17')).toEqual({ date: '2026-11-17', needed: 3, available: 2 });
    expect(p.tasks.map(key)).toEqual(['2@2026-11-17', '5@2026-11-17']);
    expect(p.shortfall.map((s) => [key(s.task), s.reason, s.lastPossibleDate])).toEqual([
      ['9@2026-11-17', 'NO_STAFF', '2026-11-17'],
    ]);
  });

  it('R10a: a day with zero staff lists its tasks that cannot wait as shortfall', () => {
    const p = plan(
      [...turnover(1, '2026-11-18'), ...turnover(11, '2026-11-18')],
      headcountFor(week, 2, { '2026-11-18': 0 }),
    );

    expect(dayOf(p, '2026-11-18')).toEqual({ date: '2026-11-18', needed: 2, available: 0 });
    expect(p.tasks).toEqual([]);
    expect(p.shortfall.map((s) => key(s.task))).toEqual(['1@2026-11-18', '11@2026-11-18']);
  });

  it('R10a: with enough staff there is no shortfall and every day of the week is reported', () => {
    const p = plan(
      [...turnover(3, '2026-11-16'), ...turnover(4, '2026-11-16'), ...turnover(7, '2026-11-19')],
      headcountFor(week, 2),
    );

    expect(p.shortfall).toEqual([]);
    expect(p.tasks).toHaveLength(3);
    expect(p.days.map((d) => [d.date, d.needed, d.available])).toEqual([
      ['2026-11-16', 2, 2],
      ['2026-11-17', 0, 2],
      ['2026-11-18', 0, 2],
      ['2026-11-19', 1, 2],
      ['2026-11-20', 0, 2],
      ['2026-11-21', 0, 2],
      ['2026-11-22', 0, 2],
    ]);
  });

  it('R10a: a staffed task stays on its departure day, not deferred', () => {
    const p = plan(turnover(6, '2026-11-20'), headcountFor(week, 1));

    expect(p.tasks).toEqual([
      expect.objectContaining({
        plannedDate: '2026-11-20',
        departureDate: '2026-11-20',
        deferred: false,
      }),
    ]);
  });

  it('R10a: a headcount with missing dates is rejected, listing the dates — never treated as 0', () => {
    const headcount = headcountFor(week, 2).filter(
      (h) => h.date !== '2026-11-18' && h.date !== '2026-11-20',
    );

    expect(() => plan([], headcount)).toThrow(/missing.*2026-11-18.*2026-11-20/);
  });

  it('R10a: a negative or non-integer headcount is rejected, listing the dates', () => {
    const headcount = headcountFor(week, 2, { '2026-11-17': -1, '2026-11-19': 1.5 });

    expect(() => plan([], headcount)).toThrow(/2026-11-17.*2026-11-19/);
  });

  it('R10a: a day given twice in the headcount is rejected, listing the date', () => {
    const headcount = [...headcountFor(week, 2), { date: localDate('2026-11-18'), available: 5 }];

    expect(() => plan([], headcount)).toThrow(/duplicated 2026-11-18/);
  });

  it('R10a: a task departing outside the planning week is rejected, not silently dropped', () => {
    const nextWeek = { start: localDate('2026-11-23') };
    const tasks = deriveCleaningTasks(turnover(4, '2026-11-24'), cottages, nextWeek, config);

    expect(() => planWeek({ tasks, headcount: headcountFor(week, 2), week, config })).toThrow(
      /outside the planning week.*cottage 4 on 2026-11-24/,
    );
  });
});

describe('R10a — properties', () => {
  it('invariant 1 / R10a: every task is staffed or in shortfall, exactly once, and no day exceeds its headcount', () => {
    fc.assert(
      fc.property(
        fc.array(bookingArb(), { maxLength: 40 }),
        weekArb.chain((w) => fc.tuple(fc.constant(w), headcountArb(w))),
        (bookings, [w, headcount]) => {
          const tasks = deriveCleaningTasks(bookings, cottages, w, config);
          const p = planWeek({ tasks, headcount, week: w, config });

          const placed = [...p.tasks, ...p.shortfall.map((s) => s.task)].map(key).sort();
          expect(placed).toEqual(tasks.map(key).sort());

          for (const { date, available } of headcount) {
            const staffed = p.tasks.filter((t) => t.plannedDate === date);
            expect(staffed.reduce((sum, t) => sum + t.requiredCrewSize, 0)).toBeLessThanOrEqual(
              available,
            );
          }
        },
      ),
    );
  });
});
