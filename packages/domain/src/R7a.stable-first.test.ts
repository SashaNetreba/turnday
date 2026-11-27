import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { Booking, CleaningTask, Housekeeper, WeekSchedule } from './index.js';
import { addDays, deriveCleaningTasks, localDate, scheduleWeek } from './index.js';
import {
  availableAllWeek,
  deferrableFallbackWeekArb,
  departure,
  housekeeper,
  mondayTeamWeekArb,
  reserveFallbackWeekArb,
  reserveLimitWeekArb,
  seedConfig,
  seedCottages,
  stableFirstTeamWeekArb,
  teamWeekScenarioArb,
  type TeamWeekScenario,
} from './test-fixtures.js';

const cottages = seedCottages(); // 1–10 STABLE; 11, 12, 15 PREMIUM
const config = seedConfig(); // workdayStart 10:00, STABLE 270, PREMIUM 300, check-in 16:00
const week = { start: localDate('2026-12-07') }; // Mon 7 – Sun 13 Dec 2026
const MON = '2026-12-07';
const TUE = '2026-12-08';
const WED = '2026-12-09';
const THU = '2026-12-10';
const FRI = '2026-12-11';

/** Out on `out` with the next guest arriving the same day (16:00, or `checkin`): cannot wait. */
const turnover = (cottage: number, out: string, checkin?: string): Booking[] =>
  departure(cottage, out, out, checkin);

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

/** Who cleans which cottage on `date`: `{ housekeeperId: cottageNumber }`. */
function cottagesOn(s: WeekSchedule, date: string): Record<string, number> {
  const byPerson: Record<string, number> = {};
  for (const a of s.assignments.filter((x) => x.task.plannedDate === date))
    for (const id of a.housekeeperIds) byPerson[id] = a.task.cottageNumber;
  return byPerson;
}

