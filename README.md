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
- Architecture decisions:
  - [0001 — Hexagonal architecture with a pure domain package](docs/adr/0001-hexagonal-architecture.md)
  - [0002 — TypeScript end to end, Vitest + Playwright](docs/adr/0002-typescript-and-test-stack.md)
