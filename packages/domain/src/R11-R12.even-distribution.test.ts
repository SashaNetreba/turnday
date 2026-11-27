import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { Booking, Housekeeper, PlanningWeek, WeekSchedule } from './index.js';
import {
  daysOf,
  deriveCleaningTasks,
  deriveHeadcount,
  localDate,
  planWeek,
  scheduleWeek,
} from './index.js';
import {
  availableAllWeek,
  dailyTurnovers,
  fullAvailabilityTeamWeekArb,
  housekeeper,
  reserveLimitWeekArb,
  seedConfig,
  seedCottages,
  smallTeamWeekArb,
  teamWeekScenarioArb,
  turnover,
  type TeamWeekScenario,
} from './test-fixtures.js';

const cottages = seedCottages();
const config = seedConfig(); // workdayStart 10:00, STABLE 270, PREMIUM 300, check-in 16:00
const week = { start: localDate('2026-11-16') }; // Mon 16 – Sun 22 Nov 2026
const [MON, TUE, WED, THU, FRI, SAT, SUN] = daysOf(week).map(String);

function schedule(
  bookings: readonly Booking[],
  housekeepers: readonly Housekeeper[],
  unavailable: Readonly<Record<string, readonly string[]>> = {},
  w: PlanningWeek = week,
): WeekSchedule {
  return scheduleWeek({
    tasks: deriveCleaningTasks(bookings, cottages, w, config),
    housekeepers,
    availability: availableAllWeek(
      w,
      housekeepers.map((h) => h.id),
      unavailable,
    ),
    week: w,
    config,
  });
}

/** Who works on `date`, sorted. */
const workingOn = (s: WeekSchedule, date: string | undefined): string[] =>
  s.assignments
    .filter((a) => a.task.plannedDate === date)
    .flatMap((a) => a.housekeeperIds)
    .sort();

/** Shifts per housekeeper id over the week (days with an assignment). */
function shiftsOf(s: WeekSchedule, ids: readonly string[], before?: string): number[] {
  return ids.map(
    (id) =>
      s.assignments.filter(
        (a) =>
          a.housekeeperIds.includes(id) && (before === undefined || a.task.plannedDate < before),
      ).length,
  );
}

describe('R11 / R12 — even distribution', () => {
  it('R11: A and B on Monday, only A on Tuesday, one place each day → Monday goes to B and Tuesday to A (1 vs 1)', () => {
    const s = schedule(
      [...turnover(3, MON ?? ''), ...turnover(5, TUE ?? '')],
      [housekeeper('A'), housekeeper('B')],
      { B: [TUE ?? ''] },
    );

    expect(workingOn(s, MON)).toEqual(['B']);
    expect(workingOn(s, TUE)).toEqual(['A']);
  });

  it('R11: the stableFirst housekeeper, off Monday and Tuesday, works Wednesday (0 shifts vs B’s 2) — the R7a example, only who works', () => {
    const s = schedule(
      [...turnover(1, MON ?? ''), ...turnover(2, TUE ?? ''), ...turnover(11, WED ?? '')],
      [housekeeper('S', { stableFirst: true }), housekeeper('B')],
      { S: [MON ?? '', TUE ?? ''] },
    );

    expect(workingOn(s, MON)).toEqual(['B']);
    expect(workingOn(s, TUE)).toEqual(['B']);
    expect(workingOn(s, WED)).toEqual(['S']);
  });

  it('R11: on a tie in shifts, the one whose last shift was longest ago works — B (Monday) before A (Tuesday) on Wednesday', () => {
    // Mon only B, Tue only A, Wed both; one place each day. Bounds L = 1, U = 2 allow either on Wednesday, both
    // have 1 shift; B's last shift (Monday) is longer ago than A's (Tuesday). Lowest id alone would pick A.
    const s = schedule(
      [...turnover(1, MON ?? ''), ...turnover(2, TUE ?? ''), ...turnover(3, WED ?? '')],
      [housekeeper('A'), housekeeper('B')],
      { A: [MON ?? ''], B: [TUE ?? ''] },
    );

    expect(workingOn(s, MON)).toEqual(['B']);
    expect(workingOn(s, TUE)).toEqual(['A']);
    expect(workingOn(s, WED)).toEqual(['B']);
  });

  it('R12: on Sunday A has 4 shifts and B 3, both are available and the bounds allow either → B works Sunday', () => {
    // Places Mon–Sun 3, 3, 1, 2, 2, 2, 1. Availability makes Mon–Sat exact: A Mon Tue Thu Fri (4), B Mon Tue Sat (3),
    // D Mon Tue Thu Fri Sat (5). D's 5 forces U ≥ 5; C and E share Wednesday's single place, so one of them gets 0
    // and L = 0. Bounds L = 0, U = 5 allow A (→ 5) or B (→ 4) on Sunday; fewest shifts first gives it to B.
    const s = schedule(
      dailyTurnovers(week, [3, 3, 1, 2, 2, 2, 1]),
      ['A', 'B', 'C', 'D', 'E'].map((id) => housekeeper(id)),
      {
        A: [WED ?? '', SAT ?? ''],
        B: [WED ?? '', THU ?? '', FRI ?? ''],
        C: [MON ?? '', TUE ?? '', THU ?? '', FRI ?? '', SAT ?? '', SUN ?? ''],
        D: [WED ?? '', SUN ?? ''],
        E: [MON ?? '', TUE ?? '', THU ?? '', FRI ?? '', SAT ?? '', SUN ?? ''],
      },
    );

    expect(shiftsOf(s, ['A', 'B'], SUN)).toEqual([4, 3]);
    expect(workingOn(s, SUN)).toEqual(['B']);
  });
});

