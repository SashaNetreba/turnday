# 4. Plan days by headcount before assigning people

Date: 2026-11-20
Status: Accepted

## Context
Deferral (R5c–R5g) decides on which day each cleaning task is done. It depends only on how many housekeepers are
free each day (R10a), not on who they are. Assigning people (premium crews R7/R7a, one task per day R9,
availability R10, fairness R11, weekend rotation R12) is a different problem and isn't modelled yet. Deferral also
chains, so a task can still be waiting after the planning week ends (R5g). The domain is pure and keeps no state
(ADR 0001), so whatever carries over into the next week must travel through the function's input and output.

## Decision
Plan days by headcount before assigning people. First, each task's planned day is fixed from the number of
housekeepers available per day only. Then, in a later step, people are assigned to the tasks planned for each day.
Tasks carried over to the next week are an explicit output that becomes the next week's input; the domain keeps no
hidden state between weeks.

## Alternatives considered
- One combined solver for days and people — needs R7–R12 before deferral can ship, and is harder to test one rule at a time.
- Deferral limited to the planning week (overflow → shortfall) — no state across weeks, but it reports false shortages
  for tasks that could simply wait until next Monday (e.g. Sunday departures under R5f).
- The domain loads the previous week itself through a repository port — hides an input, so the same arguments
  might not give the same plan (invariant 7).

## Consequences
- Good: deferral, shortfall, weekend and carry-over can be built and property-tested now, with a single number per day as input.
- Good: the assignment step gets a fixed per-day task list whose crew sizes never exceed the headcount (invariant 1).
- Trade-off: the headcount ignores who is available. A day can have enough people by count but no valid premium crew
  (for example, only one `PAIR_ONLY` housekeeper is free, R7). The assignment step will have to report that as a
  shortfall too, so a shortfall can be found in either step.
- Trade-off: callers must store `carriedOver` and pass it back for the next week. Reconciling it with work actually
  done is in the backlog (domain-model §8, R13–R15).

## Follow-up (2026-11-23)
The crew rules changed (domain-model v0.4): PAIR_ONLY is dropped, any housekeeper cleans any cottage alone (R7). The
trade-off above about a missing premium crew no longer applies. The decision stands: by R10b the headcount has two numbers
per day, regular and reserve, and the reserve is called only for tasks that cannot be deferred. Who cleans what
(stable first, R7a; which reserve is called, R10b) remains the assignment step.
