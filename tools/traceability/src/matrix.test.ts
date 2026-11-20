import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  buildMatrix,
  collectTests,
  compareIds,
  exitCode,
  extractRefs,
  parseDomainModel,
  renderMarkdown,
  type DomainModel,
  type TestCase,
  type VitestReport,
} from './matrix.ts';

const DOC = `# Domain model

## 4. Business rules

### Cleaning demand
- **R1.** A task per departure.
  - Several bookings collapse (see invariant 11).
- **R5.** Time window. Precedence: manager override (R5a, \`TimeOverride\`).
- **R5a. Late checkout / early check-in.** Overrides.
- **R5b. At risk.** Short window.
- **R5f. Weekend.** Days off.
- **R10.** Availability.
  1. a numbered sub-item inside a rule is not an invariant

## 5. Roles

- **R99.** not a rule: outside §4

## 6. Invariants (property-based tests)

1. Every task is staffed.
4. Premium crew.
4a. No PAIR_ONLY elsewhere.
11. At most one task per cottage per day.

## 7. Open questions

12. not an invariant: outside §6
`;

const model: DomainModel = parseDomainModel(DOC);

function test(
  title: string,
  ancestors: string[] = [],
  status = 'passed',
  file = 'a.test.ts',
): TestCase {
  return { file, ancestorTitles: ancestors, title, status };
}

function ids(rows: { id: string; tests: string[] }[]): Record<string, number> {
  return Object.fromEntries(rows.map((r) => [r.id, r.tests.length]));
}

describe('parseDomainModel', () => {
  it('reads rule IDs only from bullet headers in the Business rules section', () => {
    expect(model.rules).toEqual(['R1', 'R5', 'R5a', 'R5b', 'R5f', 'R10']);
  });

  it('reads invariant IDs only from the Invariants section, including letter suffixes (4a)', () => {
    expect(model.invariants).toEqual(['1', '4', '4a', '11']);
  });

  it('fails loudly when a section is missing, instead of reporting everything as NOT COVERED', () => {
    expect(() => parseDomainModel('# nothing here')).toThrow(/Business rules/);
  });

  it('parses the real docs/domain-model.md: R5a–R5e, R15 and invariant 4a', () => {
    const real = parseDomainModel(
      readFileSync(new URL('../../../docs/domain-model.md', import.meta.url), 'utf8'),
    );
    expect(real.rules).toEqual(
      expect.arrayContaining(['R1', 'R5', 'R5a', 'R5b', 'R5c', 'R5d', 'R5e', 'R15']),
    );
    expect(real.invariants).toEqual(expect.arrayContaining(['1', '4a', '14']));
    expect(new Set(real.rules).size).toBe(real.rules.length);
  });
});

describe('extractRefs', () => {
  it.each([
    ['R1 R2 R3: one test, several rules', ['R1', 'R2', 'R3']],
    ['R1/R2/R3: slashes', ['R1', 'R2', 'R3']],
    ['R5 / R1: duplicate departures', ['R1', 'R5']],
    ['deriveCleaningTasks (R1, invariant 11)', ['R1']],
  ])('finds every rule in %j', (text, expected) => {
    expect(extractRefs(text).rules).toEqual(expected);
  });

  it('R5, R5a and R5b never match each other by prefix', () => {
    expect(extractRefs('R5: window').rules).toEqual(['R5']);
    expect(extractRefs('R5a: override').rules).toEqual(['R5a']);
    expect(extractRefs('R5b: at risk').rules).toEqual(['R5b']);
    expect(extractRefs('R15: UTC').rules).toEqual(['R15']);
  });

  it('does not take rule IDs out of longer words', () => {
    expect(extractRefs('PR5 and CR1X and HR10a').rules).toEqual([]);
  });

  it('finds invariants written as "invariant <n>", including 4a', () => {
    expect(extractRefs('invariant 14 / R5b: atRisk').invariants).toEqual(['14']);
    expect(extractRefs('invariant 4a / invariant 4: crew').invariants).toEqual(['4', '4a']);
  });

  it.each([
    'Invariant 3: capitalised',
    'invariants 11, 12: plural',
    'inv 3: abbreviated',
    'r5a: lowercase rule',
    'R5A: uppercase suffix',
  ])('flags the near miss %j', (text) => {
    expect(extractRefs(text).nearMisses).not.toEqual([]);
  });

  it('has no near misses for conforming names', () => {
    expect(
      extractRefs('invariant 12 / R5a: earliestStart on the departure date').nearMisses,
    ).toEqual([]);
  });
});

