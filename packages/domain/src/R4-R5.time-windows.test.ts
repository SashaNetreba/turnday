import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { Booking, CleaningTask, SchedulingConfig } from './index.js';
import { deriveCleaningTasks, localDate, localTime } from './index.js';
import { booking, bookingArb, seedConfig, seedCottages, weekArb } from './test-fixtures.js';

const cottages = seedCottages();
const config = seedConfig();
const week = { start: localDate('2026-11-16') }; // Mon 16 – Sun 22 Nov 2026

const withCheckout = (b: Booking, time: string): Booking => ({
  ...b,
  checkoutTime: localTime(time),
});
const withCheckin = (b: Booking, time: string): Booking => ({ ...b, checkinTime: localTime(time) });

function taskFor(tasks: CleaningTask[], cottageNumber: number, date: string): CleaningTask {
  const task = tasks.find((t) => t.cottageNumber === cottageNumber && t.departureDate === date);
  if (!task) throw new Error(`no task for cottage ${String(cottageNumber)} on ${date}`);
  return task;
}

/** Test oracle, independent of the domain's arithmetic: wall-clock minutes between two `YYYY-MM-DDTHH:MM`. */
const minutes = (from: string, to: string): number =>
  (Date.parse(`${to}:00Z`) - Date.parse(`${from}:00Z`)) / 60_000;

describe('R4 — estimated effort', () => {
  it('R4: estimatedMinutes comes from the config by cottage type', () => {
    const tasks = deriveCleaningTasks(
      [
        booking('S/1', 1, '2026-11-14', '2026-11-17'),
        booking('P/1', 11, '2026-11-14', '2026-11-17'),
      ],
      cottages,
      week,
      config,
    );

    expect(taskFor(tasks, 1, '2026-11-17').estimatedMinutes).toBe(270);
    expect(taskFor(tasks, 11, '2026-11-17').estimatedMinutes).toBe(300);
  });

  it('R4: every task carries its cottage type — cottage 1 STABLE, cottage 11 PREMIUM', () => {
    const tasks = deriveCleaningTasks(
      [
        booking('S/1', 1, '2026-11-14', '2026-11-17'),
        booking('P/1', 11, '2026-11-14', '2026-11-17'),
      ],
      cottages,
      week,
      config,
    );

    expect(taskFor(tasks, 1, '2026-11-17').cottageType).toBe('STABLE');
    expect(taskFor(tasks, 11, '2026-11-17').cottageType).toBe('PREMIUM');
  });

  it('R4: a config change (STABLE 240) changes estimatedMinutes without code changes', () => {
    const changed: SchedulingConfig = {
      ...config,
      estimatedMinutes: { STABLE: 240, PREMIUM: 300 },
    };

    const tasks = deriveCleaningTasks(
      [booking('S/1', 1, '2026-11-14', '2026-11-17')],
      cottages,
      week,
      changed,
    );

    expect(taskFor(tasks, 1, '2026-11-17').estimatedMinutes).toBe(240);
  });
});

