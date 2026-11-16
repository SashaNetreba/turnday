---
name: domain-rule
description: Add or change a business rule of the scheduler (cleaning times, crews, deferral, rotation, overrides). Use when the user describes how scheduling should behave, e.g. "premium needs two people" or "late checkout moves the start".
---

# Add or change a domain rule

Follow these steps in order. Do not skip ahead to implementation.

1. **Find the rule** in `docs/domain-model.md`. If it is new, give it the next free ID in its section (e.g. `R5f`). If it changes an existing rule, edit that rule in place.
2. **Update the doc first**: the rule text, any entity field it needs, and an invariant in §6 if the rule must hold for every schedule. Show the user the diff of the doc and wait for a yes.
3. **Write failing tests** in `packages/domain`:
   - an example-based test named `R<id>: <behaviour in plain words>`,
   - if you added an invariant, a property-based test (fast-check) for it.
   Run them and confirm they fail for the right reason.
4. **Implement** the smallest change in `packages/domain` that makes them pass. No I/O, no framework imports, no `Date.now()`.
5. Run the `verify` skill.
6. Suggest a Conventional Commit message: `feat(domain): R<id> <summary>`.
