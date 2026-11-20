import { describe, expect, it } from 'vitest';

import { deriveCleaningTasks, localDate, localTime } from './index.js';
import { booking, seedConfig, seedCottages } from './test-fixtures.js';

const cottages = seedCottages();
const config = seedConfig();
const week = { start: localDate('2026-11-16') }; // Mon 16 – Sun 22 Nov 2026

describe('R6 — default crew size', () => {
  it('R6: every task gets a crew of 1, stable and premium alike', () => {
    const tasks = deriveCleaningTasks(
      [
        booking('S/1', 3, '2026-11-14', '2026-11-17'), // stable
        booking('P/1', 11, '2026-11-15', '2026-11-18'), // premium
      ],
      cottages,
      week,
      config,
    );

    expect(tasks.map((t) => [t.cottageNumber, t.requiredCrewSize])).toEqual([
      [3, 1],
      [11, 1],
    ]);
  });

  it('R6: an at-risk task still gets a crew of 1 (raising it is left to the later crew rules)', () => {
    const tasks = deriveCleaningTasks(
      [
        { ...booking('P/1', 11, '2026-11-14', '2026-11-17'), checkoutTime: localTime('13:00') },
        booking('P/2', 11, '2026-11-17', '2026-11-20'), // in 16:00 → 180 min < 300
      ],
      cottages,
      week,
      config,
    );

    expect(tasks[0]).toMatchObject({ atRisk: true, requiredCrewSize: 1 });
  });
});