describe('R7a — stable first', () => {
  it('R7a: 11, 12, 15 out Monday with arrivals today; stableFirst A, regulars B and C → B 11, C 12, A 15; no reserve call', () => {
    const s = schedule(
      [...turnover(11, MON), ...turnover(12, MON), ...turnover(15, MON)],
      [
        housekeeper('A', { stableFirst: true }),
        housekeeper('B'),
        housekeeper('C'),
        housekeeper('R', { reserve: true }),
      ],
    );

    expect(cottagesOn(s, MON)).toEqual({ B: 11, C: 12, A: 15 });
    expect(s.days.find((d) => d.date === MON)?.reserveCalls).toBe(0);
  });

  it('R7a: stable 3 and premium 11 out Monday, both with arrivals today; stableFirst A, regular B → A 3, B 11', () => {
    // 11's check-in is 15:30 (10:00 + 300 = 15:00 fits), so R5d puts 11 before 3 — the flag, not R5d, gives A cottage 3.
    const s = schedule(
      [...turnover(3, MON), ...turnover(11, MON, '15:30')],
      [housekeeper('A', { stableFirst: true }), housekeeper('B')],
    );

    expect(cottagesOn(s, MON)).toEqual({ A: 3, B: 11 });
  });

  it('R7a: 3 (arrival today), 5 (next arrival Tuesday) and 11 (arrival today 15:30) out Monday; stableFirst A, regular B → 5 deferred to Tuesday, A 3, B 11; no reserve call', () => {
    const s = schedule(
      [...turnover(3, MON), ...departure(5, MON, TUE), ...turnover(11, MON, '15:30')],
      [
        housekeeper('A', { stableFirst: true }),
        housekeeper('B'),
        housekeeper('R', { reserve: true }),
      ],
    );

    expect(cottagesOn(s, MON)).toEqual({ A: 3, B: 11 });
    expect(s.tasks.find((t) => t.cottageNumber === 5)?.plannedDate).toBe(TUE);
    expect(s.days.find((d) => d.date === MON)?.reserveCalls).toBe(0);
  });

  it('R7a: stable 4 (next arrival Wednesday), 6 (no next arrival) and 8 (next arrival Thursday) out Monday; stableFirst A, regulars B and C → A 6, then B 4, C 8 by R5d order and lowest id', () => {
    const s = schedule(
      [...departure(4, MON, WED), ...departure(6, MON), ...departure(8, MON, THU)],
      [housekeeper('A', { stableFirst: true }), housekeeper('B'), housekeeper('C')],
    );

    expect(cottagesOn(s, MON)).toEqual({ A: 6, B: 4, C: 8 });
  });

  it('R7a: stable 2 (check-in 15:00), 7 and 9 (16:00) all with arrivals today; stableFirst A, regulars B and C → A 7 (latest deadline, lowest cottage on the tie), B 2, C 9', () => {
    const s = schedule(
      [...turnover(2, MON, '15:00'), ...turnover(7, MON), ...turnover(9, MON)],
      [housekeeper('A', { stableFirst: true }), housekeeper('B'), housekeeper('C')],
    );

    expect(cottagesOn(s, MON)).toEqual({ A: 7, B: 2, C: 9 });
  });

  it('R7a: premium fairness — A and B, no flags; Monday 3 and 11, Tuesday 4 and 12, all with arrivals that day → Monday A 11, B 3; Tuesday B 12 (0 premium vs 1), A 4', () => {
    const s = schedule(
      [...turnover(3, MON), ...turnover(11, MON), ...turnover(4, TUE), ...turnover(12, TUE)],
      [housekeeper('A'), housekeeper('B')],
    );

    expect(cottagesOn(s, MON)).toEqual({ A: 11, B: 3 });
    expect(cottagesOn(s, TUE)).toEqual({ A: 4, B: 12 });
  });

  it('R7a: two stableFirst — S1 with 2 shifts before Wednesday, S2 with 1; Wednesday stable 3 and premium 11 → S2 (fewest shifts) takes 11, S1 gets 3', () => {
    // Monday only S1 is available (cottage 1); Tuesday both work (2 and 4). 11's check-in is 15:30, so R5d puts it
    // first and the id-order placeholder would give it to S1.
    const s = schedule(
      [
        ...turnover(1, MON),
        ...turnover(2, TUE),
        ...turnover(4, TUE),
        ...turnover(3, WED),
        ...turnover(11, WED, '15:30'),
      ],
      [housekeeper('S1', { stableFirst: true }), housekeeper('S2', { stableFirst: true })],
      { S2: [MON] },
    );

    expect(cottagesOn(s, WED)).toEqual({ S1: 3, S2: 11 });
  });

  it('R7a: two stableFirst with equal shifts (0); stable 3 and premium 11 out Monday → the lowest id (A) takes 11, B gets 3', () => {
    const s = schedule(
      [...turnover(3, MON), ...turnover(11, MON)],
      [housekeeper('A', { stableFirst: true }), housekeeper('B', { stableFirst: true })],
    );

    expect(cottagesOn(s, MON)).toEqual({ A: 11, B: 3 });
  });

  it('R7a: leftover premium — stableFirst S1 (1 shift before Tuesday) and S2 (0); Tuesday only 11 (check-in 15:30) and 12 → S2 (fewest shifts) takes 11, first in R5d order; S1 takes 12', () => {
    const s = schedule(
      [...turnover(1, MON), ...turnover(11, TUE, '15:30'), ...turnover(12, TUE)],
      [housekeeper('S1', { stableFirst: true }), housekeeper('S2', { stableFirst: true })],
      { S2: [MON] },
    );

    expect(cottagesOn(s, TUE)).toEqual({ S1: 12, S2: 11 });
  });

  it('R7a: three stable and one premium for four stableFirst — S4 (0 shifts) takes premium 11; S1 and S2 (2 shifts each) choose first, lowest id on the tie: S1 6 (no next arrival), S2 4 (next arrival Friday), S3 (1 shift) 2', () => {
    // Monday S1, S2 work (1, 3); Tuesday S1, S2, S3 work (5, 7, 8); S4 is off both days. Every place is forced by
    // availability (R11), so before Wednesday: S1 2, S2 2, S3 1, S4 0.
    const s = schedule(
      [
        ...turnover(1, MON),
        ...turnover(3, MON),
        ...turnover(5, TUE),
        ...turnover(7, TUE),
        ...turnover(8, TUE),
        ...departure(6, WED),
        ...departure(4, WED, FRI),
        ...turnover(2, WED),
        ...turnover(11, WED),
      ],
      ['S1', 'S2', 'S3', 'S4'].map((id) => housekeeper(id, { stableFirst: true })),
      { S3: [MON], S4: [MON, TUE] },
    );

    expect(cottagesOn(s, WED)).toEqual({ S1: 6, S2: 4, S3: 2, S4: 11 });
  });

  it('R7a: S (stableFirst) the only regular, reserve R; Monday 11 (arrival 15:30) and 3 (arrival 16:00), neither can wait → swap: S cleans 3, R cleans 11 and still needs the call', () => {
    // By R5d 11 (15:30) takes S's regular place and 3 needs the reserve; both cannot wait, so they swap.
    const s = schedule(
      [...turnover(11, MON, '15:30'), ...turnover(3, MON)],
      [housekeeper('S', { stableFirst: true }), housekeeper('R', { reserve: true })],
    );

    expect(cottagesOn(s, MON)).toEqual({ S: 3, R: 11 });
    expect(s.assignments.find((a) => a.task.cottageNumber === 11)?.needsReserveCall).toBe(true);
    expect(s.assignments.find((a) => a.task.cottageNumber === 3)?.needsReserveCall).toBe(false);
    expect(s.days.find((d) => d.date === MON)?.reserveCalls).toBe(1);
  });
});

