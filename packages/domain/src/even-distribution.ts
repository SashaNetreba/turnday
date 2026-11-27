/**
 * R11 even distribution: which regular housekeepers work on each day of the planning week, given each day's number
 * of regular places (fixed by day planning, ADR 0004). Internal to the domain.
 *
 * 1. Bounds: the most places that can be staffed within 6 shifts each (R9a), then the smallest spread U − L such that
 *    every regular works at least min(L, their place days) and at most min(U, 6) shifts; on a tie, the largest L.
 * 2. Build: day by day, each place goes to the first candidate — fewest shifts so far, then longest since their last
 *    shift, then lowest id — for whom the rest of the week can still reach the staffed total within the bounds.
 * Every check is a max-flow on: source → day (its places) → person (1 if available) → sink (person's bounds).
 */
import { feasibleFlow, maxFlow, type BoundedEdge, type Edge } from './max-flow.js';

/** R9a: at most 6 shifts per housekeeper in the planning week. */
export const MAX_SHIFTS = 6;

export interface RegularAvailability {
  readonly id: string;
  /** Indexes (0 = the week's first day) of the days this regular is available. */
  readonly days: ReadonlySet<number>;
}

/**
 * For each day (same index as `places`), the ids of the regulars who work it, in the order they were chosen.
 * A day gets fewer ids than places only where the 6-shift limit leaves a place unfilled (R9a).
 */
export function chooseRegulars(
  places: readonly number[],
  regulars: readonly RegularAvailability[],
): string[][] {
  const net = network(places, regulars);
  const staffed = maxFlow(
    net.nodeCount,
    net
      .edges({ day: 0, takenToday: [], placesToday: at(places, 0) })
      .map((e): Edge => ({ from: e.from, to: e.to, capacity: e.upper })),
    net.source,
    net.sink,
  );
  const bounds = smallestSpread(net, places, regulars, staffed);

  const shifts = regulars.map(() => 0);
  const lastShift = regulars.map(() => -1); // −1: no shift yet this week → longest since last shift
  let filled = 0;
  return places.map((placesOnDay, day) => {
    const today: number[] = [];
    while (today.length < placesOnDay) {
      const candidates = regulars
        .map((_, p) => p)
        .filter((p) => at(regulars, p).days.has(day) && !today.includes(p))
        .sort(
          (a, b) =>
            at(shifts, a) - at(shifts, b) ||
            at(lastShift, a) - at(lastShift, b) ||
            byId(at(regulars, a).id, at(regulars, b).id),
        );
      const pick = candidates.find((p) =>
        net.feasible({
          day,
          takenToday: [...today, p],
          placesToday: placesOnDay - today.length - 1,
          done: shifts.map((n, q) => (q === p ? n + 1 : n)),
          remaining: staffed - filled - 1,
          bounds,
        }),
      );
      if (pick === undefined) break; // R9a: no one can take this place within the limit
      today.push(pick);
      shifts[pick] = at(shifts, pick) + 1;
      lastShift[pick] = day;
      filled += 1;
    }
    return today.map((p) => at(regulars, p).id);
  });
}

interface Bounds {
  readonly lo: readonly number[];
  readonly hi: readonly number[];
}

interface State {
  /** The day being filled; earlier days are fixed. */
  readonly day: number;
  /** People already working `day`. */
  readonly takenToday: readonly number[];
  /** Places of `day` still open. */
  readonly placesToday: number;
}

interface CheckState extends State {
  /** Shifts so far per person, including `takenToday`. */
  readonly done: readonly number[];
  /** Places still to staff from here to reach the week's staffed total. */
  readonly remaining: number;
  readonly bounds: Bounds;
}

/**
 * Nodes: 0 = start (feeds exactly `remaining`), 1 = source, 2…8 = days, then one node per person, last = sink.
 * Only days from `state.day` on are in the network; on `state.day` only its open places and people not yet working.
 */
function network(places: readonly number[], regulars: readonly RegularAvailability[]) {
  const start = 0;
  const source = 1;
  const dayNode = (d: number): number => 2 + d;
  const personNode = (p: number): number => 2 + places.length + p;
  const sink = 2 + places.length + regulars.length;
  const nodeCount = sink + 1;

  /** source → day → person edges (no person → sink, no start). */
  const edges = (state: State): BoundedEdge[] =>
    places.flatMap((cap, d) => {
      if (d < state.day) return [];
      const open = d === state.day ? state.placesToday : cap;
      return [
        { from: source, to: dayNode(d), lower: 0, upper: open },
        ...regulars.flatMap((r, p) =>
          r.days.has(d) && !(d === state.day && state.takenToday.includes(p))
            ? [{ from: dayNode(d), to: personNode(p), lower: 0, upper: 1 }]
            : [],
        ),
      ];
    });

  return {
    nodeCount,
    source,
    sink,
    /** source → day → person edges, plus person → sink with capacity 6 — for the maximum staffed count. */
    edges: (state: State): BoundedEdge[] => [
      ...edges(state),
      ...regulars.map((_, p) => ({ from: personNode(p), to: sink, lower: 0, upper: MAX_SHIFTS })),
    ],
    /** Whether the rest of the week can staff exactly `remaining` places with every person within their bounds. */
    feasible: (state: CheckState): boolean =>
      feasibleFlow(
        nodeCount,
        [
          { from: start, to: source, lower: state.remaining, upper: state.remaining },
          ...edges(state),
          ...regulars.map((_, p) => ({
            from: personNode(p),
            to: sink,
            lower: Math.max(0, at(state.bounds.lo, p) - at(state.done, p)),
            upper: at(state.bounds.hi, p) - at(state.done, p),
          })),
        ],
        start,
        sink,
      ),
  };
}

/**
 * R11 step 1: the smallest spread U − L for which `staffed` places can still be filled, with every person between
 * min(L, place days) and min(U, 6); on a tie, the largest L. L = 0, U = 6 always fits (that is how `staffed` was found).
 */
function smallestSpread(
  net: ReturnType<typeof network>,
  places: readonly number[],
  regulars: readonly RegularAvailability[],
  staffed: number,
): Bounds {
  const placeDays = regulars.map((r) => [...r.days].filter((d) => (places[d] ?? 0) > 0).length);
  const firstDay: CheckState = {
    day: 0,
    takenToday: [],
    placesToday: at(places, 0),
    done: regulars.map(() => 0),
    remaining: staffed,
    bounds: { lo: [], hi: [] },
  };
  for (let spread = 0; spread <= MAX_SHIFTS; spread++) {
    for (let low = places.length; low >= 0; low--) {
      const bounds: Bounds = {
        lo: placeDays.map((n) => Math.min(low, n)),
        hi: regulars.map(() => Math.min(low + spread, MAX_SHIFTS)),
      };
      if (net.feasible({ ...firstDay, bounds })) return bounds;
    }
  }
  throw new Error('R11: no bounds fit, not even L = 0, U = 6');
}

/** Plain string order, as for booking refs (R1). */
const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** `array[index]`, failing loudly instead of returning undefined (noUncheckedIndexedAccess). */
function at<T>(array: readonly T[], index: number): T {
  const value = array[index];
  if (value === undefined) throw new Error(`even-distribution: no element at ${String(index)}`);
  return value;
}