describe('buildMatrix', () => {
  it('a test covering several rules counts for each of them', () => {
    const m = buildMatrix(model, [test('R1 / R5 / R5a: sample week')]);
    expect(ids(m.rules)).toMatchObject({ R1: 1, R5: 1, R5a: 1, R5b: 0 });
  });

  it('an R5a test is never counted for R5, and an R5 test never for R5a', () => {
    const m = buildMatrix(model, [test('R5a: override'), test('R5: window')]);
    expect(m.rules.find((r) => r.id === 'R5')?.tests).toEqual(['a.test.ts › R5: window']);
    expect(m.rules.find((r) => r.id === 'R5a')?.tests).toEqual(['a.test.ts › R5a: override']);
  });

  it('IDs in the test title win: describe IDs are not added to it', () => {
    const m = buildMatrix(model, [
      test('R5a: override on a collapsed booking', ['R5a — collapsed (R1, invariant 11)']),
    ]);
    expect(ids(m.rules)).toMatchObject({ R1: 0, R5a: 1 });
    expect(ids(m.invariants)).toMatchObject({ '11': 0 });
    expect(m.nonConforming).toEqual([]);
  });

  it('IDs in describe titles never count: a test without IDs in its own title is untraced', () => {
    const m = buildMatrix(model, [
      test('collapses duplicates', ['R1 — derive', 'invariant 11 — properties']),
    ]);
    expect(ids(m.rules)).toMatchObject({ R1: 0 });
    expect(ids(m.invariants)).toMatchObject({ '11': 0 });
    expect(m.untraced).toEqual([
      'a.test.ts › R1 — derive › invariant 11 — properties › collapses duplicates',
    ]);
    expect(m.nonConforming).toEqual([]);
  });

  it('only IDs before the first colon count: an ID mentioned after the colon gives no coverage', () => {
    const m = buildMatrix(model, [test('R5: window (R5a overrides it later, see invariant 11)')]);
    expect(ids(m.rules)).toMatchObject({ R5: 1, R5a: 0 });
    expect(ids(m.invariants)).toMatchObject({ '11': 0 });
    expect(m.nonConforming).toEqual([]);
  });

  it('every ID in the prefix counts, rules and invariants alike', () => {
    const m = buildMatrix(model, [test('invariant 11 / R5a: override')]);
    expect(ids(m.rules)).toMatchObject({ R5a: 1 });
    expect(ids(m.invariants)).toMatchObject({ '11': 1 });
  });

  it('a title with IDs but no colon credits nothing and is flagged as non-conforming', () => {
    const m = buildMatrix(model, [test('R1 derives a task')]);
    expect(ids(m.rules)).toMatchObject({ R1: 0 });
    expect(m.untraced).toEqual(['a.test.ts › R1 derives a task']);
    expect(m.nonConforming).toEqual([
      { test: 'a.test.ts › R1 derives a task', reason: 'IDs but no colon prefix' },
    ]);
  });

  it('a prefix that is not only IDs credits nothing: the first colon may be inside a time', () => {
    const m = buildMatrix(model, [test('R5f Monday check-in 14:30 waits')]);
    expect(ids(m.rules)).toMatchObject({ R5f: 0 });
    expect(m.nonConforming).toEqual([
      { test: 'a.test.ts › R5f Monday check-in 14:30 waits', reason: 'prefix is not only IDs' },
    ]);
  });

  it('a time after the real colon is fine', () => {
    const m = buildMatrix(model, [test('R5: window 10:00–16:00')]);
    expect(ids(m.rules)).toMatchObject({ R5: 1 });
    expect(m.nonConforming).toEqual([]);
  });

  it('skipped, pending, todo and failed tests are not counted, and are listed as excluded', () => {
    const m = buildMatrix(model, [
      test('R1: skipped', [], 'skipped'),
      test('R1: pending', [], 'pending'),
      test('R1: todo', [], 'todo'),
      test('R1: failed', [], 'failed'),
    ]);
    expect(ids(m.rules)).toMatchObject({ R1: 0 });
    expect(m.excluded.map((e) => e.status)).toEqual(['failed', 'pending', 'skipped', 'todo']);
  });

  it('a reference to a rule or invariant that is not in the doc is flagged as unknown, and the exit code is 1', () => {
    const m = buildMatrix(model, [
      test('R99: no such rule'),
      test('invariant 20 / R1: no such invariant'),
    ]);
    expect(m.unknown).toEqual([
      { ref: 'R99', test: 'a.test.ts › R99: no such rule' },
      { ref: 'invariant 20', test: 'a.test.ts › invariant 20 / R1: no such invariant' },
    ]);
    expect(exitCode(m)).toBe(1);
  });

  it('a skipped test with an unknown reference is still flagged', () => {
    expect(buildMatrix(model, [test('R99: skipped', [], 'skipped')]).unknown).toHaveLength(1);
  });

  it('NOT COVERED does not fail the run; a clean matrix exits 0', () => {
    const m = buildMatrix(model, [test('R1: only one rule covered')]);
    expect(m.rules.filter((r) => r.tests.length === 0)).toHaveLength(5);
    expect(exitCode(m)).toBe(0);
  });

  it('a failed test makes the exit code 1', () => {
    expect(exitCode(buildMatrix(model, [test('R1: broken', [], 'failed')]))).toBe(1);
  });

  it('passing tests with no ID anywhere are listed as untraced', () => {
    const m = buildMatrix(model, [test('loads its public entry point', ['domain package'])]);
    expect(m.untraced).toEqual(['a.test.ts › domain package › loads its public entry point']);
    expect(m.nonConforming).toEqual([]);
  });

  it('near misses are listed as non-conforming', () => {
    const m = buildMatrix(model, [test('Invariant 11: capitalised')]);
    expect(m.nonConforming).toEqual([
      { test: 'a.test.ts › Invariant 11: capitalised', reason: 'near miss: "Invariant 11"' },
    ]);
  });
});

