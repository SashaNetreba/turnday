// Test-only helpers. Excluded from the build (tsconfig.json) and from coverage (vitest.config.ts).
import fc from 'fast-check';

import type {
  Availability,
  Booking,
  BookingStatus,
  CleaningTask,
  Cottage,
  Headcount,
  Housekeeper,
  LocalTime,
  PlanningWeek,
  SchedulingConfig,
} from './index.js';
import { addDays, daysOf, localDate, localTime } from './index.js';

/** Seed reference data (docs/domain-model.md §3): 1–10 STABLE, 11/12/15 PREMIUM, 14 not schedulable, 13 missing. */
export function seedCottages(): Cottage[] {
  const stable = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((number): Cottage => ({
    number,
    type: 'STABLE',
    schedulable: true,
  }));
  const premium = [11, 12, 15].map((number): Cottage => ({
    number,
    type: 'PREMIUM',
    schedulable: true,
  }));
  const staff: Cottage = {
    number: 14,
    type: 'STABLE',
    schedulable: false,
    note: 'staff accommodation',
  };
  return [...stable, ...premium, staff];
}

export function booking(
  externalRef: string,
  cottageNumber: number,
  arrival: string,
  departure: string,
  status: BookingStatus = 'CONFIRMED',
): Booking {
  return {
    externalRef,
    cottageNumber,
    arrivalDate: localDate(arrival),
    departureDate: localDate(departure),
    status,
  };
}

/**
 * Headcount for every day of `week`: `regular` and `reserve` by default; `perDay` overrides by ISO date — a number
 * overrides `regular`, an object either count.
 */
export function headcountFor(
  week: PlanningWeek,
  regular: number,
  perDay: Readonly<Record<string, number | { regular?: number; reserve?: number }>> = {},
  reserve = 0,
): Headcount[] {
  return daysOf(week).map((date) => {
    const day = perDay[date];
    if (day === undefined) return { date, regular, reserve };
    if (typeof day === 'number') return { date, regular: day, reserve };
    return { date, regular: day.regular ?? regular, reserve: day.reserve ?? reserve };
  });
}

// ---- Booking scenarios for planning tests ----

/** Out on `out`; the next guest arrives on `arrival` (default check-in 16:00 unless `checkin` is given). */
export const stay = (
  cottage: number,
  out: string,
  arrival: string,
  checkin?: string,
): Booking[] => [
  booking(`OUT/${String(cottage)}`, cottage, '2026-11-10', out),
  {
    ...booking(`IN/${String(cottage)}`, cottage, arrival, '2026-11-30'),
    ...(checkin === undefined ? {} : { checkinTime: localTime(checkin) }),
  },
];
/** Out on `out` with the next guest arriving the same day: cannot wait. */
export const turnover = (cottage: number, out: string): Booking[] => stay(cottage, out, out);
/** Out on `out`, no next arrival known: no deadline. */
export const lastStay = (cottage: number, out: string): Booking[] => [
  booking(`OUT/${String(cottage)}`, cottage, '2026-11-10', out),
];

/** Seed SchedulingConfig (docs/domain-model.md §3): the manager's planning values. */
export function seedConfig(): SchedulingConfig {
  return {
    estimatedMinutes: { STABLE: 270, PREMIUM: 300 },
    defaultCheckoutTime: localTime('10:00'),
    defaultCheckinTime: localTime('16:00'),
    workdayStart: localTime('10:00'),
  };
}

// ---- Property-test generators (fast-check) ----

/** Generated dates are offsets from Mon 16 Nov 2026. */
const propertyBase = localDate('2026-11-16');

