# Turnday

Housekeeping scheduler and time tracker for small cottage resorts — built as a portfolio project
around a clean, test-first architecture.

> Status: early development.

## What it does

- Generates a fair weekly cleaning schedule from guest departures (RezLynx CSV import).
- Moves cleans to the next day when the team is short and nobody arrives that day.
- Lets housekeepers start/stop work from their phone; managers see planned vs actual time.

## Getting started

Requires Node 22+ and pnpm (via `corepack enable`).

```sh
pnpm install
pnpm verify   # lint + typecheck + architecture check + unit tests
```

## Docs

- [Domain model and business rules](docs/domain-model.md)
- [Test strategy](docs/test-strategy.md) and the generated [traceability matrix](docs/traceability.md) (rule → tests)
- Architecture decisions:
  - [0001 — Hexagonal architecture with a pure domain package](docs/adr/0001-hexagonal-architecture.md)
  - [0002 — TypeScript end to end, Vitest + Playwright](docs/adr/0002-typescript-and-test-stack.md)
  - [0003 — Wall-clock local time in the domain](docs/adr/0003-wall-clock-time-in-domain.md)
  - [0004 — Plan days by headcount before assigning people](docs/adr/0004-plan-days-before-assigning-people.md)

## How this was built

Turnday is built with [Claude Code](https://claude.com/claude-code). I own the requirements, the domain rules, the
architecture decisions, the test design and the review; Claude Code writes most of the code and tests under those rules, and I review every change.

Every change goes the same way: **plan → doc → red → green → `pnpm verify` → commit approved by me**.
The plan is agreed first, the rule is written into the domain model with its ID, a failing test is shown before the code,
`pnpm verify` must exit 0, and nothing is committed without my explicit yes.

The working agreement lives in the repo:

- [CLAUDE.md](CLAUDE.md) — architecture boundaries, commands, privacy rules and how we work.
- [.claude/skills](.claude/skills) — repeatable workflows: adding a domain rule, running the quality gate, writing an ADR.
- [.claude/settings.json](.claude/settings.json) — what Claude Code may run without asking, what needs approval
  (e.g. `git commit`), and what is denied (e.g. `git push`, reading real guest exports or `.env`).
- [lefthook.yml](lefthook.yml) — git hooks enforce the gate: lint and typecheck before every commit, `pnpm verify` and a
  fresh traceability matrix before every push.
- [.claude/hooks](.claude/hooks) — a guard that blocks `git push` and hook bypasses in Claude Code's Bash commands. It
  exists because permission rules only match text: `git -C . push` slips past a `git push *` deny rule.
- [docs/test-strategy.md](docs/test-strategy.md) — test levels, principles and the test naming convention.