describe('R7a — properties', () => {
  function scheduleOf({ week: w, housekeepers, availability, bookings }: TeamWeekScenario) {
    return scheduleWeek({
      tasks: deriveCleaningTasks(bookings, cottages, w, config),
      housekeepers,
      availability,
      week: w,
      config,
    });
  }

  /** R5c test oracle: the task can still be finished on `day`. */
  const fitsOn = (t: CleaningTask, day: string): boolean =>
    t.deadline === undefined ||
    (Date.parse(`${t.deadline}:00Z`) - Date.parse(`${day}T${config.workdayStart}:00Z`)) / 60_000 >=
      t.estimatedMinutes;
  const cannotWait = (t: CleaningTask): boolean => !fitsOn(t, addDays(t.plannedDate, 1));

  /** R7a stable order: < 0 when `a` comes first — latest deadline first, no deadline latest; then lowest cottage. */
  const stableOrder = (a: CleaningTask, b: CleaningTask): number => {
    const da = a.deadline ?? '9999';
    const db = b.deadline ?? '9999';
    if (da !== db) return da > db ? -1 : 1;
    return a.cottageNumber - b.cottageNumber;
  };

  it('invariant 24 / R7a: stableFirst gets premium only when every regular-staffed stable task is with a stableFirst; no other regular has a better stable task; no reserve has a stable task that cannot wait while a stableFirst has a premium one that cannot wait', () => {
    fc.assert(
      fc.property(stableFirstTeamWeekArb, (scenario) => {
        const s = scheduleOf(scenario);
        const byId = new Map(scenario.housekeepers.map((h) => [h.id, h]));
        const kind = (id: string) =>
          byId.get(id)?.reserve ? 'reserve' : byId.get(id)?.stableFirst ? 'stableFirst' : 'other';

        for (const d of s.days) {
          const today = s.assignments
            .filter((a) => a.task.plannedDate === d.date)
            .flatMap((a) => a.housekeeperIds.map((id) => ({ id, task: a.task, kind: kind(id) })));
          const at = (k: string, type: string) =>
            today.filter((x) => x.kind === k && x.task.cottageType === type);
          const ctx = `on ${d.date}`;

          if (at('stableFirst', 'PREMIUM').length > 0) {
            expect(at('other', 'STABLE'), `(a) ${ctx}`).toEqual([]);
          }
          for (const sf of at('stableFirst', 'STABLE'))
            for (const o of at('other', 'STABLE'))
              expect(
                stableOrder(o.task, sf.task) < 0,
                `(b) ${ctx}: ${o.id} has ${String(o.task.cottageNumber)}, ${sf.id} has ${String(sf.task.cottageNumber)}`,
              ).toBe(false);
          if (at('stableFirst', 'PREMIUM').some((x) => cannotWait(x.task))) {
            expect(
              at('reserve', 'STABLE').filter((x) => cannotWait(x.task)),
              `(c) ${ctx}`,
            ).toEqual([]);
          }
        }
      }),
    );
  });

  it('invariant 17 / R10b / R7a: after assignment (R9a fallback, R7a swap) every assignment with needsReserveCall cleans a task that cannot wait on its planned day', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          stableFirstTeamWeekArb,
          teamWeekScenarioArb,
          mondayTeamWeekArb,
          reserveLimitWeekArb,
          reserveFallbackWeekArb,
          deferrableFallbackWeekArb,
        ),
        (scenario) => {
          const s = scheduleOf(scenario);
          for (const a of s.assignments.filter((x) => x.needsReserveCall)) {
            expect(
              cannotWait(a.task),
              `cottage ${String(a.task.cottageNumber)} on ${a.task.plannedDate}`,
            ).toBe(true);
          }
        },
      ),
    );
  });

  it('invariant 18 / R7a / R11: stableFirst flags change only which cottage each working housekeeper cleans — not what is staffed, deferred or short, nor who works each day', () => {
    fc.assert(
      fc.property(stableFirstTeamWeekArb, (scenario) => {
        const withFlags = scheduleOf(scenario);
        const without = scheduleOf({
          ...scenario,
          housekeepers: scenario.housekeepers.map((h) => ({ ...h, stableFirst: false })),
        });

        expect(withFlags.tasks).toEqual(without.tasks);
        expect(withFlags.shortfall).toEqual(without.shortfall);
        expect(withFlags.carriedOver).toEqual(without.carriedOver);
        expect(withFlags.days).toEqual(without.days);
        const workers = (s: WeekSchedule) =>
          s.days.map((d) =>
            s.assignments
              .filter((a) => a.task.plannedDate === d.date)
              .flatMap((a) => a.housekeeperIds)
              .sort(),
          );
        expect(workers(withFlags)).toEqual(workers(without));
      }),
    );
  });
});
