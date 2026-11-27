/**
 * R7a: which cottage each working housekeeper cleans, once day planning (R5c–R5g, R10b) has fixed the day's tasks
 * and R11 has fixed who works. Never changes what is staffed, nor who works (invariant 18). Internal to the domain.
 */
import type { CleaningTask } from './cleaning-task.js';

/** A regular R11 chose for the day, with this week's counts before today. */
export interface WorkingRegular {
  readonly id: string;
  readonly stableFirst: boolean;
  readonly shifts: number;
  readonly premium: number;
}

export interface Crew {
  readonly task: CleaningTask;
  readonly housekeeperIds: readonly string[];
}

/**
 * The day's regular-staffed tasks (`tasks`, in R5d order) get crews from `people`. The tasks last in R5d order lose
 * the places the 6-shift limit left unfilled (R9a) → `unstaffed`. Then R7a:
 * 1. `stableFirst` regulars get the stable tasks in stable order — when there are more of them than stable places,
 *    the ones with the fewest shifts go without (premium takers); the rest choose most shifts first;
 * 2. the other regulars: premium tasks (R5d order) to the fewest premium tasks this week, then the remaining stable
 *    tasks (R5d order) by lowest id;
 * 3. premium takers get the premium tasks left, in R5d order.
 */
export function assignCottages(
  tasks: readonly CleaningTask[],
  people: readonly WorkingRegular[],
): { assigned: Crew[]; unstaffed: CleaningTask[] } {
  const kept: CleaningTask[] = [];
  const unstaffed: CleaningTask[] = [];
  let free = people.length;
  for (const task of tasks) {
    if (task.requiredCrewSize > free) {
      unstaffed.push(task);
      continue;
    }
    kept.push(task);
    free -= task.requiredCrewSize;
  }

  const crews = new Map<CleaningTask, string[]>(kept.map((t) => [t, []]));
  const pool = new Set(people.map((p) => p.id));
  const give = (task: CleaningTask, order: readonly WorkingRegular[]): void => {
    const crew = crews.get(task) ?? [];
    for (const p of order) {
      if (crew.length >= task.requiredCrewSize) break;
      if (pool.delete(p.id)) crew.push(p.id);
    }
  };

  const stable = kept.filter(isStable);
  const premium = kept.filter((t) => !isStable(t));
  const sf = people.filter((p) => p.stableFirst);
  const others = people.filter((p) => !p.stableFirst);
  const takers = premiumTakers(people, sumCrew(stable));
  const choosers = sf.filter((p) => !takers.includes(p)).sort(mostShifts);

  for (const t of [...stable].sort(byStableOrder)) give(t, choosers); // 1
  for (const t of premium) give(t, [...others].sort(fewestPremium)); // 2
  for (const t of stable) give(t, [...others].sort(byPersonId));
  for (const t of premium) give(t, takers); // 3
  for (const t of kept) give(t, [...people].sort(byPersonId)); // only a crew of 2 (R8) can get here

  return {
    assigned: kept.map((task) => ({ task, housekeeperIds: crews.get(task) ?? [] })),
    unstaffed,
  };
}

/**
 * R7a: the `stableFirst` regulars who go without a stable task when there are more of them than stable places —
 * fewest shifts this week first, ties by lowest id. Also the order they swap with a reserve in.
 */
export function premiumTakers(
  people: readonly WorkingRegular[],
  stablePlaces: number,
): WorkingRegular[] {
  const sf = people.filter((p) => p.stableFirst).sort(fewestShifts);
  return sf.slice(0, Math.max(0, sf.length - stablePlaces));
}

/**
 * R7a before a reserve: a `stableFirst` regular with a premium task swaps with a reserve's stable task when both
 * cannot wait (R5c) — the reserve still cleans only a task that cannot wait (R10b). `stableFirst` regulars in
 * premium-taker order, the reserves' stable tasks in stable order. Crews of one only: a crew of 2 (R8) is not split.
 */
export function swapWithReserves<A extends Crew>(
  regular: readonly A[],
  reserve: readonly A[],
  people: readonly WorkingRegular[],
  cannotWait: (task: CleaningTask) => boolean,
): { regular: A[]; reserve: A[] } {
  const reg = [...regular];
  const res = [...reserve];
  const open = res
    .map((a, i) => ({ a, i }))
    .filter(({ a }) => isStable(a.task) && a.housekeeperIds.length === 1 && cannotWait(a.task))
    .sort((x, y) => byStableOrder(x.a.task, y.a.task))
    .map(({ i }) => i);
  for (const p of people.filter((x) => x.stableFirst).sort(fewestShifts)) {
    const r = reg.findIndex(
      (a) =>
        a.housekeeperIds.length === 1 &&
        a.housekeeperIds[0] === p.id &&
        !isStable(a.task) &&
        cannotWait(a.task),
    );
    const mine = reg[r];
    if (mine === undefined) continue;
    const j = open.shift();
    const theirs = j === undefined ? undefined : res[j];
    if (j === undefined || theirs === undefined) break;
    reg[r] = { ...mine, task: theirs.task };
    res[j] = { ...theirs, task: mine.task };
  }
  return { regular: reg, reserve: res };
}

export const isStable = (t: CleaningTask): boolean => t.cottageType === 'STABLE';

/** R7a stable order: latest deadline first (no deadline counts as latest); ties by lowest cottage, then departure. */
function byStableOrder(a: CleaningTask, b: CleaningTask): number {
  if (a.deadline !== b.deadline) {
    if (a.deadline === undefined) return -1;
    if (b.deadline === undefined) return 1;
    return a.deadline > b.deadline ? -1 : 1;
  }
  if (a.cottageNumber !== b.cottageNumber) return a.cottageNumber - b.cottageNumber;
  return a.departureDate < b.departureDate ? -1 : a.departureDate > b.departureDate ? 1 : 0;
}

/** Plain string order, as for booking refs (R1). */
const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const byPersonId = (a: WorkingRegular, b: WorkingRegular): number => byId(a.id, b.id);
const fewestShifts = (a: WorkingRegular, b: WorkingRegular): number =>
  a.shifts - b.shifts || byPersonId(a, b);
const mostShifts = (a: WorkingRegular, b: WorkingRegular): number =>
  b.shifts - a.shifts || byPersonId(a, b);
const fewestPremium = (a: WorkingRegular, b: WorkingRegular): number =>
  a.premium - b.premium || byPersonId(a, b);

const sumCrew = (tasks: readonly CleaningTask[]): number =>
  tasks.reduce((sum, t) => sum + t.requiredCrewSize, 0);
