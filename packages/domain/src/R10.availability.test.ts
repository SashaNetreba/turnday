import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { Availability, Housekeeper } from './index.js';
import { deriveHeadcount, localDate } from './index.js';
import { availabilityScenarioArb, availableAllWeek, housekeeper } from './test-fixtures.js';

const week = { start: localDate('2026-11-30') }; // Mon 30 Nov – Sun 6 Dec 2026
const MONDAY = '2026-11-30';
const TUESDAY = '2026-12-01';
const WEDNESDAY = '2026-12-02';
const THURSDAY = '2026-12-03';
const NEXT_MONDAY = '2026-12-07';

const A = housekeeper('A');
const B = housekeeper('B');
const R = housekeeper('R', { reserve: true });
const team: Housekeeper[] = [A, B, R];

const entry = (housekeeperId: string, date: string, available = true): Availability => ({
  housekeeperId,
  date: localDate(date),
  available,
});
const without = (entries: Availability[], id: string, date: string): Availability[] =>
  entries.filter((e) => !(e.housekeeperId === id && e.date === date));

const derive = (housekeepers: readonly Housekeeper[], availability: readonly Availability[]) =>
  deriveHeadcount({ housekeepers, availability, week });

describe('R10 — availability → headcount', () => {
  it("R10: with every entry present and all three available on Monday, Monday's headcount is 2 regular and 1 reserve", () => {
    const headcount = derive(team, availableAllWeek(week, ['A', 'B', 'R']));

    expect(headcount).toHaveLength(7);
    expect(headcount[0]).toEqual({ date: MONDAY, regular: 2, reserve: 1 });
  });

  it('R10: a missing entry for an active housekeeper makes the input invalid, listing the housekeeper and date', () => {
    const availability = without(availableAllWeek(week, ['A', 'B', 'R']), 'A', TUESDAY);

    expect(() => derive(team, availability)).toThrow(/Invalid availability: .*A: 2026-12-01/);
  });

  it('R10: a missing entry is never treated as available or unavailable', () => {
    // A is missing on Tuesday and Wednesday: rejected, never a headcount of 1 or 2 regulars.
    const availability = without(
      without(availableAllWeek(week, ['A', 'B', 'R']), 'A', TUESDAY),
      'A',
      WEDNESDAY,
    );

    expect(() => derive(team, availability)).toThrow(/A: 2026-12-01, 2026-12-02/);
  });

  it('R10: two entries for one housekeeper and date and an unknown id are listed together', () => {
    const availability = [
      ...availableAllWeek(week, ['A', 'B', 'R']),
      entry('B', WEDNESDAY, false),
      entry('X', THURSDAY),
    ];

    const error = (): unknown => derive(team, availability);
    expect(error).toThrow(/B: 2026-12-02 \(twice\)/);
    expect(error).toThrow(/X: unknown housekeeper/);
  });

  it('R10: an entry outside the planning week is ignored', () => {
    const valid = availableAllWeek(week, ['A', 'B', 'R'], { A: [MONDAY] });

    // A available on next Monday, plus a duplicate and an unknown id outside the week: all ignored.
    const withOutside = [
      ...valid,
      entry('A', NEXT_MONDAY),
      entry('A', NEXT_MONDAY),
      entry('X', '2026-11-29'),
    ];

    expect(derive(team, withOutside)).toEqual(derive(team, valid));
  });

  it('R10: a housekeeper with both stableFirst and reserve makes the input invalid', () => {
    const both = housekeeper('R', { reserve: true, stableFirst: true });

    expect(() => derive([A, B, both], availableAllWeek(week, ['A', 'B', 'R']))).toThrow(
      /R: stableFirst and reserve/,
    );
  });

  it('R10: two housekeepers with the same id make the input invalid', () => {
    const otherA = housekeeper('A', { displayName: 'Another A' });

    expect(() => derive([A, otherA, B, R], availableAllWeek(week, ['A', 'B', 'R']))).toThrow(
      /A: duplicate housekeeper id/,
    );
  });

  it('R10: every problem is listed', () => {
    const housekeepers = [
      A,
      housekeeper('A', { displayName: 'Another A' }),
      B,
      housekeeper('R', { reserve: true, stableFirst: true }),
    ];
    const availability = [
      ...without(availableAllWeek(week, ['A', 'B', 'R']), 'A', TUESDAY),
      entry('B', WEDNESDAY),
      entry('X', THURSDAY),
    ];

    const error = (): unknown => derive(housekeepers, availability);
    expect(error).toThrow(/A: duplicate housekeeper id/);
    expect(error).toThrow(/A: 2026-12-01/);
    expect(error).toThrow(/B: 2026-12-02 \(twice\)/);
    expect(error).toThrow(/X: unknown housekeeper/);
    expect(error).toThrow(/R: stableFirst and reserve/);
  });

  it('R10: an inactive housekeeper needs no entries and is not counted', () => {
    const C = housekeeper('C', { active: false });
    const S = housekeeper('S', { reserve: true, active: false });
    // C has no entries; S has entries, all available — neither counts.
    const availability = availableAllWeek(week, ['A', 'B', 'R', 'S']);

    const headcount = derive([...team, C, S], availability);
    expect(headcount.map((h) => [h.regular, h.reserve])).toEqual(Array(7).fill([2, 1]));
  });

  it('R10: an inactive housekeeper with a duplicate entry or with both stableFirst and reserve makes the input invalid', () => {
    const C = housekeeper('C', { active: false });
    const S = housekeeper('S', { active: false, reserve: true, stableFirst: true });
    const availability = [
      ...availableAllWeek(week, ['A', 'B', 'R']),
      entry('C', WEDNESDAY),
      entry('C', WEDNESDAY, false),
    ];

    const error = (): unknown => derive([...team, C, S], availability);
    expect(error).toThrow(/C: 2026-12-02 \(twice\)/);
    expect(error).toThrow(/S: stableFirst and reserve/);
  });

  it('R10: an unavailable housekeeper is not counted', () => {
    const availability = availableAllWeek(week, ['A', 'B', 'R'], { A: [TUESDAY], R: [THURSDAY] });

    const headcount = derive(team, availability);
    expect(headcount[1]).toEqual({ date: TUESDAY, regular: 1, reserve: 1 });
    expect(headcount[3]).toEqual({ date: THURSDAY, regular: 2, reserve: 0 });
    expect(headcount[0]).toEqual({ date: MONDAY, regular: 2, reserve: 1 });
  });
});

describe('R10 — properties', () => {
  it('R10: for valid input, regular and reserve on each day = active housekeepers without and with reserve available that day', () => {
    fc.assert(
      fc.property(availabilityScenarioArb, ({ week: w, housekeepers, availability, expected }) => {
        const headcount = deriveHeadcount({ housekeepers, availability, week: w });
        expect(headcount.map(({ regular, reserve }) => ({ regular, reserve }))).toEqual(expected);
      }),
    );
  });
});
