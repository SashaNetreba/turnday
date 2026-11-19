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

const lateCheckout = (bookingRef: string, time: string): TimeOverride => ({
  bookingRef,
  kind: 'LATE_CHECKOUT',
  time: localTime(time),
});
const earlyCheckin = (bookingRef: string, time: string): TimeOverride => ({
  bookingRef,
  kind: 'EARLY_CHECKIN',
  time: localTime(time),
});
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

describe('R5a — precedence: manager override → booking time → default', () => {
  it('R5a: a LATE_CHECKOUT beats the booking checkoutTime', () => {
    const tasks = deriveCleaningTasks(
      [withCheckout(booking('A/1', 1, '2026-11-14', '2026-11-17'), '11:00')],
      cottages,
      week,
      config,
      [lateCheckout('A/1', '13:00')],
    );

    expect(taskFor(tasks, 1, '2026-11-17').earliestStart).toBe('2026-11-17T13:00');
  });

  it('R5a: a LATE_CHECKOUT beats the default checkout', () => {
    const tasks = deriveCleaningTasks(
      [booking('A/1', 1, '2026-11-14', '2026-11-17')],
      cottages,
      week,
      config,
      [lateCheckout('A/1', '12:00')],
    );

    expect(taskFor(tasks, 1, '2026-11-17').earliestStart).toBe('2026-11-17T12:00');
  });

  it("R5a: an EARLY_CHECKIN beats the next arrival's checkinTime and moves the deadline", () => {
    const tasks = deriveCleaningTasks(
      [
        booking('A/1', 1, '2026-11-14', '2026-11-17'),
        withCheckin(booking('B/1', 1, '2026-11-17', '2026-11-19'), '15:00'),
      ],
      cottages,
      week,
      config,
      [earlyCheckin('B/1', '13:00')],
    );

    expect(taskFor(tasks, 1, '2026-11-17').deadline).toBe('2026-11-17T13:00');
  });

  it('R5a: the override wins even when it points the "wrong" way (LATE_CHECKOUT earlier than the booking time)', () => {
    const tasks = deriveCleaningTasks(
      [withCheckout(booking('A/1', 1, '2026-11-14', '2026-11-17'), '11:00')],
      cottages,
      week,
      config,
      [lateCheckout('A/1', '09:00')],
    );

    expect(taskFor(tasks, 1, '2026-11-17').earliestStart).toBe('2026-11-17T09:00');
  });

  it('R5a: LATE_CHECKOUT and EARLY_CHECKIN on the same booking act on different ends of the stay', () => {
    const tasks = deriveCleaningTasks(
      [
        booking('A/1', 1, '2026-11-14', '2026-11-17'),
        booking('B/1', 1, '2026-11-17', '2026-11-19'),
        booking('C/1', 1, '2026-11-19', '2026-11-25'),
      ],
      cottages,
      week,
      config,
      [earlyCheckin('B/1', '13:00'), lateCheckout('B/1', '12:00')],
    );

    expect(taskFor(tasks, 1, '2026-11-17')).toMatchObject({
      earliestStart: '2026-11-17T10:00',
      deadline: '2026-11-17T13:00',
    });
    expect(taskFor(tasks, 1, '2026-11-19')).toMatchObject({
      earliestStart: '2026-11-19T12:00',
      deadline: '2026-11-19T16:00',
    });
  });

  it('R5a: several arrivals on the same day → the earliest effective check-in (incl. override) counts', () => {
    const tasks = deriveCleaningTasks(
      [
        booking('A/1', 1, '2026-11-14', '2026-11-17'),
        withCheckin(booking('B/1', 1, '2026-11-17', '2026-11-19'), '14:00'),
        booking('C/1', 1, '2026-11-17', '2026-11-18'),
      ],
      cottages,
      week,
      config,
      [earlyCheckin('C/1', '12:00')],
    );

    expect(taskFor(tasks, 1, '2026-11-17').deadline).toBe('2026-11-17T12:00');
  });
});

describe('R5a — overrides that do not apply', () => {
  it('R5a: an EARLY_CHECKIN counts for a next arrival that departs after the planning week', () => {
    const tasks = deriveCleaningTasks(
      [
        booking('A/1', 1, '2026-11-14', '2026-11-20'),
        booking('B/1', 1, '2026-11-20', '2026-11-30'),
      ],
      cottages,
      week,
      config,
      [earlyCheckin('B/1', '12:30')],
    );

    expect(taskFor(tasks, 1, '2026-11-20').deadline).toBe('2026-11-20T12:30');
  });

  it('R5a: a LATE_CHECKOUT on a booking with no departure in the planning week is ignored', () => {
    const bookings = [
      booking('A/1', 1, '2026-11-14', '2026-11-17'),
      booking('B/1', 2, '2026-11-20', '2026-11-25'), // departs after the week
    ];

    const withOverride = deriveCleaningTasks(bookings, cottages, week, config, [
      lateCheckout('B/1', '13:00'),
    ]);

    expect(withOverride).toEqual(deriveCleaningTasks(bookings, cottages, week, config));
  });

  it('R5a: overrides on a cancelled booking are ignored — it neither departs nor arrives', () => {
    const tasks = deriveCleaningTasks(
      [
        booking('A/1', 1, '2026-11-14', '2026-11-17'),
        booking('X/1', 1, '2026-11-17', '2026-11-18', 'CANCELLED'),
        booking('B/1', 1, '2026-11-18', '2026-11-20'),
      ],
      cottages,
      week,
      config,
      [earlyCheckin('X/1', '11:00'), lateCheckout('X/1', '12:00')],
    );

    expect(taskFor(tasks, 1, '2026-11-17').deadline).toBe('2026-11-18T16:00');
    expect(tasks.some((t) => t.departureDate === '2026-11-18')).toBe(false);
  });

  it('R5a: an override for an unknown bookingRef is ignored', () => {
    const bookings = [booking('A/1', 1, '2026-11-14', '2026-11-17')];

    const withOverride = deriveCleaningTasks(bookings, cottages, week, config, [
      lateCheckout('NOPE/1', '13:00'),
      earlyCheckin('NOPE/1', '11:00'),
    ]);

    expect(withOverride).toEqual(deriveCleaningTasks(bookings, cottages, week, config));
  });
});

