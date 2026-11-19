import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { Booking, CleaningTask, TimeOverride } from './index.js';
import { deriveCleaningTasks, localDate, localTime } from './index.js';
import {
  booking,
  bookingArb,
  seedConfig,
  seedCottages,
  timeArb,
  weekArb,
} from './test-fixtures.js';

const cottages = seedCottages();
const config = seedConfig();
const week = { start: localDate('2026-11-16') }; // Mon 16 – Sun 22 Nov 2026

const withCheckout = (b: Booking, time: string): Booking => ({
  ...b,
  checkoutTime: localTime(time),
});

function taskFor(tasks: CleaningTask[], cottageNumber: number, date: string): CleaningTask {
  const task = tasks.find((t) => t.cottageNumber === cottageNumber && t.departureDate === date);
  if (!task) throw new Error(`no task for cottage ${String(cottageNumber)} on ${date}`);
  return task;
}

/** Test oracle, independent of the domain's arithmetic: wall-clock minutes between two `YYYY-MM-DDTHH:MM`. */
const minutes = (from: string, to: string): number =>
  (Date.parse(`${to}:00Z`) - Date.parse(`${from}:00Z`)) / 60_000;

describe('R5b — at risk', () => {
  it('R5b: zero slack is tight but not at risk (premium out 11:00, in 16:00, 300 min)', () => {
    const tasks = deriveCleaningTasks(
      [
        withCheckout(booking('P/1', 11, '2026-11-14', '2026-11-17'), '11:00'),
        booking('P/2', 11, '2026-11-17', '2026-11-20'),
      ],
      cottages,
      week,
      config,
    );

    expect(taskFor(tasks, 11, '2026-11-17')).toMatchObject({ tight: true, atRisk: false });
  });

  it('R5b: one minute short of the estimate is at risk (premium out 11:01, in 16:00)', () => {
    const tasks = deriveCleaningTasks(
      [
        withCheckout(booking('P/1', 11, '2026-11-14', '2026-11-17'), '11:01'),
        booking('P/2', 11, '2026-11-17', '2026-11-20'),
      ],
      cottages,
      week,
      config,
    );

    expect(taskFor(tasks, 11, '2026-11-17')).toMatchObject({ tight: true, atRisk: true });
  });

  it('R5b: a manager override that shortens the window makes the task at risk', () => {
    const tasks = deriveCleaningTasks(
      [
        booking('S/1', 1, '2026-11-14', '2026-11-17'),
        booking('S/2', 1, '2026-11-17', '2026-11-20'),
      ],
      cottages,
      week,
      config,
      [{ bookingRef: 'S/2', kind: 'EARLY_CHECKIN', time: localTime('14:00') }],
    );

    // 10:00 → 14:00 = 240 min < 270
    expect(taskFor(tasks, 1, '2026-11-17')).toMatchObject({ tight: true, atRisk: true });
  });

  it('R5b: a negative window (late checkout 15:00, early check-in 12:00) keeps the task with its true times, at risk', () => {
    const overrides: TimeOverride[] = [
      { bookingRef: 'S/1', kind: 'LATE_CHECKOUT', time: localTime('15:00') },
      { bookingRef: 'S/2', kind: 'EARLY_CHECKIN', time: localTime('12:00') },
    ];
    const tasks = deriveCleaningTasks(
      [
        booking('S/1', 1, '2026-11-14', '2026-11-17'),
        booking('S/2', 1, '2026-11-17', '2026-11-20'),
      ],
      cottages,
      week,
      config,
      overrides,
    );

    expect(taskFor(tasks, 1, '2026-11-17')).toMatchObject({
      earliestStart: '2026-11-17T15:00',
      deadline: '2026-11-17T12:00',
      tight: true,
      atRisk: true,
    });
  });

  it('R5b: a task without a deadline is never at risk', () => {
    const tasks = deriveCleaningTasks(
      [withCheckout(booking('S/1', 1, '2026-11-14', '2026-11-17'), '23:59')],
      cottages,
      week,
      config,
    );

    expect(taskFor(tasks, 1, '2026-11-17')).toMatchObject({ atRisk: false });
  });
});

describe('R5b — properties', () => {
  /** Bookings plus overrides pointing at them (duplicates allowed). */
  const inputArb = fc.array(bookingArb(), { maxLength: 30 }).chain((bookings) =>
    fc.tuple(
      fc.constant(bookings),
      bookings.length === 0
        ? fc.constant<TimeOverride[]>([])
        : fc.array(
            fc.record({
              bookingRef: fc.constantFrom(...bookings.map((b) => b.externalRef)),
              kind: fc.constantFrom<TimeOverride['kind']>('LATE_CHECKOUT', 'EARLY_CHECKIN'),
              time: timeArb,
            }),
            { maxLength: 20 },
          ),
    ),
  );

  it('invariant 14 / R5b: atRisk ⇔ a deadline exists and window < estimatedMinutes; atRisk ⇒ tight', () => {
    fc.assert(
      fc.property(inputArb, weekArb, ([bookings, overrides], w) => {
        for (const t of deriveCleaningTasks(bookings, cottages, w, config, overrides)) {
          const expected =
            t.deadline !== undefined && minutes(t.earliestStart, t.deadline) < t.estimatedMinutes;
          expect(t.atRisk).toBe(expected);
          if (t.atRisk) expect(t.tight).toBe(true);
        }
      }),
    );
  });
});
