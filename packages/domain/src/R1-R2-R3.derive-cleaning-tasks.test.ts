import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { Booking, BookingStatus, CleaningTask, PlanningWeek } from './index.js';
import { addDays, contains, daysOf, deriveCleaningTasks, localDate } from './index.js';
import { booking, seedConfig, seedCottages } from './test-fixtures.js';

const week: PlanningWeek = { start: localDate('2026-11-16') }; // Mon 16 – Sun 22 Nov 2026
const cottages = seedCottages();
const config = seedConfig();

const cottagesByDay = (tasks: CleaningTask[]): Record<string, number[]> => {
  const byDay: Record<string, number[]> = {};
  for (const t of tasks) (byDay[t.plannedDate] ??= []).push(t.cottageNumber);
  return byDay;
};

describe('deriveCleaningTasks — examples', () => {
  it('R1: creates one task per booking departing in the planning week', () => {
    const tasks = deriveCleaningTasks(
      [
        booking('A/1', 1, '2026-11-14', '2026-11-17'),
        booking('B/1', 11, '2026-11-18', '2026-11-20'),
      ],
      cottages,
      week,
      config,
    );

    expect(tasks).toEqual([
      {
        bookingRef: 'A/1',
        cottageNumber: 1,
        kind: 'DEPARTURE',
        departureDate: '2026-11-17',
        plannedDate: '2026-11-17',
        deferred: false,
        estimatedMinutes: 270,
        requiredCrewSize: 1,
        earliestStart: '2026-11-17T10:00',
        tight: false,
        atRisk: false,
      },
      {
        bookingRef: 'B/1',
        cottageNumber: 11,
        kind: 'DEPARTURE',
        departureDate: '2026-11-20',
        plannedDate: '2026-11-20',
        deferred: false,
        estimatedMinutes: 300,
        requiredCrewSize: 1,
        earliestStart: '2026-11-20T10:00',
        tight: false,
        atRisk: false,
      },
    ]);
  });

  it('R1: ignores departures before and after the planning week', () => {
    const tasks = deriveCleaningTasks(
      [
        booking('before', 1, '2026-11-10', '2026-11-15'), // day −1
        booking('first', 2, '2026-11-10', '2026-11-16'), // day 0
        booking('last', 3, '2026-11-20', '2026-11-22'), // day 6
        booking('after', 4, '2026-11-20', '2026-11-23'), // day 7
      ],
      cottages,
      week,
      config,
    );

    expect(tasks.map((t) => t.bookingRef)).toEqual(['first', 'last']);
  });

  it('R1: ignores cancelled bookings', () => {
    const tasks = deriveCleaningTasks(
      [
        booking('cancelled', 1, '2026-11-14', '2026-11-17', 'CANCELLED'),
        booking('checked-out', 2, '2026-11-14', '2026-11-17', 'CHECKED_OUT'),
      ],
      cottages,
      week,
      config,
    );

    expect(tasks.map((t) => t.bookingRef)).toEqual(['checked-out']);
  });

  it('R1: skips invalid bookings whose departure is on or before arrival', () => {
    const tasks = deriveCleaningTasks(
      [
        booking('same-day', 1, '2026-11-17', '2026-11-17'),
        booking('reversed', 2, '2026-11-19', '2026-11-17'),
        booking('valid', 3, '2026-11-16', '2026-11-17'),
      ],
      cottages,
      week,
      config,
    );

    expect(tasks.map((t) => t.bookingRef)).toEqual(['valid']);
  });

  it('R1 / invariant 11: duplicate bookings for the same cottage and departure date collapse into one task', () => {
    const tasks = deriveCleaningTasks(
      [
        booking('XX2/1', 5, '2026-11-15', '2026-11-18'),
        booking('XX1/1', 5, '2026-11-14', '2026-11-18'),
        booking('XX3/1', 5, '2026-11-18', '2026-11-21'), // same cottage, other day → own task
      ],
      cottages,
      week,
      config,
    );

    expect(tasks.map((t) => [t.cottageNumber, t.plannedDate, t.bookingRef])).toEqual([
      [5, '2026-11-18', 'XX1/1'],
      [5, '2026-11-21', 'XX3/1'],
    ]);
  });

  it('R1: among duplicates the booking with the lowest externalRef is kept as bookingRef', () => {
    const tasks = deriveCleaningTasks(
      [
        booking('B/1', 5, '2026-11-15', '2026-11-18'),
        booking('A/1', 5, '2026-11-14', '2026-11-18'), // lowest, deliberately not first
        booking('C/1', 5, '2026-11-16', '2026-11-18'),
      ],
      cottages,
      week,
      config,
    );

    expect(tasks.map((t) => t.bookingRef)).toEqual(['A/1']);
  });

  it('R2: does not clean a stayover (booking spans the day without departing)', () => {
    const tasks = deriveCleaningTasks(
      [booking('long-stay', 1, '2026-11-14', '2026-11-25')],
      cottages,
      week,
      config,
    );

    expect(tasks).toEqual([]);
  });

  it('R2: does not clean an empty cottage', () => {
    const tasks = deriveCleaningTasks(
      [booking('only-cottage-2', 2, '2026-11-14', '2026-11-18')],
      cottages,
      week,
      config,
    );

    expect(tasks.map((t) => t.cottageNumber)).toEqual([2]);
  });

  it('R3: never creates a task for non-schedulable cottage 14', () => {
    const tasks = deriveCleaningTasks(
      [booking('staff', 14, '2026-11-14', '2026-11-18')],
      cottages,
      week,
      config,
    );

    expect(tasks).toEqual([]);
  });

  it('R3: never creates a task for non-existent cottage 13', () => {
    const tasks = deriveCleaningTasks(
      [booking('ghost', 13, '2026-11-14', '2026-11-18')],
      cottages,
      week,
      config,
    );

    expect(tasks).toEqual([]);
  });

  it('R1/R2/R3: RezLynx sample week 13–19 Nov 2026', () => {
    // Transcribed from tests/fixtures/rezlynx-guest-list.sample.csv (BookRef, RoomID, Arrival, Departure only).
    // The domain cannot read files; parsing the CSV is the importer's job.
    const sample = [
      booking('TEST0001/1', 1, '2026-11-14', '2026-11-15'),
      booking('TEST0002/1', 1, '2026-11-17', '2026-11-19'),
      booking('TEST0003/1', 4, '2026-11-13', '2026-11-15'),
      booking('TEST0004/1', 5, '2026-11-13', '2026-11-15'),
      booking('TEST0005/1', 5, '2026-11-04', '2026-11-13'),
      booking('TEST0004/2', 6, '2026-11-13', '2026-11-15'),
      booking('TEST0006/1', 7, '2026-11-14', '2026-11-15'),
      booking('TEST0006/2', 8, '2026-11-14', '2026-11-15'),
      booking('TEST0006/3', 9, '2026-11-14', '2026-11-15'),
      booking('TEST0007/1', 10, '2026-11-14', '2026-11-16'),
      booking('TEST0003/2', 11, '2026-11-13', '2026-11-15'),
      booking('TEST0003/3', 15, '2026-11-13', '2026-11-15'),
    ];

    const tasks = deriveCleaningTasks(sample, cottages, { start: localDate('2026-11-13') }, config);

    expect(cottagesByDay(tasks)).toEqual({
      '2026-11-13': [5], // Fri
      '2026-11-15': [1, 4, 5, 6, 7, 8, 9, 11, 15], // Sun
      '2026-11-16': [10], // Mon
      '2026-11-19': [1], // Thu
    });
  });
});