describe('R5a — collapsed duplicate bookings (R1, invariant 11)', () => {
  it('R5a: an override on a non-representative collapsed booking still counts', () => {
    const tasks = deriveCleaningTasks(
      [
        booking('A/1', 1, '2026-11-14', '2026-11-17'),
        booking('B/1', 1, '2026-11-15', '2026-11-17'),
      ],
      cottages,
      week,
      config,
      [lateCheckout('B/1', '12:00')],
    );

    expect(taskFor(tasks, 1, '2026-11-17')).toMatchObject({
      bookingRef: 'A/1',
      earliestStart: '2026-11-17T12:00',
    });
  });

  it("R5a: an override earlier than another collapsed booking's checkout does not pull earliestStart forward", () => {
    const tasks = deriveCleaningTasks(
      [
        withCheckout(booking('A/1', 1, '2026-11-14', '2026-11-17'), '11:00'),
        booking('B/1', 1, '2026-11-15', '2026-11-17'),
      ],
      cottages,
      week,
      config,
      [lateCheckout('B/1', '10:30')],
    );

    expect(taskFor(tasks, 1, '2026-11-17').earliestStart).toBe('2026-11-17T11:00');
  });
});

describe('R5a — duplicate overrides for one booking', () => {
  const bookings = [
    booking('A/1', 1, '2026-11-14', '2026-11-17'),
    booking('B/1', 1, '2026-11-17', '2026-11-19'),
  ];
  const duplicates = [
    lateCheckout('A/1', '12:00'),
    lateCheckout('A/1', '14:00'),
    earlyCheckin('B/1', '15:00'),
    earlyCheckin('B/1', '14:30'),
  ];

  it('R5a: the latest LATE_CHECKOUT and the earliest EARLY_CHECKIN win', () => {
    const tasks = deriveCleaningTasks(bookings, cottages, week, config, duplicates);

    expect(taskFor(tasks, 1, '2026-11-17')).toMatchObject({
      earliestStart: '2026-11-17T14:00',
      deadline: '2026-11-17T14:30',
    });
  });

  it('R5a: reversing the duplicates gives the same result', () => {
    expect(
      deriveCleaningTasks(bookings, cottages, week, config, [...duplicates].reverse()),
    ).toEqual(deriveCleaningTasks(bookings, cottages, week, config, duplicates));
  });
});

describe('R5a — properties', () => {
  /** Bookings plus overrides that mostly point at them (some at unknown refs, duplicates allowed). */
  const inputArb = fc.array(bookingArb(), { maxLength: 30 }).chain((bookings) =>
    fc.tuple(
      fc.constant(bookings),
      fc.array(
        fc.record({
          bookingRef: fc.oneof(
            bookings.length > 0
              ? fc.constantFrom(...bookings.map((b) => b.externalRef))
              : fc.constant('NONE/1'),
            fc.constant('UNKNOWN/1'),
          ),
          kind: fc.constantFrom<TimeOverride['kind']>('LATE_CHECKOUT', 'EARLY_CHECKIN'),
          time: timeArb,
        }),
        { maxLength: 20 },
      ),
    ),
  );

  it('R5a: the order of the overrides never changes the result (full permutation)', () => {
    fc.assert(
      fc.property(
        inputArb.chain(([bookings, overrides]) =>
          fc.tuple(
            fc.constant(bookings),
            fc.constant(overrides),
            fc.shuffledSubarray(overrides, {
              minLength: overrides.length,
              maxLength: overrides.length,
            }),
          ),
        ),
        weekArb,
        ([bookings, overrides, permuted], w) => {
          expect(deriveCleaningTasks(bookings, cottages, w, config, permuted)).toEqual(
            deriveCleaningTasks(bookings, cottages, w, config, overrides),
          );
        },
      ),
    );
  });

  it('R5a: a LATE_CHECKOUT on a single departing booking sets earliestStart to the override time', () => {
    fc.assert(
      fc.property(bookingArb(), timeArb, weekArb, (b, time, w) => {
        const tasks = deriveCleaningTasks([b], cottages, w, config, [
          { bookingRef: b.externalRef, kind: 'LATE_CHECKOUT', time },
        ]);
        for (const t of tasks) expect(t.earliestStart).toBe(`${t.departureDate}T${time}`);
      }),
    );
  });

  it('invariant 12 / R5a: earliestStart is always on the departure date, with overrides', () => {
    fc.assert(
      fc.property(inputArb, weekArb, ([bookings, overrides], w) => {
        for (const t of deriveCleaningTasks(bookings, cottages, w, config, overrides)) {
          expect(t.earliestStart.slice(0, 10)).toBe(t.departureDate);
        }
      }),
    );
  });
});
