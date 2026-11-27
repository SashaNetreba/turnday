import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { Assignment, Booking, Housekeeper, WeekSchedule } from './index.js';
import { addDays, deriveCleaningTasks, localDate, scheduleWeek } from './index.js';
import {
  availableAllWeek,
  departure,
  housekeeper,
  isWeekendDay,
  seedConfig,
  reserveAtLimitWeekendArb,
  seedCottages,
  teamWeekScenarioArb,
  weekendDeferralWeekArb,
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
const SAT = '2026-12-12';
const SUN = '2026-12-13';
const days = [MON, TUE, WED, THU, FRI, SAT, SUN];

/** Out on `out` with the next guest arriving the same day at 16:00: cannot wait. */
const turnover = (cottage: number, out: string): Booking[] => departure(cottage, out, out);

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

const assignmentOf = (s: WeekSchedule, cottage: number): Assignment | undefined =>
  s.assignments.find((a) => a.task.cottageNumber === cottage);

describe('R5h — weekend alternative', () => {
  it('R5h: Friday 11 Dec, 6 departures and 5 regulars; cottage 12 (next guest Saturday 16:00) is deferred to Saturday → alternative Friday 11, reserve R; the schedule is unchanged', () => {
    const s = schedule(
      [1, 2, 3, 4, 5].flatMap((c) => turnover(c, FRI)).concat(departure(12, FRI, SAT)),
      [
        ...['A', 'B', 'C', 'D', 'E'].map((id) => housekeeper(id)),
        housekeeper('R', { reserve: true }),
      ],
    );

    const twelve = assignmentOf(s, 12);
    expect(twelve?.task).toMatchObject({ plannedDate: SAT, deferred: true });
    expect(twelve?.weekendAlternative).toEqual({ date: FRI, housekeeperIds: ['R'] });
    expect(twelve?.housekeeperIds).not.toContain('R');
    expect(s.assignments.filter((a) => a.housekeeperIds.includes('R'))).toEqual([]);
    expect(s.days.find((d) => d.date === FRI)?.reserveCalls).toBe(0);
  });

  it('R5h: cottage 3 out Thursday (next guest Saturday), deferred Thursday and Friday while R is free both days → alternative on the earliest weekday, Thursday', () => {
    // A is the only regular: Thursday she cleans 1, Friday 2 (both same-day arrivals); 3 waits to Saturday.
    const s = schedule(
      [...turnover(1, THU), ...turnover(2, FRI), ...departure(3, THU, SAT)],
      [housekeeper('A'), housekeeper('R', { reserve: true })],
    );

    expect(assignmentOf(s, 3)?.task.plannedDate).toBe(SAT);
    expect(assignmentOf(s, 3)?.weekendAlternative).toEqual({ date: THU, housekeeperIds: ['R'] });
  });

  it('R5h: a task deferred Monday → Tuesday gets no alternative, even with R free on Monday — only weekend deferrals do', () => {
    const s = schedule(
      [...turnover(1, MON), ...departure(3, MON, WED)],
      [housekeeper('A'), housekeeper('R', { reserve: true })],
    );

    expect(assignmentOf(s, 3)?.task).toMatchObject({ plannedDate: TUE, deferred: true });
    expect(assignmentOf(s, 3)?.weekendAlternative).toBeUndefined();
  });

  it('R5h: R works Monday to Thursday, Saturday and Sunday (6 shifts) and is free on Friday → cottage 3, deferred Friday → Saturday, gets no alternative (R9a)', () => {
    // A, the only regular, works only Friday and Saturday. Mon–Thu one turnover each → R. Friday A cleans 8; 3 (next
    // guest Saturday) waits. Saturday 3 and 5 cannot wait: A cleans 3, R cleans 5. Sunday 6 → R. R: 6 shifts.
    const s = schedule(
      [
        ...turnover(1, MON),
        ...turnover(2, TUE),
        ...turnover(4, WED),
        ...turnover(7, THU),
        ...turnover(8, FRI),
        ...departure(3, FRI, SAT),
        ...turnover(5, SAT),
        ...turnover(6, SUN),
      ],
      [housekeeper('A'), housekeeper('R', { reserve: true })],
      { A: [MON, TUE, WED, THU, SUN] },
    );

    expect(s.assignments.filter((a) => a.housekeeperIds.includes('R'))).toHaveLength(6);
    expect(assignmentOf(s, 3)?.task.plannedDate).toBe(SAT);
    expect(assignmentOf(s, 3)?.weekendAlternative).toBeUndefined();
  });

  it('R5h: two Friday departures deferred to Saturday, R free only on Friday → the first in R5d order (3) gets Friday R, the second (4) none — the alternatives fit together', () => {
    // A works Friday (cleans 1) and Saturday; B only Saturday. 3 and 4 tie on deadline (Saturday 16:00) → 3 first.
    const s = schedule(
      [...turnover(1, FRI), ...departure(3, FRI, SAT), ...departure(4, FRI, SAT)],
      [housekeeper('A'), housekeeper('B'), housekeeper('R', { reserve: true })],
      { B: days.filter((d) => d !== SAT), R: days.filter((d) => d !== FRI) },
    );

    expect(assignmentOf(s, 3)?.task.plannedDate).toBe(SAT);
    expect(assignmentOf(s, 4)?.task.plannedDate).toBe(SAT);
    expect(assignmentOf(s, 3)?.weekendAlternative).toEqual({ date: FRI, housekeeperIds: ['R'] });
    expect(assignmentOf(s, 4)?.weekendAlternative).toBeUndefined();
  });
});

describe('R5h — which reserve', () => {
  it('R5h: R1 and R2 both free on Friday; R1 was called Thursday (1 shift), R2 has none → the alternative names R2 (fewest shifts)', () => {
    // A is the only regular. Thursday 1 and 2 cannot wait: A cleans 1, R1 is called for 2 (fewest shifts, lowest id).
    // Friday A cleans 4; 3 (next guest Saturday) waits to Saturday.
    const s = schedule(
      [...turnover(1, THU), ...turnover(2, THU), ...turnover(4, FRI), ...departure(3, FRI, SAT)],
      [
        housekeeper('A'),
        housekeeper('R1', { reserve: true }),
        housekeeper('R2', { reserve: true }),
      ],
    );

    expect(assignmentOf(s, 2)?.housekeeperIds).toEqual(['R1']);
    expect(assignmentOf(s, 3)?.task.plannedDate).toBe(SAT);
    expect(assignmentOf(s, 3)?.weekendAlternative).toEqual({ date: FRI, housekeeperIds: ['R2'] });
  });
});

describe('R5h — properties', () => {
  function scheduleOf({ week: w, housekeepers, availability, bookings }: TeamWeekScenario) {
    return scheduleWeek({
      tasks: deriveCleaningTasks(bookings, cottages, w, config),
      housekeepers,
      availability,
      week: w,
      config,
    });
  }

  it('invariant 25 / R5h: alternatives only on deferred weekend tasks, on the earliest weekday a reserve was free; a reserve is offered at most once a day and, counting every offer, has at most 6 shifts', () => {
    fc.assert(
      fc.property(
        fc.oneof(weekendDeferralWeekArb, reserveAtLimitWeekendArb, teamWeekScenarioArb),
        (scenario) => {
          const s = scheduleOf(scenario);
          const { week: w, housekeepers, availability } = scenario;
          const reserves = housekeepers.filter((h) => h.reserve && h.active);
          const available = new Set(
            availability.filter((a) => a.available).map((a) => `${a.housekeeperId} ${a.date}`),
          );
          const assignedOn = (id: string, date: string) =>
            s.assignments.some((a) => a.task.plannedDate === date && a.housekeeperIds.includes(id));
          const shifts = (id: string) =>
            s.assignments.filter((a) => a.housekeeperIds.includes(id)).length;
          const withAlt = s.assignments.filter((a) => a.weekendAlternative !== undefined);
          const offersOf = (id: string) =>
            withAlt.filter((a) => a.weekendAlternative?.housekeeperIds.includes(id)).length;
          const offeredOn = (id: string, date: string) =>
            withAlt.filter(
              (a) =>
                a.weekendAlternative?.date === date &&
                a.weekendAlternative.housekeeperIds.includes(id),
            ).length;
          const lastDay = addDays(w.start, 6);
          /** Weekdays from the departure (or the week's first day) up to the day before the planned date. */
          const weekdaysBefore = (a: Assignment): string[] => {
            const out: string[] = [];
            for (
              let d = a.task.departureDate < w.start ? w.start : a.task.departureDate;
              d < a.task.plannedDate && d <= lastDay;
              d = addDays(d, 1)
            )
              if (!isWeekendDay(d)) out.push(d);
            return out;
          };
          /** Sound "no reserve free on `date`" check: each available, unassigned reserve was offered that day or is full. */
          const noneFree = (date: string) =>
            reserves.every(
              (r) =>
                !available.has(`${r.id} ${date}`) ||
                assignedOn(r.id, date) ||
                offeredOn(r.id, date) > 0 ||
                shifts(r.id) + offersOf(r.id) >= 6,
            );

          for (const a of s.assignments) {
            const ctx = `cottage ${String(a.task.cottageNumber)} on ${a.task.plannedDate}`;
            const weekendDeferral = a.task.deferred && isWeekendDay(a.task.plannedDate);
            const alt = a.weekendAlternative;
            if (alt === undefined) {
              if (weekendDeferral)
                for (const d of weekdaysBefore(a))
                  expect(noneFree(d), `${ctx}: free on ${d}`).toBe(true);
              continue;
            }
            expect(weekendDeferral, `${ctx}: only weekend deferrals`).toBe(true);
            const range = weekdaysBefore(a);
            expect(range, `${ctx}: date in range`).toContain(alt.date);
            for (const d of range.filter((x) => x < alt.date))
              expect(noneFree(d), `${ctx}: earlier ${d} had a free reserve`).toBe(true);
            expect(alt.housekeeperIds).toHaveLength(a.task.requiredCrewSize);
            for (const id of alt.housekeeperIds) {
              expect(
                reserves.map((r) => r.id),
                `${ctx}: ${id} is a reserve`,
              ).toContain(id);
              expect(available.has(`${id} ${alt.date}`), `${ctx}: ${id} available`).toBe(true);
              expect(assignedOn(id, alt.date), `${ctx}: ${id} assigned ${alt.date}`).toBe(false);
            }
          }
          for (const r of reserves) {
            for (const d of new Set(withAlt.map((a) => a.weekendAlternative?.date ?? '')))
              expect(offeredOn(r.id, d), `${r.id} offered twice on ${d}`).toBeLessThanOrEqual(1);
            expect(shifts(r.id) + offersOf(r.id), `${r.id}: shifts + offers`).toBeLessThanOrEqual(
              6,
            );
          }
        },
      ),
    );
  });
});
