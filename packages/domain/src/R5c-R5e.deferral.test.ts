import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { Booking, CleaningTask, Headcount, PlanningWeek, WeekPlan } from './index.js';
import { addDays, deriveCleaningTasks, localDate, planWeek } from './index.js';
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
const shortOf = (p: WeekPlan) =>
  p.shortfall.map((s) => [s.task.cottageNumber, s.reason, s.lastPossibleDate]);

describe('R5c — deferral', () => {
  it('R5c: a deferred task keeps departureDate and earliestStart, has plannedDate > departureDate and deferred = true', () => {
    // Tue: one housekeeper; 5 has a same-day arrival, 2 is next let on Thursday.
    const p = plan(
      [...turnover(5, '2026-11-17'), ...stay(2, '2026-11-17', '2026-11-19')],
      headcountFor(week, 1),
    );

    expect(onDay(p, '2026-11-17')).toEqual([5]);
    expect(taskOf(p, 5)).toMatchObject({ plannedDate: '2026-11-17', deferred: false });
    expect(taskOf(p, 2)).toMatchObject({
      departureDate: '2026-11-17',
      earliestStart: '2026-11-17T10:00',
      plannedDate: '2026-11-18',
      deferred: true,
      tight: false,
      atRisk: false,
    });
    expect(p.shortfall).toEqual([]);
  });

  it('R5c: a task that cannot be finished on the next day before its deadline goes to shortfall instead of being deferred', () => {
    // 2 out Tue, next guest Wed with check-in 13:00: Wed 10:00 + 270 min = 14:30 > 13:00.
    const p = plan(
      [...turnover(5, '2026-11-17'), ...stay(2, '2026-11-17', '2026-11-18', '13:00')],
      headcountFor(week, 1),
    );

    expect(onDay(p, '2026-11-17')).toEqual([5]);
    expect(onDay(p, '2026-11-18')).toEqual([]);
    expect(shortOf(p)).toEqual([[2, 'NO_STAFF', '2026-11-17']]);
  });

  it('R5c: the arrival day counts when workdayStart + estimate fits before check-in (stable, 14:30 ≤ 16:00)', () => {
    const p = plan(
      [...turnover(5, '2026-11-17'), ...stay(2, '2026-11-17', '2026-11-18')],
      headcountFor(week, 1),
    );

    expect(taskOf(p, 2)).toMatchObject({ plannedDate: '2026-11-18', deferred: true, tight: false });
  });

  it('R5c: premium with early check-in 14:00 is not deferred onto its arrival day and goes to shortfall', () => {
    // Wed 10:00 + 300 min = 15:00 > 14:00.
    const p = plan(
      [...turnover(5, '2026-11-17'), ...stay(11, '2026-11-17', '2026-11-18', '14:00')],
      headcountFor(week, 1),
    );

    expect(taskOf(p, 11)).toBeUndefined();
    expect(shortOf(p)).toEqual([[11, 'NO_STAFF', '2026-11-17']]);
  });

  it('R5c: premium with check-in 15:00 deferred onto its arrival day is tight but not at risk', () => {
    // Wed 10:00 + 300 min = 15:00 = check-in: zero slack.
    const p = plan(
      [...turnover(5, '2026-11-17'), ...stay(11, '2026-11-17', '2026-11-18', '15:00')],
      headcountFor(week, 1),
    );

    expect(taskOf(p, 11)).toMatchObject({
      plannedDate: '2026-11-18',
      deferred: true,
      tight: true,
      atRisk: false,
    });
  });

  it('R5c: a task without a deadline waits until a day with a free housekeeper', () => {
    // Mon: the only housekeeper takes 5 (same-day arrival); Tue: nobody; Wed: one free.
    const p = plan(
      [...turnover(5, '2026-11-16'), ...lastStay(4, '2026-11-16')],
      headcountFor(week, 1, { '2026-11-17': 0 }),
    );

    expect(onDay(p, '2026-11-16')).toEqual([5]);
    expect(taskOf(p, 4)).toMatchObject({
      departureDate: '2026-11-16',
      plannedDate: '2026-11-18',
      deferred: true,
    });
  });
});

describe('R5d — priority', () => {
  it('R5d: on Sunday the only free housekeeper goes to the cottage with a same-day arrival (7), not the lowest number (2)', () => {
    const p = plan(
      [
        ...lastStay(2, '2026-11-22'),
        ...lastStay(4, '2026-11-22'),
        ...turnover(7, '2026-11-22'),
        ...lastStay(8, '2026-11-22'),
      ],
      headcountFor(week, 1),
    );

    expect(onDay(p, '2026-11-22')).toEqual([7]);
  });

  it('R5d: on a short day the tasks that can wait longest move first; on a tie the higher cottage number moves', () => {
    // Mon, one housekeeper: 8 and 9 next let Wed (tie), 1 next let Thu, 3 no next arrival.
    const bookings = [
      ...stay(9, '2026-11-16', '2026-11-18'),
      ...lastStay(3, '2026-11-16'),
      ...stay(1, '2026-11-16', '2026-11-19'),
      ...stay(8, '2026-11-16', '2026-11-18'),
    ];
    const headcount = headcountFor(week, 3, { '2026-11-16': 1 });
    const p = plan(bookings, headcount);

    expect(onDay(p, '2026-11-16')).toEqual([8]);
    expect(onDay(p, '2026-11-17').sort((a, b) => a - b)).toEqual([1, 3, 9]);
    expect(plan([...bookings].reverse(), headcount)).toEqual(p);
  });
});

