import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { Booking, CleaningTask, Housekeeper, WeekSchedule } from './index.js';
import { addDays, daysOf, deriveCleaningTasks, localDate, scheduleWeek } from './index.js';
import {
  availableAllWeek,
  housekeeper,
  mondayTeamWeekArb,
  reserveFallbackWeekArb,
  reserveLimitWeekArb,
  seedConfig,
  seedCottages,
  stay,
  teamWeekScenarioArb,
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

  it('R9a: the same week with a reserve R available → R cleans Sunday’s cottage 7 (it cannot wait); no shortfall', () => {
    const s = schedule(
      [...mondayToSaturday(), ...turnover(7, SUN)],
      [housekeeper('A'), housekeeper('R', { reserve: true })],
    );

    expect(
      s.assignments
        .filter((a) => a.task.plannedDate === SUN)
        .map((a) => [a.task.cottageNumber, a.housekeeperIds]),
    ).toEqual([[7, ['R']]]);
    expect(s.days.find((d) => d.date === SUN)).toMatchObject({
      regular: 1,
      reserve: 1,
      reserveCalls: 1,
    });
    expect(s.shortfall).toEqual([]);
  });

  it('R9a: a reserve with 6 shifts is not called again — no regulars, R the only reserve, a turnover every day → Sunday’s cottage 7 is WEEKLY_LIMIT', () => {
    const s = schedule(
      [...mondayToSaturday(), ...turnover(7, SUN)],
      [housekeeper('R', { reserve: true })],
    );

    expect(s.assignments.map((a) => [a.task.cottageNumber, a.housekeeperIds])).toEqual(
      [1, 2, 3, 4, 5, 6].map((c) => [c, ['R']]),
    );
    expect(s.shortfall.map((x) => [x.task.cottageNumber, x.reason])).toEqual([[7, 'WEEKLY_LIMIT']]);
    expect(s.days.find((d) => d.date === SUN)).toMatchObject({ reserve: 1, reserveCalls: 0 });
  });

  it('R9a: in a week from Tuesday, a task that can wait and loses its regular place on the last day (Monday) is WEEKLY_LIMIT — the free reserve is not called', () => {
    // Week Tue 17 – Mon 23 Nov 2026. A, the only regular, cleans 1–6 Tuesday to Sunday (all turnovers) → 6 shifts.
    // Monday: cottage 7 is next let Tuesday 24 at 16:00 → it can wait (10:00 + 270 = 14:30 ≤ 16:00), so day
    // planning gives it A's place, R11 leaves that place unfilled, and R stays home (ADR 0004 trade-off).
    const tuesdayWeek = { start: localDate('2026-11-17') };
    const tueToSun = daysOf(tuesdayWeek).slice(0, 6).map(String);
    const monday = addDays(tuesdayWeek.start, 6);
    const team = [housekeeper('A'), housekeeper('R', { reserve: true })];
    const s = scheduleWeek({
      tasks: deriveCleaningTasks(
        [
          ...[1, 2, 3, 4, 5, 6].flatMap((c, d) => turnover(c, tueToSun[d] ?? '')),
          ...stay(7, monday, '2026-11-24'),
        ],
        cottages,
        tuesdayWeek,
        config,
      ),
      housekeepers: team,
      availability: availableAllWeek(tuesdayWeek, ['A', 'R']),
      week: tuesdayWeek,
      config,
    });

    expect(s.assignments.map((a) => [a.task.cottageNumber, a.housekeeperIds])).toEqual(
      [1, 2, 3, 4, 5, 6].map((c) => [c, ['A']]),
    );
    expect(s.shortfall.map((x) => [x.task.cottageNumber, x.reason])).toEqual([[7, 'WEEKLY_LIMIT']]);
    expect(s.days.find((d) => d.date === monday)).toMatchObject({
      regular: 1,
      reserve: 1,
      reserveCalls: 0,
    });
  });
});

