# 1. Hexagonal architecture with a pure domain package

Date: 2026-11-16
Status: Accepted

## Context
The core value of the app is the scheduling algorithm and its business rules. Booking data comes from
RezLynx via CSV today and possibly via its API later, and the UI has two very different users (manager
on desktop, housekeepers on phones). The rules must be easy to test exhaustively, including
property-based tests, without a database or a web server.

## Decision
Use ports & adapters. All business logic lives in `packages/domain` as pure TypeScript with no framework
or I/O dependencies. The API, UI, database and RezLynx integrations are adapters around it.
The boundary is enforced in CI with dependency-cruiser.

## Alternatives considered
- Layered NestJS app with logic in services — faster to start, but rules end up coupled to the framework and the ORM, and are slow to test.
- Logic in the frontend — no single source of truth; housekeeper and manager views could disagree.

## Consequences
- Good: domain tests run in milliseconds; swapping CSV for the RezLynx API touches one adapter.
- Good: the architecture is visible and explainable in an interview.
- Trade-off: more boilerplate (ports, mappers) than a quick CRUD app.
