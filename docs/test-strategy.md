# Test strategy

How Turnday is tested, what each level proves, and what is still planned.
Business rules (R1, R5a, …) and invariants (1…14) are defined in [domain-model.md](domain-model.md).
Which tests cover which rule is listed in the generated [traceability matrix](traceability.md).

## Test levels

| Level | What it proves | Tool | Status | Command |
|---|---|---|---|---|
| Static | Types are sound (`strict`, no `any`), lint rules hold, the domain never reads the system clock | TypeScript, ESLint (`strictTypeChecked`, `no-restricted-syntax` for `Date.now()` / `new Date()`) | exists | `pnpm lint`, `pnpm typecheck` |
| Unit — example | One rule, one concrete scenario with readable dates and times (e.g. "Fri 13 Nov, cottage 5") | Vitest | exists | `pnpm test` |
| Property-based | An invariant from §6 holds for any generated week of bookings and overrides | Vitest + fast-check | exists | `pnpm test` |
| Architecture | `packages/domain` stays pure: no apps, Prisma, NestJS, React or Node built-ins; no cycles | dependency-cruiser | exists | `pnpm arch` |
| Traceability | Every rule and invariant is linked to passing tests; uncovered ones are listed | `tools/traceability` (Vitest JSON report + domain-model.md) | exists | `pnpm test:matrix` |
| Mutation | Tests actually fail when domain code is changed — no vacuous passes | Stryker (ADR 0002) | planned | — |
| Integration | Adapters work against real infrastructure: Prisma on PostgreSQL, RezLynx CSV importer on `tests/fixtures/*.sample.csv` | Vitest + Testcontainers | planned | — |
| API | REST endpoints validate input, call the domain and map errors | Supertest + Testcontainers | planned | `pnpm test:api` (script not added yet) |
| E2E | Manager UI and housekeeper PWA work end to end in a browser | Playwright | planned | `pnpm test:e2e` (script not added yet) |
| Manual / UAT | The schedule makes sense to a manager for a real-looking week; start/stop works on a phone | Exploratory session with the anonymised sample week | planned | — |

`pnpm verify` (lint + typecheck + arch + unit/property tests) runs in CI on every push and pull request.
CI then runs `pnpm test:matrix` and fails if the committed `docs/traceability.md` differs from the regenerated one.

## Principles we follow

- **Doc first.** A rule is written or changed in `docs/domain-model.md` (with its ID) before any test or code. A rule that
  must hold for every schedule also gets an invariant in §6.
- **Red before green.** The test is written first and run; it must fail for the right reason before the code is written.
- **A property test per invariant.** Every invariant in §6 gets a fast-check property; example tests pin the concrete cases.
- **Determinism.** The domain never reads the clock (time comes in through the `Clock` port), so the same input gives
  the same output. Example tests use fixed dates. fast-check runs without a fixed global seed, so each run explores new
  inputs; when a property fails, fast-check prints the seed and path, and the failure is replayed with them.
- **Vacuous-pass check by mutation.** A green test only counts if it can go red: after green, the code under test is
  deliberately broken and the test must fail. Today this is done by hand; Stryker will automate it (planned).
- **Success only by exit code.** A check passes when its exit code is 0 — never by reading or grepping its output.
- **Changed expectations are justified from the rule.** If an existing test's expected value changes, the new value is
  derived from the rule (inputs, window, estimate) and shown in review, not copied from what the code returned.

## Test naming convention

Tests reference rule and invariant IDs **in the test title**, so the traceability matrix can match them reliably.

| Kind | Form | Example |
|---|---|---|
| Example test, one rule | `R<id>: <behaviour>` | `R5a: a LATE_CHECKOUT beats the booking checkoutTime` |
| Example test, several rules | `R<id> / R<id>: <behaviour>` | `R1 / R2 / R3: RezLynx sample week 13–19 Nov 2026` |
| Property test | `invariant <n> / R<id>: <property>` | `invariant 12 / R5: earliestStart is always on the departure date` |

- Rule IDs are whole tokens: `R5` never matches `R5a`, and `R5a` never matches `R5`. Separators (`/`, space, comma) don't matter.
- Invariants are written `invariant <n>` (lowercase), once per invariant: `invariant 11 / invariant 12`, never
  `invariants 11, 12`, `Invariant 11` or `inv 11`. Such near misses are reported as non-conforming.
- IDs in a `describe` title are context for the reader. They are used only when the test title has no IDs at all, and
  such tests are listed as non-conforming.
- A test that references an ID that doesn't exist in `domain-model.md` makes `pnpm test:matrix` fail.
- Tests without any ID (e.g. the package smoke test) are allowed, and they are listed in the matrix.

## Traceability is not adequacy

The matrix shows **traceability, not test quality**. A passing test named `invariant 11: …` counts as covering
invariant 11 even if its assertions are weak or check nothing. The matrix answers "is every rule linked to a test?",
not "would these tests catch a bug?". Test quality is checked by the vacuous-pass check above and, once it is set up, by
mutation testing (Stryker).

Only **passing** tests count. Skipped and todo tests are listed separately and don't count as coverage.

## How to run

Requires Node **>= 22.18** (`engines` in `package.json`, enforced by `engine-strict`): `pnpm test:matrix` runs a
TypeScript file directly with Node's built-in type stripping. `.nvmrc` stays on `22` so CI gets the latest 22.x patches.

| Level | Command | Notes |
|---|---|---|
| Everything required before a commit | `pnpm verify` | lint + typecheck + arch + unit/property tests |
| Lint / types | `pnpm lint`, `pnpm typecheck` | |
| Unit + property tests | `pnpm test` | all workspace packages |
| One domain test file | `pnpm --filter @turnday/domain exec vitest run src/R5a.time-overrides.test.ts` | |
| Domain coverage | `pnpm --filter @turnday/domain test:coverage` | line/branch coverage, not mutation |
| Architecture | `pnpm arch` | |
| Traceability matrix | `pnpm test:matrix` | runs the domain tests, writes `docs/traceability.md`; commit the result |
| Mutation, integration, API, E2E | — | planned, see the table above |