describe('R10b — which reserve is called', () => {
  it('R10b: the reserve with the fewest shifts this week is called; on a tie the lowest id — R1, R2, R1 Monday to Wednesday', () => {
    const s = schedule(
      [1, 2, 3].flatMap((c, d) => turnover(c, days[d] ?? '')),
      [housekeeper('R1', { reserve: true }), housekeeper('R2', { reserve: true })],
    );

    expect(s.assignments.map((a) => [a.task.plannedDate, a.housekeeperIds])).toEqual([
      [days[0], ['R1']],
      [days[1], ['R2']],
      [days[2], ['R1']],
    ]);
  });

  it('R10b: six same-day turnovers on Monday and five regulars → only the reserve’s assignment (cottage 6) has needsReserveCall', () => {
    // All six have arrivals Monday 16:00 → none can wait; R5d ties by cottage number, so 6 is last and needs R.
    const s = schedule(
      [1, 2, 3, 4, 5, 6].flatMap((c) => turnover(c, days[0] ?? '')),
      [
        ...['A', 'B', 'C', 'D', 'E'].map((id) => housekeeper(id)),
        housekeeper('R', { reserve: true }),
      ],
    );

    expect(
      s.assignments
        .map((a) => [a.task.cottageNumber, a.needsReserveCall])
        .sort(([x], [y]) => Number(x) - Number(y)),
    ).toEqual([
      [1, false],
      [2, false],
      [3, false],
      [4, false],
      [5, false],
      [6, true],
    ]);
    expect(s.assignments.find((a) => a.task.cottageNumber === 6)?.housekeeperIds).toEqual(['R']);
  });
});

describe('R10b — properties', () => {
  it('invariant 26 / R10b: needsReserveCall ⇔ the crew includes a reserve; a day’s reserveCalls counts those assignments', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          teamWeekScenarioArb,
          mondayTeamWeekArb,
          reserveLimitWeekArb,
          reserveFallbackWeekArb,
        ),
        ({ week: w, housekeepers, availability, bookings }) => {
          const s = scheduleWeek({
            tasks: deriveCleaningTasks(bookings, cottages, w, config),
            housekeepers,
            availability,
            week: w,
            config,
          });
          const reserves = new Set(housekeepers.filter((h) => h.reserve).map((h) => h.id));
          for (const a of s.assignments) {
            expect(
              a.needsReserveCall,
              `cottage ${String(a.task.cottageNumber)} on ${a.task.plannedDate}`,
            ).toBe(a.housekeeperIds.some((id) => reserves.has(id)));
          }
          for (const d of s.days) {
            expect(
              s.assignments.filter((a) => a.task.plannedDate === d.date && a.needsReserveCall)
                .length,
              d.date,
            ).toBe(d.reserveCalls);
          }
        },
      ),
    );
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

  it('invariant 20 / R9a: nobody has more than 6 shifts; on a WEEKLY_LIMIT day every free available regular has 6, and so does every free available reserve if the task cannot wait', () => {
    fc.assert(
      fc.property(
        fc.oneof(teamWeekScenarioArb, mondayTeamWeekArb, reserveLimitWeekArb),
        ({ week: w, housekeepers, availability, bookings }) => {
          const s = scheduleWeek({
            tasks: deriveCleaningTasks(bookings, cottages, w, config),
            housekeepers,
            availability,
            week: w,
            config,
          });
          const shifts = (id: string): number =>
            s.assignments.filter((a) => a.housekeeperIds.includes(id)).length;
          for (const h of housekeepers) expect(shifts(h.id), h.id).toBeLessThanOrEqual(6);

          const isAvailable = new Set(
            availability.filter((a) => a.available).map((a) => `${a.housekeeperId} ${a.date}`),
          );
          for (const { task } of s.shortfall.filter((x) => x.reason === 'WEEKLY_LIMIT')) {
            const day = task.plannedDate;
            const working = new Set(
              s.assignments
                .filter((a) => a.task.plannedDate === day)
                .flatMap((a) => a.housekeeperIds),
            );
            const free = housekeepers.filter(
              (h) => h.active && isAvailable.has(`${h.id} ${day}`) && !working.has(h.id),
            );
            for (const h of free.filter((x) => !x.reserve))
              expect(shifts(h.id), `${h.id} on ${day}`).toBe(6);
            if (!fitsOn(task, addDays(day, 1))) {
              for (const h of free.filter((x) => x.reserve))
                expect(shifts(h.id), `${h.id} on ${day}`).toBe(6);
            }
          }

          // Invariant 1 still holds after assignment: no day staffs more than its headcount, and reserveCalls counts
          // exactly the tasks a reserve cleans that day.
          const reserves = new Set(housekeepers.filter((h) => h.reserve).map((h) => h.id));
          for (const d of s.days) {
            const today = s.assignments.filter((a) => a.task.plannedDate === d.date);
            expect(today.reduce((n, a) => n + a.task.requiredCrewSize, 0)).toBeLessThanOrEqual(
              d.regular + d.reserve,
            );
            expect(
              today.filter((a) => a.housekeeperIds.some((id) => reserves.has(id))).length,
            ).toBe(d.reserveCalls);
            expect(d.reserveCalls).toBeLessThanOrEqual(d.reserve);
          }
        },
      ),
    );
  });
});