describe('R5e — deferred tasks on the new day', () => {
  it('R5e: a same-day arrival wins the last housekeeper over a deferred task, which moves on', () => {
    // Mon: 1 (same-day) takes the only housekeeper, 3 (next let Wed 16:00) is deferred to Tue.
    // Tue: 6 departs with a same-day arrival → 6 is staffed, 3 moves to Wed (10:00 + 270 = 14:30 ≤ 16:00).
    const p = plan(
      [
        ...turnover(1, '2026-11-16'),
        ...stay(3, '2026-11-16', '2026-11-18'),
        ...turnover(6, '2026-11-17'),
      ],
      headcountFor(week, 1),
    );

    expect(onDay(p, '2026-11-16')).toEqual([1]);
    expect(onDay(p, '2026-11-17')).toEqual([6]);
    expect(taskOf(p, 3)).toMatchObject({ plannedDate: '2026-11-18', deferred: true });
  });
});

describe('R5c–R5e — properties', () => {
  const run = (bookings: readonly Booking[], w: PlanningWeek, headcount: Headcount[]) => {
    const tasks = deriveCleaningTasks(bookings, cottages, w, config);
    return { tasks, p: planWeek({ tasks, headcount, week: w, config }) };
  };
  const key = (t: CleaningTask): string => `${String(t.cottageNumber)}@${t.departureDate}`;
  const windowStart = (t: CleaningTask): string =>
    t.deferred ? `${t.plannedDate}T${config.workdayStart}` : t.earliestStart;
  /** Test oracle, independent of the domain's arithmetic. */
  const minutes = (from: string, to: string): number =>
    (Date.parse(`${to}:00Z`) - Date.parse(`${from}:00Z`)) / 60_000;

  it('invariant 8 / R5c: no deferred task is planned past its deadline; a staffed task that cannot meet it is at risk', () => {
    fc.assert(
      fc.property(planningScenarioArb, ([bookings, w, headcount]) => {
        for (const t of run(bookings, w, headcount).p.tasks) {
          if (t.deadline === undefined) continue;
          const fits = minutes(windowStart(t), t.deadline) >= t.estimatedMinutes;
          if (t.deferred) expect(fits).toBe(true);
          else if (!fits) expect(t.atRisk).toBe(true);
        }
      }),
    );
  });

  it('invariant 9 / R5c: a task is deferred only past full days or weekend days it could wait through, never with a same-day arrival', () => {
    fc.assert(
      fc.property(planningScenarioArb, ([bookings, w, headcount]) => {
        const { p } = run(bookings, w, headcount);
        const availableOn = new Map(headcount.map((h) => [h.date, h.available]));
        // Carried-over tasks (R5g) are deferred too: every day from departure to the week's last day.
        for (const t of [...p.tasks, ...p.carriedOver].filter((x) => x.deferred)) {
          expect(t.deadline?.slice(0, 10)).not.toBe(t.departureDate);
          for (let d = t.departureDate; d < t.plannedDate; d = addDays(d, 1)) {
            const used = p.tasks
              .filter((x) => x.plannedDate === d)
              .reduce((sum, x) => sum + x.requiredCrewSize, 0);
            const full = used + t.requiredCrewSize > (availableOn.get(d) ?? 0);
            const weekendWait = isWeekendDay(d) && canWaitUntilMonday(t, d, config); // R5f
            expect(full || weekendWait).toBe(true);
          }
        }
      }),
    );
  });

  it('invariant 14 / R5c: at risk ⇔ deadline − windowStart < estimate; a deferred task is never at risk', () => {
    fc.assert(
      fc.property(planningScenarioArb, ([bookings, w, headcount]) => {
        const { p } = run(bookings, w, headcount);
        // Carried-over tasks (R5g) are deferred to the next week's first day: same rule.
        for (const t of [...p.tasks, ...p.carriedOver]) {
          const window = t.deadline === undefined ? undefined : minutes(windowStart(t), t.deadline);
          expect(t.atRisk).toBe(window !== undefined && window < t.estimatedMinutes);
          expect(t.tight).toBe(window !== undefined && window - t.estimatedMinutes <= 0);
          if (t.deferred) expect(t.atRisk).toBe(false);
        }
      }),
    );
  });

  it('invariant 15 / R5c: deferred ⇔ plannedDate > departureDate; departureDate and earliestStart never change', () => {
    fc.assert(
      fc.property(planningScenarioArb, ([bookings, w, headcount]) => {
        const { tasks, p } = run(bookings, w, headcount);
        const original = new Map(tasks.map((t) => [key(t), t]));
        for (const t of p.tasks) {
          expect(t.deferred).toBe(t.plannedDate > t.departureDate);
          expect(t.plannedDate >= t.departureDate).toBe(true);
          expect(t.earliestStart).toBe(original.get(key(t))?.earliestStart);
        }
      }),
    );
  });

  it('invariant 7 / R5d: the same tasks in any order give the same plan', () => {
    fc.assert(
      fc.property(
        planningScenarioArb.chain(([bookings, w, headcount]) =>
          fc.tuple(
            fc.constant(bookings),
            fc.constant(w),
            fc.constant(headcount),
            fc.shuffledSubarray(deriveCleaningTasks(bookings, cottages, w, config), {
              minLength: deriveCleaningTasks(bookings, cottages, w, config).length,
            }),
          ),
        ),
        ([bookings, w, headcount, shuffled]) => {
          const { p } = run(bookings, w, headcount);
          expect(planWeek({ tasks: shuffled, headcount, week: w, config })).toEqual(p);
        },
      ),
    );
  });
});