describe('ordering and stable output', () => {
  it('compareIds sorts naturally: R5 < R5a < R5b < R10 and 4 < 4a < 11', () => {
    expect(['R10', 'R5b', 'R5', 'R1', 'R5a'].sort(compareIds)).toEqual([
      'R1',
      'R5',
      'R5a',
      'R5b',
      'R10',
    ]);
    expect(['11', '4a', '1', '4'].sort(compareIds)).toEqual(['1', '4', '4a', '11']);
  });

  it('the same tests in a different order render byte-identical markdown', () => {
    const tests = [
      test('R5: b', [], 'passed', 'z.test.ts'),
      test('R1 / invariant 11: a', [], 'passed', 'a.test.ts'),
      test('R5: a', [], 'passed', 'z.test.ts'),
      test('R99: unknown', [], 'passed', 'm.test.ts'),
      test('R1: todo', [], 'todo', 'b.test.ts'),
      test('smoke', [], 'passed', 'b.test.ts'),
    ];
    const once = renderMarkdown(buildMatrix(model, tests));
    const reversed = renderMarkdown(buildMatrix(model, [...tests].reverse()));
    expect(reversed).toBe(once);
    expect(once.indexOf('z.test.ts › R5: a')).toBeLessThan(once.indexOf('z.test.ts › R5: b'));
  });

  it('marks uncovered rules and invariants as NOT COVERED and contains no timestamps', () => {
    const md = renderMarkdown(buildMatrix(model, [test('R1: x')]));
    expect(md).toMatch(/\| R5a \| 0 \| \*\*NOT COVERED\*\* \|/);
    expect(md).toMatch(/\| 4a \| 0 \| \*\*NOT COVERED\*\* \|/);
    expect(md).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });
});

describe('collectTests', () => {
  const report: VitestReport = {
    testResults: [
      {
        name: '/home/ci/turnday/packages/domain/src/R5a.test.ts',
        assertionResults: [
          { ancestorTitles: ['R5a — precedence'], title: 'R5a: x', status: 'passed' },
        ],
      },
    ],
  };

  it('turns absolute report paths into repo-relative POSIX paths', () => {
    expect(collectTests(report, '/home/ci/turnday')).toEqual([
      {
        file: 'packages/domain/src/R5a.test.ts',
        ancestorTitles: ['R5a — precedence'],
        title: 'R5a: x',
        status: 'passed',
      },
    ]);
  });

  it('normalises Windows separators', () => {
    const win: VitestReport = {
      testResults: [
        {
          name: 'C:\\turnday\\packages\\domain\\src\\a.test.ts',
          assertionResults: [{ ancestorTitles: [], title: 'R1: x', status: 'passed' }],
        },
      ],
    };
    expect(collectTests(win, 'C:\\turnday')[0]?.file).toBe('packages/domain/src/a.test.ts');
  });
});
