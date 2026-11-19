# Turnday — housekeeping scheduler

Portfolio project: a scheduling and time-tracking app for a small cottage resort.
Bookings come from Guestline RezLynx (CSV export today, API later).
The domain rules are in `docs/domain-model.md` — read it before changing anything in `packages/domain`.

## Architecture (hexagonal / ports & adapters)

```
apps/web        React + Vite (manager UI + housekeeper mobile PWA)
apps/api        NestJS REST API — thin: validates input, calls the domain, maps errors
packages/domain pure TypeScript business logic — NO framework, NO I/O, NO Date.now()
infrastructure  adapters: Prisma/PostgreSQL, RezLynx CSV importer, (later) RezLynx API
```

Hard rules:
- `packages/domain` must not import from `apps/*`, Prisma, NestJS, React or Node built-ins (`fs`, `http`). This is enforced by dependency-cruiser in CI — never weaken that config to make a build pass.
- The domain talks to the outside world only through **ports** (interfaces) defined in `packages/domain`. Adapters implement them.
- Time is passed in (a `Clock` port), never read from the system inside the domain. Store UTC, display Europe/London.
- Every business rule in `docs/domain-model.md` has an ID (R1, R5c…). Tests reference that ID in their name.

## Commands

- `pnpm install` — install
- `pnpm lint` / `pnpm typecheck` — static checks
- `pnpm test` — unit tests (Vitest)
- `pnpm test:api` — API tests (Supertest + Testcontainers, needs Docker)
- `pnpm test:e2e` — Playwright
- `pnpm verify` — lint + typecheck + unit tests (run before every commit)

## How we work

- Test first for domain logic: write the failing test, then the code.
- Small commits, Conventional Commits (`feat(domain): …`, `test(importer): …`, `docs(adr): …`).
- Significant technical decisions get an ADR in `docs/adr/` (use the `/adr` skill).
- Prefer plain functions and small types over classes in the domain.
- No `any`. `strict: true` in every tsconfig.
- Run repo tools with `pnpm exec <tool>` (or a `pnpm` script), never `npx`.

## Privacy — non-negotiable

- Real RezLynx exports contain guest names. They never enter the repo. Only `tests/fixtures/*.sample.csv` (anonymised) is committed.
- The importer must never read or store `GuestName`, rates, totals, GDS/CRS refs.
- Seed data uses fictional housekeeper names.
- No secrets in code; config via `.env` (git-ignored), with `.env.example` committed.