// ---- Brute-force oracle for invariant 21, independent of max-flow ----

/**
 * The smallest spread U − L (R11, domain-model v0.6) that `counts` satisfy: every regular p works at least
 * min(L, placeDays[p]) and at most min(U, 6) shifts. Ties don't matter here — only the spread's value is compared.
 */
function spreadOf(counts: readonly number[], placeDays: readonly number[]): number {
  for (let spread = 0; spread <= 7; spread++) {
    for (let low = 7; low >= 0; low--) {
      const fits = counts.every(
        (c, p) => c >= Math.min(low, placeDays[p] ?? 0) && c <= Math.min(low + spread, 6),
      );
      if (fits) return spread;
    }
  }
  return Infinity;
}

/**
 * Every way to fill the week: day by day, every subset of the regulars available that day with at most that day's
 * places; keeps only the per-person shift counts (≤ 6 each, R9a). Returns the largest staffed total and, for it,
 * the smallest spread.
 */
function bruteForce(
  places: readonly number[],
  available: readonly (readonly boolean[])[], // [person][day]
): { staffed: number; spread: number } {
  const n = available.length;
  const placeDays = available.map(
    (days) => days.filter((a, d) => a && (places[d] ?? 0) > 0).length,
  );
  let states = new Map<string, number[]>([[Array(n).fill(0).join(','), Array<number>(n).fill(0)]]);
  places.forEach((cap, d) => {
    const next = new Map<string, number[]>();
    for (const counts of states.values()) {
      for (let mask = 0; mask < 1 << n; mask++) {
        const chosen = [...Array(n).keys()].filter((p) => (mask >> p) & 1);
        if (chosen.length > cap || chosen.some((p) => available[p]?.[d] !== true)) continue;
        const after = counts.map((c, p) => (chosen.includes(p) ? c + 1 : c));
        if (after.some((c) => c > 6)) continue;
        next.set(after.join(','), after);
      }
    }
    states = next;
  });
  const finals = [...states.values()];
  const staffed = Math.max(...finals.map((c) => c.reduce((a, b) => a + b, 0)));
  const spread = Math.min(
    ...finals
      .filter((c) => c.reduce((a, b) => a + b, 0) === staffed)
      .map((c) => spreadOf(c, placeDays)),
  );
  return { staffed, spread };
}

function scheduleOf({ week: w, housekeepers, availability, bookings }: TeamWeekScenario) {
  const tasks = deriveCleaningTasks(bookings, cottages, w, config);
  const s = scheduleWeek({ tasks, housekeepers, availability, week: w, config });
  // Each day's regular places as fixed by day planning: staffed tasks minus reserve calls (crew of 1, R6).
  const plan = planWeek({
    tasks,
    headcount: deriveHeadcount({ housekeepers, availability, week: w }),
    week: w,
    config,
  });
  const places = plan.days.map(
    (d) => plan.tasks.filter((t) => t.plannedDate === d.date).length - d.reserveCalls,
  );
  return { s, places };
}

describe('R11 / R12 — properties', () => {
  it('invariant 21 / R11: staffed regular places are the most possible within 6 shifts and the spread U − L the smallest — against brute force', () => {
    fc.assert(
      fc.property(smallTeamWeekArb, (scenario) => {
        const { s, places } = scheduleOf(scenario);
        const regulars = scenario.housekeepers.filter((h) => !h.reserve).map((h) => h.id);
        const days = daysOf(scenario.week);
        const isAvailable = new Set(
          scenario.availability
            .filter((a) => a.available)
            .map((a) => `${a.housekeeperId} ${a.date}`),
        );
        const available = regulars.map((id) => days.map((d) => isAvailable.has(`${id} ${d}`)));
        const placeDays = available.map(
          (row) => row.filter((a, d) => a && (places[d] ?? 0) > 0).length,
        );

        const counts = shiftsOf(s, regulars);
        const expected = bruteForce(places, available);
        expect({
          staffed: counts.reduce((a, b) => a + b, 0),
          spread: spreadOf(counts, placeDays),
        }).toEqual(expected);
      }),
    );
  });

  it('invariant 7 / R11 / R10b: shuffling the order of the housekeepers in the input does not change the schedule', () => {
    fc.assert(
      fc.property(
        fc.oneof(teamWeekScenarioArb, reserveLimitWeekArb).chain((scenario) =>
          fc.tuple(
            fc.constant(scenario),
            fc.shuffledSubarray(scenario.housekeepers, {
              minLength: scenario.housekeepers.length,
              maxLength: scenario.housekeepers.length,
            }),
          ),
        ),
        ([scenario, shuffled]) => {
          expect(scheduleOf({ ...scenario, housekeepers: shuffled }).s).toEqual(
            scheduleOf(scenario).s,
          );
        },
      ),
    );
  });

  // Guarded by two layers (R11 bounds and build priority); only a mutant breaking both fails it — each layer alone is proven by inv 21 and the R12 example.
  it('invariant 22 / R11: with every regular available every day, the most and least loaded regular differ by at most 1 shift', () => {
    fc.assert(
      fc.property(fullAvailabilityTeamWeekArb, (scenario) => {
        const { s } = scheduleOf(scenario);
        const counts = shiftsOf(
          s,
          scenario.housekeepers.map((h) => h.id),
        );
        expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
      }),
    );
  });
});