describe('R5 — time window and tight flag', () => {
  it('R5: Fri 13 Nov, cottage 5 (stable, same-day arrival) — out 10:00, deadline 16:00, not tight', () => {
    // From tests/fixtures/rezlynx-guest-list.sample.csv: TEST0005/1 leaves cottage 5, TEST0004/1 arrives the same day.
    const tasks = deriveCleaningTasks(
      [
        booking('TEST0005/1', 5, '2026-11-04', '2026-11-13'),
        booking('TEST0004/1', 5, '2026-11-13', '2026-11-15'),
      ],
      cottages,
      { start: localDate('2026-11-13') },
      config,
    );

    expect(taskFor(tasks, 5, '2026-11-13')).toMatchObject({
      estimatedMinutes: 270,
      earliestStart: '2026-11-13T10:00',
      deadline: '2026-11-13T16:00',
      tight: false,
    });
  });

  it('R5: premium with checkoutTime 11:00 and a same-day arrival has zero slack (11:00 + 300 min = 16:00) → tight', () => {
    const tasks = deriveCleaningTasks(
      [
        withCheckout(booking('OUT/1', 11, '2026-11-14', '2026-11-18'), '11:00'),
        booking('IN/1', 11, '2026-11-18', '2026-11-21'),
      ],
      cottages,
      week,
      config,
    );

    expect(taskFor(tasks, 11, '2026-11-18')).toMatchObject({
      estimatedMinutes: 300,
      earliestStart: '2026-11-18T11:00',
      deadline: '2026-11-18T16:00',
      tight: true,
    });
  });

  it('R5: one minute of slack is not tight (premium out 10:59, in 16:00)', () => {
    const tasks = deriveCleaningTasks(
      [
        withCheckout(booking('OUT/1', 11, '2026-11-14', '2026-11-18'), '10:59'),
        booking('IN/1', 11, '2026-11-18', '2026-11-21'),
      ],
      cottages,
      week,
      config,
    );

    expect(taskFor(tasks, 11, '2026-11-18').tight).toBe(false);
  });

  it('R5: a departure with no later arrival has no deadline and is never tight', () => {
    const tasks = deriveCleaningTasks(
      [withCheckout(booking('LAST/1', 12, '2026-11-14', '2026-11-18'), '15:59')],
      cottages,
      week,
      config,
    );

    const task = taskFor(tasks, 12, '2026-11-18');
    expect(task).not.toHaveProperty('deadline');
    expect(task.tight).toBe(false);
  });

  it('R5: the deadline comes from the NEXT valid arrival into the same cottage', () => {
    const tasks = deriveCleaningTasks(
      [
        booking('OUT/1', 2, '2026-11-14', '2026-11-17'),
        booking('CANCELLED/1', 2, '2026-11-18', '2026-11-19', 'CANCELLED'), // ignored
        booking('INVALID/1', 2, '2026-11-19', '2026-11-19'), // departure <= arrival → ignored
        booking('OTHER/1', 3, '2026-11-19', '2026-11-21'), // other cottage → ignored
        booking('NEXT/1', 2, '2026-11-20', '2026-11-22'),
        booking('LATER/1', 2, '2026-11-22', '2026-11-25'),
      ],
      cottages,
      week,
      config,
    );

    expect(taskFor(tasks, 2, '2026-11-17').deadline).toBe('2026-11-20T16:00');
  });

  it('R5: the next arrival may lie after the planning week', () => {
    const tasks = deriveCleaningTasks(
      [
        booking('OUT/1', 4, '2026-11-14', '2026-11-22'),
        booking('NEXT/1', 4, '2026-11-25', '2026-11-28'),
      ],
      cottages,
      week,
      config,
    );

    expect(taskFor(tasks, 4, '2026-11-22').deadline).toBe('2026-11-25T16:00');
  });

  it("R5: the next arrival's checkinTime overrides the default check-in", () => {
    const tasks = deriveCleaningTasks(
      [
        booking('OUT/1', 6, '2026-11-14', '2026-11-18'),
        withCheckin(booking('IN/1', 6, '2026-11-18', '2026-11-20'), '14:00'),
      ],
      cottages,
      week,
      config,
    );

    expect(taskFor(tasks, 6, '2026-11-18')).toMatchObject({
      earliestStart: '2026-11-18T10:00',
      deadline: '2026-11-18T14:00',
      tight: true, // 240 min window < 270 min
    });
  });

  it('R5: several arrivals on the same day → the earliest check-in counts', () => {
    const tasks = deriveCleaningTasks(
      [
        booking('OUT/1', 7, '2026-11-14', '2026-11-18'),
        withCheckin(booking('IN-A/1', 7, '2026-11-18', '2026-11-20'), '17:00'),
        withCheckin(booking('IN-B/1', 7, '2026-11-18', '2026-11-19'), '15:00'),
      ],
      cottages,
      week,
      config,
    );

    expect(taskFor(tasks, 7, '2026-11-18').deadline).toBe('2026-11-18T15:00');
  });

  it('R5 / R1: duplicate departures collapse into one task → the latest checkout counts', () => {
    const tasks = deriveCleaningTasks(
      [
        withCheckout(booking('XX1/1', 8, '2026-11-14', '2026-11-18'), '10:00'),
        withCheckout(booking('XX2/1', 8, '2026-11-15', '2026-11-18'), '11:30'),
      ],
      cottages,
      week,
      config,
    );

    expect(tasks).toHaveLength(1);
    expect(taskFor(tasks, 8, '2026-11-18')).toMatchObject({
      bookingRef: 'XX1/1',
      earliestStart: '2026-11-18T11:30',
    });
  });
});

describe('R4 / R5 — properties', () => {
  const configArb: fc.Arbitrary<SchedulingConfig> = fc
    .record({ STABLE: fc.integer({ min: 1, max: 600 }), PREMIUM: fc.integer({ min: 1, max: 600 }) })
    .map((estimatedMinutes) => ({ ...config, estimatedMinutes }));

  const typeOf = new Map(cottages.map((c) => [c.number, c.type]));

  it('R4: estimatedMinutes always equals the config value for the cottage type', () => {
    fc.assert(
      fc.property(
        fc.array(bookingArb(true), { maxLength: 40 }),
        weekArb,
        configArb,
        (bookings, w, cfg) => {
          for (const t of deriveCleaningTasks(bookings, cottages, w, cfg)) {
            const type = typeOf.get(t.cottageNumber);
            expect(type).toBeDefined();
            if (type) expect(t.estimatedMinutes).toBe(cfg.estimatedMinutes[type]);
          }
        },
      ),
    );
  });

  it('invariant 12 / R5: earliestStart is always on the departure date', () => {
    fc.assert(
      fc.property(
        fc.array(bookingArb(true), { maxLength: 40 }),
        weekArb,
        configArb,
        (bookings, w, cfg) => {
          for (const t of deriveCleaningTasks(bookings, cottages, w, cfg)) {
            expect(t.earliestStart.slice(0, 10)).toBe(t.departureDate);
          }
        },
      ),
    );
  });

  it('invariant 13 / R5: with default times, deadline >= earliestStart whenever a deadline exists', () => {
    fc.assert(
      fc.property(
        fc.array(bookingArb(false), { maxLength: 40 }),
        weekArb,
        configArb,
        (bookings, w, cfg) => {
          for (const t of deriveCleaningTasks(bookings, cottages, w, cfg)) {
            if (t.deadline !== undefined) expect(t.deadline >= t.earliestStart).toBe(true);
          }
        },
      ),
    );
  });

  it('invariant 13 / R5: tight ⇔ a deadline exists and slack <= 0; no deadline → never tight', () => {
    fc.assert(
      fc.property(
        fc.array(bookingArb(true), { maxLength: 40 }),
        weekArb,
        configArb,
        (bookings, w, cfg) => {
          for (const t of deriveCleaningTasks(bookings, cottages, w, cfg)) {
            const expected =
              t.deadline !== undefined &&
              minutes(t.earliestStart, t.deadline) - t.estimatedMinutes <= 0;
            expect(t.tight).toBe(expected);
          }
        },
      ),
    );
  });
});
