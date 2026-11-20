// Traceability matrix: business rules and invariants (docs/domain-model.md) → the tests that reference them.
// Pure functions only; cli.ts does the file I/O. Naming convention: docs/test-strategy.md.

export interface DomainModel {
  rules: string[];
  invariants: string[];
}

export interface Refs {
  rules: string[];
  invariants: string[];
  nearMisses: string[];
}

/** One test as Vitest's JSON reporter describes it, with a repo-relative file path. */
export interface TestCase {
  file: string;
  ancestorTitles: string[];
  title: string;
  status: string;
}

export interface VitestReport {
  testResults: {
    name: string;
    assertionResults: { ancestorTitles: string[]; title: string; status: string }[];
  }[];
}

export interface Row {
  id: string;
  tests: string[];
}

export interface Matrix {
  rules: Row[];
  invariants: Row[];
  unknown: { ref: string; test: string }[];
  nonConforming: { test: string; reason: string }[];
  untraced: string[];
  excluded: { test: string; status: string }[];
}

const RULE_REF = /(?<![A-Za-z0-9])R(\d+[a-z]?)(?![A-Za-z0-9])/g;
const INVARIANT_REF = /\binvariant (\d+[a-z]?)\b/g;
// A test title's prefix (before the first colon) must be only IDs, separated by " / " or ",".
const ID = String.raw`(?:R\d+[a-z]?|invariant \d+[a-z]?)`;
const STRICT_PREFIX = new RegExp(String.raw`^${ID}(?:(?: / |, ?)${ID})*$`);
const NEAR_MISSES: RegExp[] = [
  /\bInvariants?\s+\d+[a-z]?\b/g, // capitalised
  /\binvariants\b[^:]*/g, // plural: "invariants 11, 12"
  /\binv\.?\s*\d+[a-z]?\b/gi, // abbreviated
  /(?<![A-Za-z0-9])r\d+[a-z]?(?![A-Za-z0-9])/g, // lowercase rule
  /(?<![A-Za-z0-9])R\d+[A-Z](?![A-Za-z0-9])/g, // uppercase rule suffix
];

/** Natural order: R5 < R5a < R5b < R10; 4 < 4a < 11. */
export function compareIds(a: string, b: string): number {
  const parse = (id: string): [number, string] => {
    const m = /^R?(\d+)([a-z]*)$/.exec(id);
    return m ? [Number(m[1]), m[2] ?? ''] : [Number.MAX_SAFE_INTEGER, id];
  };
  const [na, sa] = parse(a);
  const [nb, sb] = parse(b);
  return na !== nb ? na - nb : byCodePoint(sa, sb);
}

function byCodePoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function section(md: string, heading: string): string {
  const lines = md.split(/\r?\n/);
  const start = lines.findIndex((l) => new RegExp(`^## \\d+\\. ${heading}\\b`).test(l));
  if (start === -1) throw new Error(`docs/domain-model.md: section "## <n>. ${heading}" not found`);
  const end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
  return lines.slice(start + 1, end === -1 ? undefined : end).join('\n');
}

function uniqueSorted(ids: Iterable<string>): string[] {
  return [...new Set(ids)].sort(compareIds);
}

export function parseDomainModel(md: string): DomainModel {
  const rules = [...section(md, 'Business rules').matchAll(/^- \*\*R(\d+[a-z]?)\./gm)].map(
    (m) => `R${m[1] ?? ''}`,
  );
  const invariants = [...section(md, 'Invariants').matchAll(/^(\d+[a-z]?)\. /gm)].map(
    (m) => m[1] ?? '',
  );
  return { rules: uniqueSorted(rules), invariants: uniqueSorted(invariants) };
}

export function extractRefs(text: string): Refs {
  return {
    rules: uniqueSorted([...text.matchAll(RULE_REF)].map((m) => `R${m[1] ?? ''}`)),
    invariants: uniqueSorted([...text.matchAll(INVARIANT_REF)].map((m) => m[1] ?? '')),
    nearMisses: NEAR_MISSES.flatMap((re) => [...text.matchAll(re)].map((m) => m[0].trim())),
  };
}

function hasIds(refs: Refs): boolean {
  return refs.rules.length > 0 || refs.invariants.length > 0;
}

const NO_REFS: Refs = { rules: [], invariants: [], nearMisses: [] };

/**
 * The IDs a test title counts for: only those in a prefix before the first colon that consists of IDs alone.
 * Anything else credits nothing; `problems` says why, when the title mentions IDs at all.
 */
function titleRefs(title: string): { refs: Refs; problems: string[] } {
  const colon = title.indexOf(':');
  const prefix = colon === -1 ? undefined : title.slice(0, colon);
  if (prefix !== undefined && STRICT_PREFIX.test(prefix))
    return { refs: extractRefs(prefix), problems: [] };
  const all = extractRefs(title);
  if (!hasIds(all) && all.nearMisses.length === 0) return { refs: NO_REFS, problems: [] };
  const problems =
    prefix === undefined
      ? ['IDs but no colon prefix']
      : all.nearMisses.length > 0
        ? all.nearMisses.map((miss) => `near miss: "${miss}"`)
        : ['prefix is not only IDs'];
  return { refs: NO_REFS, problems };
}

function label(t: TestCase): string {
  return [t.file, ...t.ancestorTitles, t.title].join(' › ');
}

