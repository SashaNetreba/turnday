---
name: adr
description: Write an Architecture Decision Record in docs/adr/. Use when a significant technical choice is made or changed (framework, library, data model, integration approach, testing tool).
---

# Write an ADR

1. Find the highest number in `docs/adr/` and use the next one, zero-padded: `NNNN-short-kebab-title.md` (e.g. `0005-…` after `0004-…`).
2. Use exactly this structure, short and concrete. An ADR records the decision, its context, the alternatives and the
   trade-offs — not function signatures or parameter lists; those live in the code.

```
# <number>. <Title>

Date: <YYYY-MM-DD>
Status: Accepted | Proposed | Superseded by <link>

## Context
What problem or force made a decision necessary. 3–6 sentences.

## Decision
What we chose, in one or two sentences.

## Alternatives considered
- <option> — why not

## Consequences
- Good: …
- Bad / trade-offs: …
```

3. If it replaces an older ADR, set the old one's status to `Superseded by <new>`; never delete old ADRs.
4. Add a line for it to the ADR list in `README.md`.
