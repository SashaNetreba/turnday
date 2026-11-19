// Usage: node tools/traceability/src/cli.ts <vitest-report.json>...  (Node >= 22.18, run from the repo root)
// Writes docs/traceability.md. Exit 1 if a test references an unknown rule/invariant or a test failed.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  buildMatrix,
  collectTests,
  exitCode,
  parseDomainModel,
  renderMarkdown,
  type VitestReport,
} from './matrix.ts';

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const reports = process.argv.slice(2);
if (reports.length === 0) {
  console.error('usage: node tools/traceability/src/cli.ts <vitest-report.json>...');
  process.exit(2);
}

const model = parseDomainModel(
  readFileSync(new URL('../../../docs/domain-model.md', import.meta.url), 'utf8'),
);
const tests = reports.flatMap((file) =>
  collectTests(JSON.parse(readFileSync(file, 'utf8')) as VitestReport, repoRoot),
);
const matrix = buildMatrix(model, tests);

writeFileSync(new URL('../../../docs/traceability.md', import.meta.url), renderMarkdown(matrix));

const covered = (rows: { tests: string[] }[]): number =>
  rows.filter((r) => r.tests.length > 0).length;
console.log(
  `traceability: rules ${String(covered(matrix.rules))}/${String(matrix.rules.length)}, ` +
    `invariants ${String(covered(matrix.invariants))}/${String(matrix.invariants.length)} → docs/traceability.md`,
);
for (const u of matrix.unknown) console.error(`unknown reference ${u.ref}: ${u.test}`);
process.exitCode = exitCode(matrix);
