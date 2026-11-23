import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { Booking, CleaningTask, Headcount, PlanningWeek, WeekPlan } from './index.js';
import { addDays, deriveCleaningTasks, localDate, planWeek } from './index.js';
import {
  bookingArb,
  headcountArb,
  headcountFor,
  lastStay,
  seedConfig,
  seedCottages,
  stay,
  turnover,
  weekArb,
  weekBoundaryTwoWeekScenarioArb,
} from './test-fixtures.js';

const cottages = seedCottages();
const config = seedConfig(); // workdayStart 10:00, STABLE 270, check-in 16:00
const week = { start: localDate('2026-11-16') }; // Mon 16 – Sun 22 Nov 2026
const nextWeek = { start: localDate('2026-11-23') }; // Mon 23 – Sun 29 Nov 2026

function plan(
  bookings: readonly Booking[],
  headcount: readonly Headcount[],
  w: PlanningWeek = week,
  carriedOver: readonly CleaningTask[] = [],
): WeekPlan {
  return planWeek({
    tasks: deriveCleaningTasks(bookings, cottages, w, config),
    headcount,
    week: w,
    config,
    carriedOver,
  });
}

const cottagesOf = (tasks: readonly CleaningTask[]): number[] => tasks.map((t) => t.cottageNumber);

describe('R5g — carry-over', () => {
  it("R5g: a task still waiting after the week's last day is carried over, not shortfall", () => {
    // Sun 22, one housekeeper: 7 has a same-day arrival, 2 is next let on Wed 25.
    const p = plan(
      [...turnover(7, '2026-11-22'), ...stay(2, '2026-11-22', '2026-11-25')],
      headcountFor(week, 1),
    );

    expect(cottagesOf(p.tasks.filter((t) => t.plannedDate === '2026-11-22'))).toEqual([7]);
    expect(p.shortfall).toEqual([]);
    expect(p.carriedOver).toEqual([
      expect.objectContaining({
        cottageNumber: 2,
        departureDate: '2026-11-22',
        earliestStart: '2026-11-22T10:00',
        plannedDate: '2026-11-23',
        deferred: true,
      }),
    ]);
  });

  it("R5g: a task that cannot be finished on the next week's first day goes to shortfall, not carried over", () => {
    // 2 out Sun 22, next guest Mon 23 with check-in 13:00: Mon 10:00 + 270 min = 14:30 > 13:00.
    const p = plan(
      [...turnover(7, '2026-11-22'), ...stay(2, '2026-11-22', '2026-11-23', '13:00')],
      headcountFor(week, 1),
    );

    expect(p.carriedOver).toEqual([]);
    expect(p.shortfall.map((s) => [s.task.cottageNumber, s.reason, s.lastPossibleDate])).toEqual([
      [2, 'NO_STAFF', '2026-11-22'],
    ]);
  });

  it("R5g: carried tasks are candidates on the next week's first day and compete by the same priority", () => {
    const bookings = [
      ...turnover(7, '2026-11-22'),
      ...stay(2, '2026-11-22', '2026-11-25'), // carried, next let Wed 25
      ...turnover(1, '2026-11-23'), // Mon 23, same-day arrival
      ...stay(9, '2026-11-23', '2026-11-26'), // Mon 23, next let Thu 26
    ];
    const first = plan(bookings, headcountFor(week, 1));
    const second = plan(bookings, headcountFor(nextWeek, 2), nextWeek, first.carriedOver);

    // Mon 23, two housekeepers: 1 (deadline Mon) and the carried 2 (Wed) before 9 (Thu).
    expect(cottagesOf(second.tasks.filter((t) => t.plannedDate === '2026-11-23'))).toEqual([1, 2]);
    expect(second.tasks.find((t) => t.cottageNumber === 2)).toMatchObject({
      departureDate: '2026-11-22',
      earliestStart: '2026-11-22T10:00',
      plannedDate: '2026-11-23',
      deferred: true,
    });
    expect(second.tasks.find((t) => t.cottageNumber === 9)).toMatchObject({
      plannedDate: '2026-11-24',
      deferred: true,
    });
    expect(second.days[0]).toEqual({
      date: '2026-11-23',
      needed: 3,
      regular: 2,
      reserve: 0,
      reserveCalls: 0,
    });
  });

  it('R5g: a carried task that can no longer be finished on the first day goes to shortfall as DEADLINE_PASSED', () => {
    // Departed Sun 22, next guest Mon 23 at 13:00: Mon 10:00 + 270 min = 14:30 > 13:00.
    const carried = deriveCleaningTasks(
      stay(2, '2026-11-22', '2026-11-23', '13:00'),
      cottages,
      week,
      config,
    );
    const p = plan([], headcountFor(nextWeek, 3), nextWeek, carried);

    expect(p.tasks).toEqual([]);
    expect(p.carriedOver).toEqual([]);
    expect(p.shortfall).toEqual([{ task: carried[0], reason: 'DEADLINE_PASSED' }]);
  });

  it('R5g: two carried tasks for the same cottage and departure date are rejected as invalid input, listing them', () => {
    const carried = deriveCleaningTasks(
      stay(2, '2026-11-22', '2026-11-25'),
      cottages,
      week,
      config,
    );

    expect(() => plan([], headcountFor(nextWeek, 2), nextWeek, [...carried, ...carried])).toThrow(
      /duplicated.*cottage 2 on 2026-11-22/,
    );
  });

  it("R5g: a carried-over task's tight / at-risk flags are recalculated for the next week's first day", () => {
    // 2 out Sun 22, next guest Mon 23 at 14:30. From Sun 10:00 the window is 1710 min (not tight);
    // from Mon 10:00 it is 270 min = the estimate → zero slack: tight, not at risk.
    const p = plan(
      [...turnover(7, '2026-11-22'), ...stay(2, '2026-11-22', '2026-11-23', '14:30')],
      headcountFor(week, 1),
    );

    expect(p.carriedOver).toEqual([
      expect.objectContaining({
        cottageNumber: 2,
        plannedDate: '2026-11-23',
        deferred: true,
        tight: true,
        atRisk: false,
      }),
    ]);
  });

  it('R5g: a carried task that departs on or after the first day of the week is rejected as invalid input', () => {
    const notCarried = deriveCleaningTasks(lastStay(4, '2026-11-24'), cottages, nextWeek, config);

    expect(() => plan([], headcountFor(nextWeek, 1), nextWeek, notCarried)).toThrow(
      /carried.*cottage 4 on 2026-11-24/,
    );
  });
});

