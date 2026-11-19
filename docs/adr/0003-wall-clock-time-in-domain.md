# 3. Wall-clock local time in the domain

Date: 2026-11-19
Status: Accepted

## Context
R5 gives every cleaning task a time window: `earliestStart` (departure date + checkout time) and an optional
`deadline` (next arrival date + check-in time). The business states these as local times ("out by 10:00, in at
16:00") on local dates, and the resort runs in a single zone (Europe/London). R15 requires that actual working
times are stored in UTC and that durations stay correct across BST ↔ GMT. The domain must not read the system
clock or depend on a time-zone database.

## Decision
Planning times in `packages/domain` are local wall-clock values without a zone: `LocalDate` (`YYYY-MM-DD`),
`LocalTime` (`HH:MM`) and `LocalDateTime` (`YYYY-MM-DDTHH:MM`), as branded strings. Minute differences use pure
calendar arithmetic with no DST. Adapters convert to and from UTC. "Now" still comes only from the `Clock` port.

## Alternatives considered
- UTC instants (`Date` / epoch ms) in the domain — needs Europe/London zone rules inside the domain to turn
  "16:00 on 13 Nov" into an instant, and the business never reasons in UTC.
- A date library with zones (Temporal polyfill, Luxon) — adds a dependency and zone data to a pure package for no
  benefit while the resort has one zone.

## Consequences
- Good: rules read like the manager's language; tests are plain strings; ISO strings sort chronologically.
- Good: no zone data or clock in the domain, so dependency-cruiser rules stay simple.
- Trade-off: a window that spans a DST change night is off by ±60 min. With realistic times (checkout in the
  morning, check-in in the afternoon) this never changes `tight`: a multi-day window has far more slack than
  60 min, and a same-day window does not cross the 01:00/02:00 shift.
- Trade-off: time-entry durations (R15) must be computed from UTC instants in an adapter or a separate model,
  not from these planning types.
