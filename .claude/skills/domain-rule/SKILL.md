---
name: domain-rule
description: Add or change a business rule of the scheduler (cleaning times, crews, deferral, rotation, overrides). Use when the user describes how scheduling should behave, e.g. "premium needs two people" or "late checkout moves the start".
---

# Add or change a domain rule

Follow these steps in order. Do not skip ahead to implementation.
The testing principles behind them are in `docs/test-strategy.md`; this skill doesn't repeat them.

1. **Find the rule** in `docs/domain-model.md`. If it is new, give it the next free ID in its section (e.g. `R16`) and a
   short bold label: `- **R16. Name.** …`. The traceability test (`tools/traceability/src/matrix.test.ts`) fails for a
   §4 rule without a label. If it changes an existing rule, edit that rule in place.
2. **Update the doc first**: the rule text, any entity field it needs, and an invariant in §6 if the rule must hold for every schedule. Show the user the diff of the doc and wait for a yes.
3. **Write failing tests** in `packages/domain`:
   - an example-based test for the rule,
   - if you added an invariant, a property-based test (fast-check) for it.

   Titles follow the strict prefix in `docs/test-strategy.md` § Test naming convention (`ID / ID: behaviour`). Times
   and mentions of other rules go only after the colon.

   Test data matches real usage: planning weeks run Monday–Sunday. If a test can't be written on real data yet (it
   needs a rule that isn't built), change the commit order instead of using artificial input.

   Run them and confirm they fail for the right reason. A test that already passes before the code exists must be
   shown to bite: apply a mutation that breaks the rule, show the failure, revert.
4. **Implement** the smallest change in `packages/domain` that makes them pass. No I/O, no framework imports, no `Date.now()`.
5. **Check each property test bites.** Break the rule in the code and run the property alone 10 times, e.g.
   `for i in $(seq 10); do pnpm --filter @turnday/domain exec vitest run <file> -t "invariant <n>"; done`.
   It must fail in 10/10 runs. If not, add a focused generator branch for the boundary (e.g. the last day of the week;
   check-in at 14:29 / 14:30 / 14:31) and re-check. Revert the mutation.
6. **Check the rule text against the tests.** If a part of the rule is not exercised by any test, say so explicitly.
   That test belongs in the commit of the rule it belongs to; don't let the matrix show the rule as covered while a part
   of it is untested.
7. Run the `verify` skill.
8. Suggest a Conventional Commit message: `feat(domain): R<id> <summary>`.
