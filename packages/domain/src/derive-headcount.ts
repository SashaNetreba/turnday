import type { Availability } from './availability.js';
import type { Housekeeper } from './housekeeper.js';
import type { Headcount } from './plan-week.js';
import { contains, daysOf, type PlanningWeek } from './planning-week.js';

export interface DeriveHeadcountInput {
  readonly housekeepers: readonly Housekeeper[];
  readonly availability: readonly Availability[];
  readonly week: PlanningWeek;
}

/**
 * R10: the week's headcount from housekeepers and their availability — one entry per day, `regular` / `reserve` =
 * active housekeepers without / with `reserve` available that day. Entries outside the week are ignored. Invalid input
 * (duplicate housekeeper id, missing entry for an active housekeeper, two entries for one housekeeper and date, unknown
 * housekeeper id, both `stableFirst` and `reserve`) is rejected with every problem listed.
 */
export function deriveHeadcount({
  housekeepers,
  availability,
  week,
}: DeriveHeadcountInput): Headcount[] {
  const inWeek = availability.filter((a) => contains(week, a.date));
  const problems = [
    ...duplicateIds(housekeepers),
    ...missingEntries(housekeepers, inWeek, week),
    ...duplicateEntries(inWeek),
    ...unknownIds(housekeepers, inWeek),
    ...bothFlags(housekeepers),
  ];
  if (problems.length > 0) throw new Error(`Invalid availability: ${problems.join('; ')}`);

  const byId = new Map(housekeepers.map((h) => [h.id, h]));
  return daysOf(week).map((date) => {
    const working = inWeek
      .filter((a) => a.date === date && a.available)
      .map((a) => byId.get(a.housekeeperId))
      .filter((h): h is Housekeeper => h?.active === true);
    return {
      date,
      regular: working.filter((h) => !h.reserve).length,
      reserve: working.filter((h) => h.reserve).length,
    };
  });
}

const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];

function duplicateIds(housekeepers: readonly Housekeeper[]): string[] {
  const ids = housekeepers.map((h) => h.id);
  return unique(ids.filter((id, i) => ids.indexOf(id) !== i)).map(
    (id) => `${id}: duplicate housekeeper id`,
  );
}

function missingEntries(
  housekeepers: readonly Housekeeper[],
  inWeek: readonly Availability[],
  week: PlanningWeek,
): string[] {
  return unique(housekeepers.filter((h) => h.active).map((h) => h.id)).flatMap((id) => {
    const missing = daysOf(week).filter(
      (date) => !inWeek.some((a) => a.housekeeperId === id && a.date === date),
    );
    return missing.length > 0 ? [`${id}: ${missing.join(', ')}`] : [];
  });
}

function duplicateEntries(inWeek: readonly Availability[]): string[] {
  const counts = new Map<string, number>();
  for (const a of inWeek) {
    const key = `${a.housekeeperId}: ${a.date}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts]
    .filter(([, n]) => n > 1)
    .map(([key, n]) => `${key} (${n === 2 ? 'twice' : `${String(n)} times`})`);
}

function unknownIds(
  housekeepers: readonly Housekeeper[],
  inWeek: readonly Availability[],
): string[] {
  const known = new Set(housekeepers.map((h) => h.id));
  return unique(inWeek.map((a) => a.housekeeperId).filter((id) => !known.has(id))).map(
    (id) => `${id}: unknown housekeeper`,
  );
}

function bothFlags(housekeepers: readonly Housekeeper[]): string[] {
  return housekeepers
    .filter((h) => h.stableFirst && h.reserve)
    .map((h) => `${h.id}: stableFirst and reserve`);
}
