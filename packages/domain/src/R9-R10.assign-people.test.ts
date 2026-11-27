import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { Availability, WeekSchedule } from './index.js';
import { deriveCleaningTasks, localDate, scheduleWeek } from './index.js';
import {
  availableAllWeek,
  housekeeper,
  seedConfig,
  seedCottages,
  teamWeekScenarioArb,
  turnover,
  type TeamWeekScenario,
} from './test-fixtures.js';

const cottages = seedCottages();
const config = seedConfig(); // workdayStart 10:00, STABLE 270, PREMIUM 300, check-in 16:00

function scheduleOf({
  week,
  housekeepers,
  availability,
  bookings,
}: TeamWeekScenario): WeekSchedule {
  return scheduleWeek({
    tasks: deriveCleaningTasks(bookings, cottages, week, config),
    housekeepers,
    availability,
    week,
    config,
  });
}

/** Every staffed task has exactly `requiredCrewSize` people, so an empty assignment list can't pass vacuously. */
function expectEveryStaffedTaskAssigned(s: WeekSchedule): void {
  const crewOf = (t: (typeof s.tasks)[number]) =>
    s.assignments.find(
      (a) => a.task.cottageNumber === t.cottageNumber && a.task.departureDate === t.departureDate,
    )?.housekeeperIds;
  for (const t of s.tasks)
    expect(crewOf(t)?.length, `crew of cottage ${String(t.cottageNumber)}`).toBe(
      t.requiredCrewSize,
    );
  expect(s.assignments).toHaveLength(s.tasks.length);
}

describe('R9 — one clean per housekeeper per day', () => {
  const week = { start: localDate('2026-11-16') }; // Mon 16 – Sun 22 Nov 2026
  const MONDAY = '2026-11-16';

  it('R9: three cottages out on Monday with arrivals today and three regulars → each regular cleans exactly one', () => {
    const team = ['A', 'B', 'C'].map((id) => housekeeper(id));
    const s = scheduleWeek({
      tasks: deriveCleaningTasks(
        [1, 2, 3].flatMap((c) => turnover(c, MONDAY)),
        cottages,
        week,
        config,
      ),
      housekeepers: team,
      availability: availableAllWeek(week, ['A', 'B', 'C']),
      week,
      config,
    });

    const monday = s.assignments.filter((a) => a.task.plannedDate === MONDAY);
    expect(monday.map((a) => a.task.cottageNumber).sort()).toEqual([1, 2, 3]);
    expect(monday.flatMap((a) => a.housekeeperIds).sort()).toEqual(['A', 'B', 'C']);
  });
});

describe('R9 / R10 — properties', () => {
  it('invariant 3 / R9: no housekeeper has more than one task per day', () => {
    fc.assert(
      fc.property(teamWeekScenarioArb, (scenario) => {
        const s = scheduleOf(scenario);
        expectEveryStaffedTaskAssigned(s);

        const seen = new Set<string>();
        for (const a of s.assignments) {
          for (const id of a.housekeeperIds) {
            const k = `${id} ${a.task.plannedDate}`;
            expect(seen.has(k), `${id} twice on ${a.task.plannedDate}`).toBe(false);
            seen.add(k);
          }
        }
      }),
    );
  });

  it('invariant 2 / R10: no housekeeper is assigned on a day they are unavailable', () => {
    fc.assert(
      fc.property(teamWeekScenarioArb, (scenario) => {
        const s = scheduleOf(scenario);
        expectEveryStaffedTaskAssigned(s);

        const available = new Set(
          scenario.availability
            .filter((a: Availability) => a.available)
            .map((a) => `${a.housekeeperId} ${a.date}`),
        );
        for (const a of s.assignments) {
          for (const id of a.housekeeperIds) {
            expect(
              available.has(`${id} ${a.task.plannedDate}`),
              `${id} on ${a.task.plannedDate}`,
            ).toBe(true);
          }
        }
      }),
    );
  });
});