export const timeArb: fc.Arbitrary<LocalTime> = fc
  .tuple(fc.integer({ min: 0, max: 23 }), fc.integer({ min: 0, max: 59 }))
  .map(([h, m]) => localTime(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`));

const statusArb = fc.constantFrom<BookingStatus>('CONFIRMED', 'CHECKED_OUT', 'CANCELLED');

/**
 * Random bookings around the base week, incl. invalid (departure <= arrival), cancelled,
 * unknown (13, 0, 16) and non-schedulable (14) cottages. `withTimes = false` → default times only.
 */
export const bookingArb = (withTimes = true): fc.Arbitrary<Booking> =>
  fc
    .record({
      ref: fc.stringMatching(/^[A-Z]{2}\d{1,3}\/\d$/),
      cottageNumber: fc.integer({ min: 0, max: 16 }),
      arrivalOffset: fc.integer({ min: -10, max: 14 }),
      nights: fc.integer({ min: -2, max: 10 }),
      status: statusArb,
      checkoutTime: withTimes ? fc.option(timeArb, { nil: undefined }) : fc.constant(undefined),
      checkinTime: withTimes ? fc.option(timeArb, { nil: undefined }) : fc.constant(undefined),
    })
    .map(
      ({
        ref,
        cottageNumber,
        arrivalOffset,
        nights,
        status,
        checkoutTime,
        checkinTime,
      }): Booking => ({
        externalRef: ref,
        cottageNumber,
        arrivalDate: addDays(propertyBase, arrivalOffset),
        departureDate: addDays(propertyBase, arrivalOffset + nights),
        status,
        ...(checkoutTime ? { checkoutTime } : {}),
        ...(checkinTime ? { checkinTime } : {}),
      }),
    );

/** Planning weeks starting up to 3 days before/after the base date. */
export const weekArb: fc.Arbitrary<PlanningWeek> = fc
  .integer({ min: -3, max: 3 })
  .map((offset) => ({ start: addDays(propertyBase, offset) }));

/** Headcount for every day of `week`: regular 0–`max`, reserve 0–`maxReserve`. */
export const headcountArb = (
  week: PlanningWeek,
  max = 4,
  maxReserve = 0,
): fc.Arbitrary<Headcount[]> =>
  fc
    .array(fc.tuple(fc.integer({ min: 0, max }), fc.integer({ min: 0, max: maxReserve })), {
      minLength: 7,
      maxLength: 7,
    })
    .map((counts) =>
      daysOf(week).map((date, i) => ({
        date,
        regular: counts[i]?.[0] ?? 0,
        reserve: counts[i]?.[1] ?? 0,
      })),
    );

// ---- Test oracles for the weekend rule (R5f), independent of the domain's date helpers ----

const DAY_MS = 86_400_000;
const weekdayOf = (date: string): number => new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday

export const isWeekendDay = (date: string): boolean => [0, 6].includes(weekdayOf(date));

/** The Monday after a Saturday or Sunday. */
export const followingMondayOf = (date: string): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) + (weekdayOf(date) === 6 ? 2 : 1) * DAY_MS)
    .toISOString()
    .slice(0, 10);

/** R5f: no deadline, or the following Monday's workdayStart + estimate still fits before it. */
export const canWaitUntilMonday = (
  task: CleaningTask,
  weekendDay: string,
  config: SchedulingConfig,
): boolean =>
  task.deadline === undefined ||
  (Date.parse(`${task.deadline}:00Z`) -
    Date.parse(`${followingMondayOf(weekendDay)}T${config.workdayStart}:00Z`)) /
    60_000 >=
    task.estimatedMinutes;

// ---- Planning scenarios (shared by the deferral, carry-over and weekend properties) ----

/** Broad: random bookings around the week, incl. invalid, cancelled and unknown cottages. */
const randomBookingsArb = fc.tuple(fc.array(bookingArb(), { maxLength: 40 }), weekArb);

/**
 * Focused on deferral: departures in the week whose next guest arrives 0–3 days later at a random check-in
 * time, so short days and tight next-day / arrival-day windows are common.
 */
const deferralBookingsArb = weekArb.chain((w) =>
  fc
    .array(
      fc.record({
        cottage: fc.constantFrom(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15),
        // Last day weighted up: overflow there is carried over (R5g), across the week boundary.
        outOffset: fc.oneof(fc.integer({ min: 0, max: 6 }), fc.constant(6)),
        gap: fc.option(fc.integer({ min: 0, max: 3 }), { nil: undefined }),
        // 14:30 / 15:00 = zero slack on the arrival day for stable / premium (workdayStart 10:00).
        checkin: fc.option(
          fc.oneof(timeArb, fc.constantFrom(localTime('14:30'), localTime('15:00'))),
          { nil: undefined },
        ),
      }),
      { maxLength: 12 },
    )
    .map((departures): [Booking[], PlanningWeek] => [
      departures.flatMap(({ cottage, outOffset, gap, checkin }, i) => {
        const out = addDays(w.start, outOffset);
        const leaving = booking(`O${String(i)}`, cottage, addDays(out, -3), out);
        if (gap === undefined) return [leaving];
        const arrival = addDays(out, gap);
        return [
          leaving,
          {
            ...booking(`I${String(i)}`, cottage, arrival, addDays(arrival, 9)),
            ...(checkin === undefined ? {} : { checkinTime: checkin }),
          },
        ];
      }),
      w,
    ]),
);

/**
 * Focused on the weekend boundary (R5f): departures on the week's Saturday / Sunday whose next guest arrives on the
 * following Monday around 14:00–14:31 (workdayStart 10:00 + 4:30 stable = 14:30), plus a few weekday departures.
 */
const weekendBoundaryArb = weekArb.chain((w) => {
  const weekend = daysOf(w).filter((d) => isWeekendDay(d));
  return fc
    .array(
      fc.record({
        cottage: fc.constantFrom(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15),
        out: fc.oneof(fc.constantFrom(...weekend), fc.constantFrom(...daysOf(w))),
        checkin: fc.oneof(
          timeArb,
          fc.constantFrom('14:00', '14:29', '14:30', '14:31', '15:00').map(localTime),
        ),
      }),
      { maxLength: 8 },
    )
    .map((departures): [Booking[], PlanningWeek] => [
      departures.flatMap(({ cottage, out, checkin }, i) => {
        const monday = isWeekendDay(out) ? localDate(followingMondayOf(out)) : addDays(out, 1);
        return [
          booking(`W${String(i)}`, cottage, addDays(out, -3), out),
          {
            ...booking(`M${String(i)}`, cottage, monday, addDays(monday, 9)),
            checkinTime: checkin,
          },
        ];
      }),
      w,
    ]);
});

/** A departure for `nextDayBoundaryScenarioArb`: next guest the next day at `next` minutes past midnight, or none. */
interface BoundaryDeparture {
  readonly cottage: number;
  readonly outOffset: number;
  readonly next: number | 'SAME_DAY' | 'NONE';
}

const hhmm = (minutes: number): LocalTime =>
  localTime(
    `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`,
  );

/**
 * Focused on the R5d groups (invariant 19), Monday–Sunday week. Every scenario has a boundary pair departing the same
 * day (Mon–Sat): a stable cottage whose next guest arrives the next day at 14:30–14:50 (fits the next day: 10:00 +
 * 270 = 14:30) and a premium cottage arriving later but before 15:00 (does not fit: 10:00 + 300 = 15:00) — the
 * stable one has the earlier deadline but can wait. Plus up to 4 other departures (next-day check-in 14:00–15:00,
 * same-day arrival or none) and headcount regular 0–2, reserve 0–1 per day, so short days are common.
 */
export const nextDayBoundaryScenarioArb: fc.Arbitrary<[Booking[], PlanningWeek, Headcount[]]> = fc
  .tuple(
    fc
      .record({
        outOffset: fc.integer({ min: 0, max: 5 }),
        stable: fc.integer({ min: 1, max: 10 }),
        premium: fc.constantFrom(11, 12, 15),
        stableStep: fc.integer({ min: 0, max: 4 }), // 14:30–14:50
        gapSteps: fc.integer({ min: 1, max: 5 }), // premium 5–25 min later, capped below 15:00
      })
      .map(({ outOffset, stable, premium, stableStep, gapSteps }): BoundaryDeparture[] => {
        const stableCheckin = 14 * 60 + 30 + stableStep * 5;
        const premiumCheckin = Math.min(stableCheckin + gapSteps * 5, 14 * 60 + 55);
        return [
          { cottage: stable, outOffset, next: stableCheckin },
          { cottage: premium, outOffset, next: premiumCheckin },
        ];
      }),
    fc.array(
      fc.record({
        cottage: fc.constantFrom(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15),
        outOffset: fc.integer({ min: 0, max: 6 }),
        next: fc.oneof(
          {
            weight: 2,
            arbitrary: fc.integer({ min: 0, max: 12 }).map((step) => 14 * 60 + step * 5),
          },
          { weight: 1, arbitrary: fc.constantFrom<'SAME_DAY' | 'NONE'>('SAME_DAY', 'NONE') },
        ),
      }),
      { maxLength: 4 },
    ),
  )
  .map(([pair, others]): Booking[] =>
    [...pair, ...others].flatMap(({ cottage, outOffset, next }, i) => {
      const out = addDays(propertyBase, outOffset);
      const leaving = booking(`D${String(i)}`, cottage, addDays(out, -3), out);
      if (next === 'NONE') return [leaving];
      if (next === 'SAME_DAY') {
        return [leaving, booking(`S${String(i)}`, cottage, out, addDays(out, 9))];
      }
      const arrival = addDays(out, 1);
      return [
        leaving,
        {
          ...booking(`N${String(i)}`, cottage, arrival, addDays(arrival, 9)),
          checkinTime: hhmm(next),
        },
      ];
    }),
  )
  .chain((bookings) => {
    const w: PlanningWeek = { start: propertyBase };
    return fc.tuple(fc.constant(bookings), fc.constant(w), headcountArb(w, 2, 1));
  });

/**
 * Two chained Monday–Sunday weeks focused on the week boundary (R5g, R10b): departures on week 1's Sunday and week 2's
 * Monday with a same-day arrival, no next arrival, or a next-day check-in 14:00–15:00 — so Sunday overflows, some
 * tasks are carried into Monday and cannot wait there. Headcount: regular 0–1, reserve 0–1 per day.
 */
export const weekBoundaryTwoWeekScenarioArb: fc.Arbitrary<
  [Booking[], PlanningWeek, Headcount[], PlanningWeek, Headcount[]]
> = fc
  .array(
    fc.record({
      cottage: fc.constantFrom(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15),
      outOffset: fc.constantFrom(6, 7), // week 1's Sunday, week 2's Monday
      next: fc.oneof(
        fc.integer({ min: 0, max: 12 }).map((step) => 14 * 60 + step * 5),
        fc.constantFrom<'SAME_DAY' | 'NONE'>('SAME_DAY', 'NONE'),
      ),
    }),
    { minLength: 2, maxLength: 8 },
  )
  .map((departures): Booking[] =>
    departures.flatMap(({ cottage, outOffset, next }, i) => {
      const out = addDays(propertyBase, outOffset);
      const leaving = booking(`B${String(i)}`, cottage, addDays(out, -3), out);
      if (next === 'NONE') return [leaving];
      if (next === 'SAME_DAY') {
        return [leaving, booking(`T${String(i)}`, cottage, out, addDays(out, 9))];
      }
      const arrival = addDays(out, 1);
      return [
        leaving,
        {
          ...booking(`A${String(i)}`, cottage, arrival, addDays(arrival, 9)),
          checkinTime: hhmm(next),
        },
      ];
    }),
  )
  .chain((bookings) => {
    const w1: PlanningWeek = { start: propertyBase };
    const w2: PlanningWeek = { start: addDays(propertyBase, 7) };
    return fc.tuple(
      fc.constant(bookings),
      fc.constant(w1),
      headcountArb(w1, 1, 1),
      fc.constant(w2),
      headcountArb(w2, 1, 1),
    );
  });

/** Bookings + week + headcount (regular 0–2, reserve 0–1 per day): broad, deferral- or weekend-focused. */
export const planningScenarioArb = fc
  .oneof(randomBookingsArb, deferralBookingsArb, weekendBoundaryArb)
  .chain(([bookings, w]) => fc.tuple(fc.constant(bookings), fc.constant(w), headcountArb(w, 2, 1)));

// ---- Housekeepers and availability (R10) ----

/** An active regular housekeeper named after its id, unless `flags` says otherwise. */
export function housekeeper(id: string, flags: Partial<Omit<Housekeeper, 'id'>> = {}): Housekeeper {
  return { id, displayName: id, stableFirst: false, reserve: false, active: true, ...flags };
}

/**
 * One entry per housekeeper and day of `week`, all available; `unavailable` lists ISO dates per id that are entered
 * as unavailable instead.
 */
export function availableAllWeek(
  week: PlanningWeek,
  ids: readonly string[],
  unavailable: Readonly<Record<string, readonly string[]>> = {},
): Availability[] {
  return ids.flatMap((housekeeperId) =>
    daysOf(week).map((date) => ({
      housekeeperId,
      date,
      available: !(unavailable[housekeeperId] ?? []).includes(date),
    })),
  );
}

/**
 * Valid R10 input with 0–8 housekeepers (random reserve / stableFirst, never both; random active), one entry per
 * active housekeeper and day, plus noise that must not count: optional entries for inactive housekeepers in the week
 * and entries outside the week (known or unknown ids). `expected[i]` = active housekeepers available on day i, split
 * into `regular` (without `reserve`) and `reserve`.
 */
export const availabilityScenarioArb: fc.Arbitrary<{
  week: PlanningWeek;
  housekeepers: Housekeeper[];
  availability: Availability[];
  expected: { regular: number; reserve: number }[];
}> = weekArb.chain((week) =>
  fc
    .array(
      fc.record({
        role: fc.constantFrom('REGULAR', 'STABLE_FIRST', 'RESERVE'),
        active: fc.boolean(),
        days: fc.array(fc.boolean(), { minLength: 7, maxLength: 7 }),
        inactiveEntries: fc.option(fc.array(fc.boolean(), { minLength: 7, maxLength: 7 })),
      }),
      { maxLength: 8 },
    )
    .chain((team) => {
      const housekeepers = team.map((m, i) =>
        housekeeper(`H${String(i)}`, {
          active: m.active,
          reserve: m.role === 'RESERVE',
          stableFirst: m.role === 'STABLE_FIRST',
        }),
      );
      const days = daysOf(week);
      const inWeek = team.flatMap((m, i): Availability[] => {
        const entries = m.active ? m.days : m.inactiveEntries;
        if (entries === null) return [];
        return days.map((date, d) => ({
          housekeeperId: `H${String(i)}`,
          date,
          available: entries[d] ?? false,
        }));
      });
      const outsideArb = fc.array(
        fc.record({
          housekeeperId: fc.constantFrom('X', ...housekeepers.map((h) => h.id)),
          date: fc
            .oneof(fc.integer({ min: -7, max: -1 }), fc.integer({ min: 7, max: 13 }))
            .map((offset) => addDays(week.start, offset)),
          available: fc.boolean(),
        }),
        { maxLength: 6 },
      );
      const expected = days.map((_, d) => {
        const working = team.filter((m) => m.active && (m.days[d] ?? false));
        return {
          regular: working.filter((m) => m.role !== 'RESERVE').length,
          reserve: working.filter((m) => m.role === 'RESERVE').length,
        };
      });
      return outsideArb.map((outside) => ({
        week,
        housekeepers,
        availability: [...inWeek, ...outside],
        expected,
      }));
    }),
);

// ---- Team weeks: housekeepers + availability + bookings, for the assignment step (R9, R9a, R10, R11, R12) ----

/** A generated team week: the input of scheduleWeek, apart from cottages and config. */
export interface TeamWeekScenario {
  readonly week: PlanningWeek;
  readonly housekeepers: Housekeeper[];
  readonly availability: Availability[];
  readonly bookings: Booking[];
}

/** One departure in a team week: the next guest arrives the same day, `gap` days later, or never. */
interface TeamDeparture {
  readonly cottage: number;
  readonly outOffset: number;
  readonly next: 'SAME_DAY' | 'NONE' | number;
}

const teamCottageArb = fc.constantFrom(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15);

/** Departures in `week`; same-day arrivals weighted up, so weekend tasks cannot wait and reserves get called. */
const teamDeparturesArb = (maxLength: number): fc.Arbitrary<TeamDeparture[]> =>
  fc.array(
    fc.record({
      cottage: teamCottageArb,
      outOffset: fc.integer({ min: 0, max: 6 }),
      next: fc.oneof(
        { weight: 3, arbitrary: fc.constant<'SAME_DAY'>('SAME_DAY') },
        { weight: 1, arbitrary: fc.constant<'NONE'>('NONE') },
        { weight: 1, arbitrary: fc.integer({ min: 1, max: 3 }) },
      ),
    }),
    { maxLength },
  );

/**
 * Availability for every housekeeper (all active) on every day: `true` with weight 3 against 1, so most days have
 * people and some do not.
 */
const teamAvailabilityArb = (
  week: PlanningWeek,
  ids: readonly string[],
): fc.Arbitrary<Availability[]> =>
  fc
    .array(
      fc.array(
        fc.oneof(
          { weight: 3, arbitrary: fc.constant(true) },
          { weight: 1, arbitrary: fc.constant(false) },
        ),
        {
          minLength: 7,
          maxLength: 7,
        },
      ),
      { minLength: ids.length, maxLength: ids.length },
    )
    .map((perPerson) =>
      ids.flatMap((housekeeperId, p) =>
        daysOf(week).map((date, d) => ({
          housekeeperId,
          date,
          available: perPerson[p]?.[d] ?? false,
        })),
      ),
    );

function teamBookings(week: PlanningWeek, departures: readonly TeamDeparture[]): Booking[] {
  return departures.flatMap(({ cottage, outOffset, next }, i) => {
    const out = addDays(week.start, outOffset);
    const leaving = booking(`L${String(i)}`, cottage, addDays(out, -2), out);
    if (next === 'NONE') return [leaving];
    const arrival = next === 'SAME_DAY' ? out : addDays(out, next);
    return [leaving, booking(`A${String(i)}`, cottage, arrival, addDays(arrival, 9))];
  });
}

/** Regulars H0…H(n−1), reserves R0…R(m−1) — so every regular's id sorts before every reserve's. */
const teamArb = (
  week: PlanningWeek,
  regulars: { min: number; max: number },
  reserves: { min: number; max: number },
  maxDepartures: number,
): fc.Arbitrary<TeamWeekScenario> =>
  fc.tuple(fc.integer(regulars), fc.integer(reserves)).chain(([nRegular, nReserve]) => {
    const housekeepers = [
      ...Array.from({ length: nRegular }, (_, i) => housekeeper(`H${String(i)}`)),
      ...Array.from({ length: nReserve }, (_, i) =>
        housekeeper(`R${String(i)}`, { reserve: true }),
      ),
    ];
    return fc
      .tuple(
        teamAvailabilityArb(
          week,
          housekeepers.map((h) => h.id),
        ),
        teamDeparturesArb(maxDepartures),
      )
      .map(([availability, departures]) => ({
        week,
        housekeepers,
        availability,
        bookings: teamBookings(week, departures),
      }));
  });

/**
 * Team weeks for the assignment properties: (a) broad — 1–8 regulars, 0–2 reserves, up to 25 departures, any week
 * start; (b) reserve-heavy — 1–2 regulars, 2 reserves, so days run out of regulars and reserves get called.
 * Availability is random, so lower ids are often unavailable on a day with places.
 */
export const teamWeekScenarioArb: fc.Arbitrary<TeamWeekScenario> = fc.oneof(
  weekArb.chain((w) => teamArb(w, { min: 1, max: 8 }, { min: 0, max: 2 }, 25)),
  weekArb.chain((w) => teamArb(w, { min: 1, max: 2 }, { min: 2, max: 2 }, 20)),
);

/** The schedulable seed cottages in number order (1–10 stable, 11, 12, 15 premium). */
const schedulableCottages = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15];

/**
 * Same-day turnovers by day of `week`: on day d, `counts[d]` cottages (1, 2, 3, … in that order) depart and the next
 * guest arrives the same day, so none of them can wait. A cottage that turns over on several days gets one booking
 * per stay, each arriving the day the previous one departs.
 */
export function dailyTurnovers(week: PlanningWeek, counts: readonly number[]): Booking[] {
  const days = daysOf(week);
  return schedulableCottages.flatMap((cottage, k) => {
    const outs = days.filter((_, d) => (counts[d] ?? 0) > k);
    if (outs.length === 0) return [];
    const ref = (j: number): string => `T${String(cottage)}/${String(j)}`;
    const first = outs[0] ?? week.start;
    const last = outs[outs.length - 1] ?? week.start;
    return [
      booking(ref(0), cottage, addDays(first, -2), first),
      ...outs.slice(1).map((out, j) => booking(ref(j + 1), cottage, outs[j] ?? out, out)),
      booking(ref(outs.length), cottage, last, addDays(last, 9)),
    ];
  });
}

/** 7 counts, one per day of the week, each in [min, max]. */
const dailyCountsArb = (min: number, max: number): fc.Arbitrary<number[]> =>
  fc.array(fc.integer({ min, max }), { minLength: 7, maxLength: 7 });

/**
 * Small team weeks for the R11 brute-force oracle (invariant 21): 1–4 regulars, no reserves, random availability,
 * 0–3 turnovers a day — plus the "A/B shape" (R11 example): on day k H0 and H1 are available with one place, on day
 * k + 1 only H0, no other departures — where filling day k by fewest shifts alone gives 2 vs 0 instead of 1 vs 1.
 */
export const smallTeamWeekArb: fc.Arbitrary<TeamWeekScenario> = fc.oneof(
  weekArb.chain((week) =>
    fc.integer({ min: 1, max: 4 }).chain((n) => {
      const housekeepers = Array.from({ length: n }, (_, i) => housekeeper(`H${String(i)}`));
      return fc
        .tuple(
          teamAvailabilityArb(
            week,
            housekeepers.map((h) => h.id),
          ),
          dailyCountsArb(0, 3),
        )
        .map(([availability, counts]) => ({
          week,
          housekeepers,
          availability,
          bookings: dailyTurnovers(week, counts),
        }));
    }),
  ),
  weekArb.chain((week) =>
    fc.tuple(fc.integer({ min: 2, max: 3 }), fc.integer({ min: 0, max: 5 })).chain(([n, k]) => {
      const housekeepers = Array.from({ length: n }, (_, i) => housekeeper(`H${String(i)}`));
      const days = daysOf(week);
      return teamAvailabilityArb(
        week,
        housekeepers.map((h) => h.id),
      ).map((random) => ({
        week,
        housekeepers,
        availability: random.map((a) => {
          if (a.date === days[k + 1]) return { ...a, available: a.housekeeperId === 'H0' };
          if (a.date === days[k] && ['H0', 'H1'].includes(a.housekeeperId))
            return { ...a, available: true };
          return a;
        }),
        bookings: dailyTurnovers(
          week,
          days.map((_, d) => (d === k || d === k + 1 ? 1 : 0)),
        ),
      }));
    }),
  ),
);

/** Every regular (1–8, no reserves) available every day of the week; 0–8 turnovers a day (invariant 22). */
export const fullAvailabilityTeamWeekArb: fc.Arbitrary<TeamWeekScenario> = weekArb.chain((week) =>
  fc.tuple(fc.integer({ min: 1, max: 8 }), dailyCountsArb(0, 8)).map(([n, counts]) => {
    const housekeepers = Array.from({ length: n }, (_, i) => housekeeper(`H${String(i)}`));
    return {
      week,
      housekeepers,
      availability: availableAllWeek(
        week,
        housekeepers.map((h) => h.id),
      ),
      bookings: dailyTurnovers(week, counts),
    };
  }),
);

/**
 * Monday–Sunday weeks in high season (invariant 23): 1–3 regulars with H0 available every day, 0–1 reserves, 1–3
 * turnovers every day — so the 6-shift limit binds and a regular place is left unfilled — plus broad team weeks
 * starting on Monday.
 */
export const mondayTeamWeekArb: fc.Arbitrary<TeamWeekScenario> = fc.oneof(
  fc
    .tuple(fc.integer({ min: 1, max: 3 }), fc.integer({ min: 0, max: 1 }), dailyCountsArb(1, 3))
    .chain(([nRegular, nReserve, counts]) => {
      const week: PlanningWeek = { start: propertyBase };
      const housekeepers = [
        ...Array.from({ length: nRegular }, (_, i) => housekeeper(`H${String(i)}`)),
        ...Array.from({ length: nReserve }, (_, i) =>
          housekeeper(`R${String(i)}`, { reserve: true }),
        ),
      ];
      return teamAvailabilityArb(
        week,
        housekeepers.map((h) => h.id),
      ).map((random) => ({
        week,
        housekeepers,
        availability: random.map((a) => (a.housekeeperId === 'H0' ? { ...a, available: true } : a)),
        bookings: dailyTurnovers(week, counts),
      }));
    }),
  teamArb({ start: propertyBase }, { min: 1, max: 8 }, { min: 0, max: 2 }, 25),
);
