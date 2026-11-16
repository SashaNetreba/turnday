# 2. TypeScript end to end, Vitest + Playwright for tests

Date: 2026-11-16
Status: Accepted

## Context
The project doubles as an SDET portfolio for the UK market. In UK job ads (ITJobsWatch, 6 months to
Nov 2026) Playwright roles doubled year on year while Selenium roles fell, and Playwright ads most
often ask for JavaScript/TypeScript. One language across product and tests also keeps the repo simple.

## Decision
TypeScript (strict) everywhere, pnpm workspaces monorepo. Vitest + fast-check for unit and property-based
tests, Supertest + Testcontainers for API tests, Playwright for E2E, Stryker for mutation testing of the domain.

## Alternatives considered
- Java + Selenium — still common in London enterprise roles, but a declining tool and a second language for the product.
- Python + pytest — strong in test automation ads, but would split product and tests across languages.

## Consequences
- Good: one toolchain; tests can import domain types directly.
- Trade-off: Java/Selenium experience is shown elsewhere in the CV, not in this repo.