export function buildMatrix(model: DomainModel, tests: TestCase[]): Matrix {
  const ruleTests = new Map<string, string[]>(model.rules.map((id) => [id, []]));
  const invariantTests = new Map<string, string[]>(model.invariants.map((id) => [id, []]));
  const matrix: Matrix = {
    rules: [],
    invariants: [],
    unknown: [],
    nonConforming: [],
    untraced: [],
    excluded: [],
  };

  for (const t of tests) {
    const name = label(t);
    const { refs, problems } = titleRefs(t.title);
    for (const reason of problems) matrix.nonConforming.push({ test: name, reason });

    const counted = t.status === 'passed';
    if (!counted) matrix.excluded.push({ test: name, status: t.status });
    if (counted && !hasIds(refs)) matrix.untraced.push(name);

    for (const [ids, known, prefix] of [
      [refs.rules, ruleTests, ''],
      [refs.invariants, invariantTests, 'invariant '],
    ] as const) {
      for (const id of ids) {
        const row = known.get(id);
        if (!row) matrix.unknown.push({ ref: `${prefix}${id}`, test: name });
        else if (counted) row.push(name);
      }
    }
  }

  const rows = (m: Map<string, string[]>): Row[] =>
    [...m]
      .map(([id, ts]) => ({ id, tests: [...new Set(ts)].sort(byCodePoint) }))
      .sort((a, b) => compareIds(a.id, b.id));
  matrix.rules = rows(ruleTests);
  matrix.invariants = rows(invariantTests);
  matrix.unknown.sort((a, b) => byCodePoint(a.test, b.test) || byCodePoint(a.ref, b.ref));
  matrix.nonConforming.sort(
    (a, b) => byCodePoint(a.test, b.test) || byCodePoint(a.reason, b.reason),
  );
  matrix.untraced.sort(byCodePoint);
  matrix.excluded.sort((a, b) => byCodePoint(a.test, b.test));
  return matrix;
}

/** 1 when a test references an ID that is not in the doc, or a test failed. NOT COVERED alone is not a failure. */
export function exitCode(m: Matrix): number {
  return m.unknown.length > 0 || m.excluded.some((e) => e.status === 'failed') ? 1 : 0;
}

export function collectTests(report: VitestReport, repoRoot: string): TestCase[] {
  const posix = (p: string): string => p.replaceAll('\\', '/');
  const root = posix(repoRoot).replace(/\/$/, '') + '/';
  return report.testResults.flatMap((file) => {
    const path = posix(file.name);
    const rel = path.startsWith(root) ? path.slice(root.length) : path;
    return file.assertionResults.map((a) => ({
      file: rel,
      ancestorTitles: a.ancestorTitles,
      title: a.title,
      status: a.status,
    }));
  });
}

export function renderMarkdown(m: Matrix): string {
  const covered = (rows: Row[]): number => rows.filter((r) => r.tests.length > 0).length;
  const table = (heading: string, rows: Row[]): string[] => [
    `| ${heading} | Tests | Status |`,
    '|---|---|---|',
    ...rows.map(
      (r) =>
        `| ${r.id} | ${String(r.tests.length)} | ${r.tests.length > 0 ? 'covered' : '**NOT COVERED**'} |`,
    ),
  ];
  const details = (prefix: string, rows: Row[]): string[] =>
    rows
      .filter((r) => r.tests.length > 0)
      .flatMap((r) => ['', `### ${prefix}${r.id}`, '', ...r.tests.map((t) => `- ${t}`)]);
  const list = (items: string[]): string[] =>
    items.length > 0 ? items.map((i) => `- ${i}`) : ['None.'];
  const notCovered = (prefix: string, rows: Row[]): string =>
    rows
      .filter((r) => r.tests.length === 0)
      .map((r) => `${prefix}${r.id}`)
      .join(', ') || 'None.';

  return [
    '# Traceability matrix',
    '',
    '<!-- Generated by `pnpm test:matrix` from docs/domain-model.md and the domain Vitest results. Do not edit by hand. -->',
    '',
    'Generated by `pnpm test:matrix`. Only passing tests count. This shows **traceability, not test adequacy** —',
    'see [test strategy](test-strategy.md#traceability-is-not-adequacy).',
    '',
    '## Summary',
    '',
    `- Rules: ${String(covered(m.rules))} of ${String(m.rules.length)} covered`,
    `- Invariants: ${String(covered(m.invariants))} of ${String(m.invariants.length)} covered`,
    '',
    '## NOT COVERED',
    '',
    `- Rules: ${notCovered('', m.rules)}`,
    `- Invariants: ${notCovered('', m.invariants)}`,
    '',
    '## Rules',
    '',
    ...table('Rule', m.rules),
    '',
    '## Invariants',
    '',
    ...table('Invariant', m.invariants),
    '',
    '## Rules → tests',
    ...details('', m.rules),
    '',
    '## Invariants → tests',
    ...details('Invariant ', m.invariants),
    '',
    '## Unknown references',
    '',
    'Tests that reference a rule or invariant that does not exist in docs/domain-model.md.',
    '',
    ...list(m.unknown.map((u) => `${u.ref} — ${u.test}`)),
    '',
    '## Non-conforming test names',
    '',
    ...list(m.nonConforming.map((n) => `${n.test} (${n.reason})`)),
    '',
    '## Tests without a rule or invariant',
    '',
    ...list(m.untraced),
    '',
    '## Excluded (not counted)',
    '',
    ...list(m.excluded.map((e) => `${e.test} (${e.status})`)),
    '',
  ].join('\n');
}