describe('R5g — properties', () => {
  const key = (t: CleaningTask): string => `${String(t.cottageNumber)}@${t.departureDate}`;

  it('invariant 1 / R5g: over two chained weeks every task is staffed, in shortfall or carried over, exactly once', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.tuple(fc.array(bookingArb(), { maxLength: 40 }), weekArb).chain(([bookings, w]) => {
            const w2 = { start: addDays(w.start, 7) };
            return fc.tuple(
              fc.constant(bookings),
              fc.constant(w),
              headcountArb(w, 2, 1),
              fc.constant(w2),
              headcountArb(w2, 2, 1),
            );
          }),
          weekBoundaryTwoWeekScenarioArb, // Sunday overflow, carried tasks that cannot wait on Monday (R10b)
        ),
        ([bookings, w1, h1, w2, h2]) => {
          const tasks1 = deriveCleaningTasks(bookings, cottages, w1, config);
          const p1 = planWeek({ tasks: tasks1, headcount: h1, week: w1, config });
          const tasks2 = deriveCleaningTasks(bookings, cottages, w2, config);
          const p2 = planWeek({
            tasks: tasks2,
            headcount: h2,
            week: w2,
            config,
            carriedOver: p1.carriedOver,
          });

          for (const [input, p, h] of [
            [tasks1, p1, h1],
            [[...tasks2, ...p1.carriedOver], p2, h2],
          ] as const) {
            const placed = [...p.tasks, ...p.shortfall.map((s) => s.task), ...p.carriedOver];
            expect(placed.map(key).sort()).toEqual(input.map(key).sort());
            for (const { date, regular, reserve } of h) {
              const used = p.tasks
                .filter((t) => t.plannedDate === date)
                .reduce((sum, t) => sum + t.requiredCrewSize, 0);
              expect(used).toBeLessThanOrEqual(regular + reserve);
              expect(p.days.find((d) => d.date === date)?.reserveCalls).toBeLessThanOrEqual(
                reserve,
              );
            }
            for (const t of p.carriedOver) {
              expect(t.deferred).toBe(true);
              expect(t.plannedDate > t.departureDate).toBe(true);
            }
          }
        },
      ),
    );
  });
});
