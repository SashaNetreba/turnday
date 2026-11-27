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

## Follow-up (2026-11-25)
The assignment step is specified (domain-model v0.5). The decision stands: both steps stay separate.
- Day planning fixes how many regular places each day has. Choosing which regulars fill them is a balanced-assignment
  problem over the whole week (R11): first maximise staffed places, then minimise the spread of shifts, then build the
  week day by day in priority order with a max-flow feasibility check. Weekend days are part of the same week (R12).
- The weekly limit of 6 shifts (R9a) depends on who works, so it is checked in the assignment step, not in day
  planning. A regular place it leaves unfilled goes to a reserve if the task cannot wait, otherwise to the shortfall
  with reason `WEEKLY_LIMIT`. A shortfall can still be found in either step.
- Trade-off accepted: day planning does not see the limit, so in principle a task that could wait would get
  `WEEKLY_LIMIT` instead of being deferred. In practice this does not happen: when the planning week starts on Monday,
  nobody can have 6 shifts before Sunday (6 shifts need 6 working days). On Sunday only tasks that cannot wait until
  Monday are planned (R5f); everything else carries over (R5g). It could only happen in a week that does not start on
  Monday, which the manager UI will not allow (domain-model §8 backlog).

## Follow-up (2026-11-27)
The assignment step is implemented (R9–R12, then R7a and R5h, domain-model v0.7). The decision stands: `scheduleWeek`
runs day planning unchanged and then assigns people.
- The R9a fallback happens in the assignment step: a regular place left unfilled by the 6-shift limit goes to a
  reserve if the task cannot wait, otherwise the task moves from `tasks` to the shortfall with reason `WEEKLY_LIMIT`.
- R7a only decides which cottage each working housekeeper cleans, after R11 has decided who works. It never changes
  what day planning staffed (invariant 18).
- The weekend alternative (R5h) is computed after day planning and the assignment, and only marks assignments as a
  suggestion; day planning still does not depend on who is free. Invariant 25's "the schedule is the same with or
  without alternatives" is not asserted by a test yet. The direct check is planned together with the manager's
  "accept / reject alternative" feature (domain-model §8 backlog).
