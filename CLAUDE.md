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
- Time is passed in, never read from the system inside the domain. A `Clock` port is planned; it comes with the
  API/adapters. Store UTC, display Europe/London.
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
- Git hooks (`lefthook.yml`) and a Claude Code Bash guard (`.claude/hooks/guard-bash.js`) enforce the gate and block
  push. Never bypass them (`--no-verify`, `commit -n`, `LEFTHOOK=0`, `core.hooksPath`, `lefthook uninstall`).

## Before every commit

- Show the red run (the new test failing for the right reason) and the green run.
- For verification steps (grep, `pnpm test:matrix`, test counts) show the command output, not only the conclusion.
- Report every deviation from the approved plan before asking to commit — even when it is an improvement.
- Show `git status --short`, and name the files explicitly in `git add` (no `git add .` / `-A`).
- If an existing test's expected value changes, justify the new value from the rule (inputs, window, estimate),
  not from what the code returned.
- Don't claim a guarantee ("can't drift", "always", "never") unless a check enforces it — name that check.
- Wait for the user's explicit "yes" before `git commit`.

## After the last commit

- Never offer to push. After the last commit, prepare the PR text with a "Known gaps" section. Claim only what
  happened: "each feat commit had a red run", not "each commit".

## Privacy — non-negotiable

- Real RezLynx exports contain guest names. They never enter the repo. Only `tests/fixtures/*.sample.csv` (anonymised) is committed.
- The importer must never read or store `GuestName`, rates, totals, GDS/CRS refs.
- Seed data uses fictional housekeeper names.
- No secrets in code; config via `.env` (git-ignored). `.env.example` will be added with the first env variable
  (`.gitignore` already has the `!.env.example` exception).