describe('deriveCleaningTasks — properties', () => {
  const base = localDate('2026-11-16');
  const statusArb = fc.constantFrom<BookingStatus>('CONFIRMED', 'CHECKED_OUT', 'CANCELLED');
  // Small ranges on purpose: duplicates (same cottage + departure) happen often.
  const bookingArb = fc
    .record({
      ref: fc.stringMatching(/^[A-Z]{2}\d{1,3}\/\d$/),
      cottageNumber: fc.integer({ min: 0, max: 16 }),
      arrivalOffset: fc.integer({ min: -10, max: 10 }),
      nights: fc.integer({ min: -2, max: 14 }), // ≤ 0 → invalid booking
      status: statusArb,
    })
    .map(({ ref, cottageNumber, arrivalOffset, nights, status }): Booking => ({
      externalRef: ref,
      cottageNumber,
      arrivalDate: addDays(base, arrivalOffset),
      departureDate: addDays(base, arrivalOffset + nights),
      status,
    }));
  const weekArb = fc
    .integer({ min: -3, max: 3 })
    .map((offset): PlanningWeek => ({ start: addDays(base, offset) }));
  const bookingsWithDuplicatesArb = fc
    .array(bookingArb, { maxLength: 40 })
    .chain((bookings) =>
      fc
        .subarray(bookings)
        .map((dups) => [
          ...bookings,
          ...dups.map((b, i) => ({ ...b, externalRef: `DUP${String(i)}/${b.externalRef}` })),
        ]),
    );

  it('invariant 5 / R3: no task exists for a non-schedulable or non-existent cottage', () => {
    const schedulable = new Set(cottages.filter((c) => c.schedulable).map((c) => c.number));
    fc.assert(
      fc.property(fc.array(bookingArb, { maxLength: 40 }), weekArb, (bookings, w) => {
        for (const t of deriveCleaningTasks(bookings, cottages, w, config)) {
          expect(schedulable.has(t.cottageNumber)).toBe(true);
        }
      }),
    );
  });

  it('R1: every task departs inside the planning week, from a valid non-cancelled booking', () => {
    fc.assert(
      fc.property(fc.array(bookingArb, { maxLength: 40 }), weekArb, (bookings, w) => {
        const days = new Set<string>(daysOf(w));
        for (const t of deriveCleaningTasks(bookings, cottages, w, config)) {
          expect(contains(w, t.departureDate)).toBe(true);
          expect(days.has(t.plannedDate)).toBe(true);
          const source = bookings.find((b) => b.externalRef === t.bookingRef);
          expect(source?.status).not.toBe('CANCELLED');
          expect(source && source.departureDate > source.arrivalDate).toBe(true);
        }
      }),
    );
  });

  it('invariant 11: at most one DEPARTURE task per cottage per day, independent of input order', () => {
    fc.assert(
      fc.property(
        bookingsWithDuplicatesArb.chain((bs) =>
          fc.tuple(fc.constant(bs), fc.shuffledSubarray(bs, { minLength: bs.length })),
        ),
        weekArb,
        ([bookings, shuffled], w) => {
          const tasks = deriveCleaningTasks(bookings, cottages, w, config);
          const keys = tasks.map((t) => `${String(t.cottageNumber)}@${t.plannedDate}`);
          expect(new Set(keys).size).toBe(keys.length);
          expect(deriveCleaningTasks(shuffled, cottages, w, config)).toEqual(tasks);
        },
      ),
    );
  });
});
