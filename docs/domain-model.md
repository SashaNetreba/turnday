# Domain Model — Housekeeping Scheduler

> Status: **v0.7 — ready for implementation** · Owner: Oleksandra Netreba
> This document describes the business domain independently of any framework, database or UI.
> Everything here lives in `packages/domain` and is covered by unit and property-based tests.

---

## 1. Context

A small cottage resort needs a weekly cleaning schedule for its housekeeping team.
Bookings are managed in an external PMS (Guestline RezLynx). The number of cleanings
per day depends entirely on guest departures, so the size of the team on duty changes
week to week — from ~3 days per person in low season to ~6 days in high season.

Goals:

1. **Generate** a fair schedule automatically (Mon–Fri by demand; Sat–Sun only for tasks that cannot wait
   until Monday (R5f), staffed by the same even distribution as weekdays (R11, R12)).
2. **Track** actual working time (start / stop per cottage).
3. Stay **source-agnostic**: bookings come from a CSV export today and may come from an API later.

---

## 2. Ubiquitous language

| Term | Meaning |
|---|---|
| **Cottage** | A unit guests stay in. Identified by a number. |
| **Cottage type** | `STABLE` or `PREMIUM`. Defines cleaning effort and crew size. |
| **Schedulable** | Whether the cottage takes part in scheduling (e.g. staff accommodation does not). |
| **Booking** | A stay in one cottage with an arrival and a departure date. Imported from the PMS. |
| **Departure clean** | The full clean after guests check out. The only cleaning type in v1. |
| **Housekeeper** | A team member who cleans cottages. |
| **Shift** | One housekeeper working on one date. |
| **Assignment** | A housekeeper assigned to a cleaning task on a date. |
| **Crew** | The housekeepers assigned to one cleaning task (1 by default, 2 when the manager raises it, R8). |
| **Weekend rotation** | Fair turn-taking for Saturday/Sunday shifts — chosen by the even distribution of the same week (R11, R12). |
| **Weekly limit** | At most 6 shifts per housekeeper in a planning week — at least one day off (R9a). |
| **Spread** | `U − L`: the gap between the upper and lower bound on regular housekeepers' weekly shifts (R11). |
| **Time entry** | Actual start/stop recorded by a housekeeper for an assignment. |
| **Headcount** | Regular and reserve housekeepers available on a date, counted separately — derived from Housekeeper + Availability (R10); input to day planning (R10a, R10b). |
| **Regular housekeeper** | A housekeeper who is not a reserve. |
| **Reserve housekeeper** | Called only for a task that cannot wait (R10b). |
| **Reserve call** | An assignment to a reserve housekeeper; the manager confirms it (R10b). |
| **Workday start** | Time housekeepers start work; the start of a deferred task's window (R5c). |
| **Deferral** | Cleaning a task on a later day than its departure (R5c). |
| **Shortfall** | A task that cannot be staffed before its deadline — reported, never dropped (R10a). |
| **Week schedule** | `WeekSchedule`: the week plan (tasks per day, shortfall, carry-over) plus who cleans each task (ADR 0004, step 2: R9, R9a, R11, R12). |
| **Carry-over** | A task still waiting after the planning week; it moves into the next week's planning (R5g). |
| **Weekend alternative** | A weekday on which a free reserve could have cleaned a task that was deferred onto Saturday or Sunday. The manager chooses; the plan is unchanged (R5h). |

---

## 3. Entities

```
Cottage
  number: int                 # 1..15, 13 does not exist
  type: STABLE | PREMIUM
  schedulable: boolean
  note?: string

Booking
  externalRef: string         # PMS booking reference
  cottageNumber: int
  arrivalDate: date
  departureDate: date
  checkoutTime?: time         # overrides SchedulingConfig.defaultCheckoutTime (10:00), e.g. 11:00
  checkinTime?: time          # overrides SchedulingConfig.defaultCheckinTime (16:00)
  status: CONFIRMED | CHECKED_OUT | CANCELLED

TimeOverride                  # R5a: set by the manager in the app, survives CSV re-imports
  bookingRef                  # Booking.externalRef
  kind: LATE_CHECKOUT | EARLY_CHECKIN
  time: time
  setBy, setAt                # storage metadata only — kept by the adapter, not passed into the domain

Housekeeper
  id
  displayName
  stableFirst: boolean        # R7a, set by the manager
  reserve: boolean            # R10b, set by the manager; both flags on one housekeeper → invalid input
  active: boolean

Availability                  # R10: required for every active housekeeper on every day of the planning
                              # week, reserves included; who entered it is not a domain concern (§8 backlog)
  housekeeperId
  date
  available: boolean          # days off, holidays, sickness

CleaningTask                  # derived from bookings, never entered manually
  bookingRef                  # Booking.externalRef of the departing booking (lowest among duplicates, R1)
  cottageNumber
  cottageType: STABLE | PREMIUM # R4: the cottage's type; R7a chooses by it
  kind: DEPARTURE
  departureDate               # when the guest leaves
  plannedDate                 # when it is cleaned (= departureDate, or later if deferred, R5c)
  deferred: boolean           # ⇔ plannedDate > departureDate (invariant 15)
  estimatedMinutes: int
  requiredCrewSize: 1 | 2     # R6: always 1; only R8 raises it
  earliestStart: datetime     # local wall-clock YYYY-MM-DDTHH:MM: departure date + checkout time (incl. late checkout)
  deadline?: datetime         # local wall-clock: next arrival into this cottage + check-in time (incl. early check-in);
                              # empty if no next arrival is known
  tight: boolean              # R5: deadline exists and (deadline − windowStart − estimatedMinutes) ≤ 0
  atRisk: boolean             # R5b: deadline exists and (deadline − windowStart) < estimatedMinutes
                              # windowStart = earliestStart, or plannedDate + workdayStart if deferred (R5c)

SchedulingConfig              # passed into the domain, never hard-coded there
  estimatedMinutes: { STABLE: int, PREMIUM: int }   # R4, planning values (upper bound)
  defaultCheckoutTime: time   # R5
  defaultCheckinTime: time    # R5
  workdayStart: time          # R5c: housekeepers start work; start of a deferred task's window

Headcount                     # R10a: input to day planning, one entry for every day of the planning week;
                              # derived from Housekeeper + Availability by R10
  date
  regular: int >= 0           # regular housekeepers available that day
  reserve: int >= 0           # reserve housekeepers available that day (R10b)

WeekPlan                      # output of day planning (ADR 0004, step 1: R5c–R5g, R10a, R10b)
  tasks: [CleaningTask]       # staffed, plannedDate within the week
  days: [{ date, needed, regular, reserve, reserveCalls }]
                              # needed = Σ requiredCrewSize of that day's candidates;
                              # on Sat/Sun only those that cannot wait until Monday (R5f)
                              # reserveCalls = tasks staffed by a reserve that day (R10b)
  shortfall: [{ task, reason: NO_STAFF | DEADLINE_PASSED | WEEKLY_LIMIT, lastPossibleDate? }]
                              # lastPossibleDate (NO_STAFF): last day the task could still have been cleaned
                              # WEEKLY_LIMIT (R9a): found when people are assigned — a 7th shift would staff it
  carriedOver: [CleaningTask] # still waiting after the week's last day → input to the next week (R5g)

WeekSchedule                  # output of scheduleWeek (ADR 0004, step 2: R9, R9a, R11, R12) = WeekPlan +
  assignments: [Assignment]   # who cleans each staffed task; WEEKLY_LIMIT tasks (R9a) leave `tasks` for `shortfall`

Assignment
  task: CleaningTask          # the staffed task, as in shortfall entries
  housekeeperIds: [id]        # crew
  manualOverride: boolean     # e.g. manager added a 2nd person because it's very dirty
  needsReserveCall: boolean   # R10b: ⇔ the crew includes a reserve (day-planning call or R9a fallback);
                              # the manager confirms the call
  weekendAlternative?:        # R5h: only on a task deferred onto Saturday or Sunday
    { date, housekeeperIds }  # the earliest weekday a reserve was free, and that reserve (requiredCrewSize ids)

TimeEntry
  assignmentId
  housekeeperId
  startedAt: datetime (UTC)
  stoppedAt?: datetime (UTC)
```

### Reference data (seed)

| Cottages | Type | Schedulable |
|---|---|---|
| 1–10 | STABLE | yes |
| 11, 12, 15 | PREMIUM | yes |
| 14 | STABLE* | **no** — staff accommodation |
| 13 | — | does not exist |

\* type of cottage 14 to be confirmed; irrelevant while it is not schedulable.

| SchedulingConfig (seed) | Value |
|---|---|
| `estimatedMinutes.STABLE` | 270 (4.5 h — upper bound of 4–4.5 h) |
| `estimatedMinutes.PREMIUM` | 300 (5 h) |
| `defaultCheckoutTime` | 10:00 |
| `defaultCheckinTime` | 16:00 |
| `workdayStart` | 10:00 |

---

## 4. Business rules

### Cleaning demand
- **R1. One task per departure.** A `CleaningTask` is created for every booking whose `departureDate` falls in the planning week
  and whose status is not `CANCELLED`.
  - The **planning week** is 7 consecutive days starting on a given date (start and start + 6 inclusive); it is not tied to a weekday.
  - A booking with `departureDate <= arrivalDate` is **invalid** and is skipped.
  - Several bookings for the same cottage with the same `departureDate` produce **one** task.
    Among duplicates the booking with the **lowest `externalRef`** is kept (plain string order); it becomes the
    task's `bookingRef`, independent of input order.
- **R2. No clean without a departure.** Empty cottages (no departure that day) are **not** cleaned. Occupied cottages (stayovers) are **not** cleaned either.
- **R3. Non-schedulable cottages.** Non-schedulable cottages never produce tasks, even if a booking exists.
- **R4. Estimated effort.** Estimated effort: `STABLE` ≈ 4–4.5 h, `PREMIUM` ≈ 5 h. Planning uses the upper bound — every task gets
  `estimatedMinutes` from `SchedulingConfig.estimatedMinutes` by cottage type (seed: 270 / 300). Configurable, never hard-coded.
- **R5. Time window.** A task cannot start before the guest's checkout time and must be finished before the **next** guest's check-in.
  - `earliestStart = departureDate + (booking.checkoutTime ?? defaultCheckoutTime)` (default 10:00; 11:00 or other times per booking).
  - `deadline = next arrival date + (that booking's checkinTime ?? defaultCheckinTime)` (default 16:00). The **next arrival** is the
    earliest non-cancelled, valid booking for the same cottage with `arrivalDate >= departureDate`. If several arrive that day,
    the earliest check-in counts. No next arrival known → **no deadline**.
  - **Precedence** for check-out and check-in times (highest first): manager override (R5a, `TimeOverride`)
    → booking `checkoutTime` / `checkinTime` → `SchedulingConfig` default.
  - When several bookings collapse into one task (R1), the **latest** checkout time counts.
  - A task is **tight** when it has a deadline and `deadline − earliestStart − estimatedMinutes ≤ 0`. A task without a deadline is never tight.
    ⚠ Premium with an 11:00 checkout and a same-day arrival has zero slack (11:00 + 300 min = 16:00) → tight.
  - Times in the domain are **local wall-clock** (date + `HH:MM`), with no time zones; adapters convert to/from UTC (R15).
  - **Input coverage:** the bookings passed in must cover at least the planning week **plus the following days up to each
    cottage's next arrival**. With a too-short export a task **silently gets no deadline and is therefore never tight** —
    a known limitation of the input, not detected by the domain (see §8 backlog).
- **R5a. Late checkout / early check-in.** The manager can set a late checkout or an early check-in on a booking in the app. These overrides change `earliestStart` / `deadline`, are stored separately from imported data, and survive CSV re-imports.
  - Overrides are a **pure input** to the domain (`bookingRef`, `kind`, `time`); storing them, `setBy` / `setAt` and
    surviving re-imports (invariant 10) are the adapter's job.
  - A `LATE_CHECKOUT` replaces the checkout time of the booking that **departs**; an `EARLY_CHECKIN` replaces the check-in
    time of the booking that **arrives**. Both may be set on the same booking — they act on different ends of the stay.
  - The override **always wins** over the booking time and the default, even when it points the "wrong" way
    (e.g. a `LATE_CHECKOUT` earlier than the booking's checkout).
  - The effective time is resolved **per booking first** (`override ?? booking time ?? default`), then the R5 rules apply:
    among collapsed departures (R1, invariant 11) the **latest** checkout counts, among same-day arrivals the **earliest**
    check-in counts. So an override on any of the collapsed bookings counts, but an override earlier than another collapsed
    booking's checkout does not pull `earliestStart` forward.
  - An override whose booking is unknown, cancelled or invalid is **ignored** (such a booking neither departs nor arrives, R1).
    A `LATE_CHECKOUT` on a booking that produces no task in the planning week is ignored. An `EARLY_CHECKIN` counts
    whenever its booking is the next arrival for a task in the week, even if that booking departs outside the week.
    The domain does not report ignored overrides (see §8 backlog).
  - Storage keeps at most one override per `(bookingRef, kind)` — setting a new one replaces the old. If duplicates still
    reach the domain, it resolves them conservatively and deterministically: the **latest** `LATE_CHECKOUT` and the
    **earliest** `EARLY_CHECKIN` win. The order of the overrides never changes the result.
- **R5b. At risk.** A task is **at risk** when it has a deadline and its window is shorter than the estimate:
  `deadline − earliestStart < estimatedMinutes` — one person cannot finish it in time. This holds whatever shortened the
  window (override, booking time or default). A task without a deadline is never at risk.
  - Zero slack (window = estimate) is **tight** but not at risk. Every at-risk task is also tight.
  - A **negative window** (e.g. late checkout 15:00 and the next guest's early check-in 12:00 the same day) keeps the task
    with its true times; it is at risk and tight. An at-risk task is **never silently dropped**.
  - A crew of 2 for an at-risk task is set by the manager (R8); planning does not raise it.

### Deferral
- **R5c. Deferral.** Tasks are planned day by day through the planning week. A day's **candidates** are the tasks
  departing that day plus every task still waiting from earlier days (deferred, or carried over, R5g). They are
  staffed in priority order (R5d) while housekeepers are free; a task takes `requiredCrewSize` of the day's headcount (R10a).
  A candidate that is not staffed:
  - is **deferred** to the next day if it can still be finished there: it has no deadline, or
    `next day + workdayStart + estimatedMinutes ≤ deadline`. The arrival day itself counts when the clean fits before
    check-in (seed: stable 10:00 + 270 = 14:30, premium 15:00, both ≤ 16:00);
  - otherwise goes to the **shortfall** report (R10a) with reason `NO_STAFF`.
  - Deferral **chains**: a task waits until the first day a housekeeper is free for it; a task without a deadline
    waits as long as it takes. A task with a same-day arrival can never be deferred.
  - On the departure day no deadline check applies: the task is staffed if a housekeeper is free, even when its
    window is shorter than the estimate (it is at risk, R5b).
  - Deferral never changes `departureDate` or `earliestStart`. A task cleaned later gets `plannedDate` = that day and
    `deferred = true`. Its `tight` / `atRisk` are recalculated with the window starting at `plannedDate + workdayStart`.
    By the deferral condition a deferred task is **never at risk**; with zero slack it is tight.
  - So a task is deferred only when its departure day had no housekeeper left for it (R5d) or was a weekend day it
    could wait through (R5f), and only while it can still be finished before the next arrival.
- **R5d. Priority.** A day's candidates are ordered in two groups: first the tasks that **cannot be deferred** to the
  next day (R5c), then the tasks that can. Within each group by **deadline, earliest first**, tasks without a deadline
  last; ties by **cottage number, lowest first**, then by departure date. The same order decides who is staffed and
  who waits:
  - a task with a same-day arrival is staffed before any task that can wait (it cannot be deferred);
  - a task that can wait never takes a housekeeper from a task that cannot, even when its deadline is earlier
    (stable and premium estimates differ);
  - on a short day the tasks that can wait longest move: no deadline first, then the latest deadline; on a tie the
    higher cottage number moves;
  - when even the tasks that cannot wait don't all fit, the ones with the latest deadline go to shortfall.
  Example: one housekeeper on Monday; cottage 3 (stable) and 11 (premium) depart Monday, next arrivals Tuesday 14:35
  and 14:50. 3 fits on Tuesday (10:00 + 270 = 14:30 ≤ 14:35), 11 does not (10:00 + 300 = 15:00 > 14:50) → 11 is
  cleaned on Monday, 3 is deferred to Tuesday, no shortfall.
- **R5e. Deferred tasks on the new day.** Deferred tasks compete with that day's own tasks in the same order (R5d) — no separate
  queue. A deferred task does not jump ahead of a task with an earlier deadline in its group.
  Example: Monday's cottage 3 (next arrival Wednesday 16:00) is deferred to Tuesday. On Tuesday it competes for the last
  housekeeper with cottage 6, which departs Tuesday and has an arrival Tuesday 16:00 → 6 is staffed; 3 moves to
  Wednesday (10:00 + 270 = 14:30 ≤ 16:00).
- **R5f. Weekend.** Saturday and Sunday are days off (by calendar weekday, wherever the planning week starts).
  On a weekend day a candidate is staffed only if it **cannot wait until Monday**: it has a deadline and
  `following Monday + workdayStart + estimatedMinutes > deadline`. Such a task is cleaned as early as possible —
  on its departure day if a housekeeper is free, otherwise on the next day it still fits before the deadline; if
  none → shortfall. Every other weekend candidate is deferred to Monday, even if housekeepers are free, and competes
  there by R5d. Who works the weekend is decided by the rotation (R12).
  On a Saturday or Sunday, **staff needed** (R10a) counts only the candidates that cannot wait until Monday; tasks
  deferred to Monday by this rule are not needed that day.
  Examples:
  - Sunday departures from 2, 4, 7, 8; only 7 has an arrival on Sunday 16:00 → only 7 is cleaned on Sunday;
    2, 4 and 8 move to Monday. With one housekeeper on Sunday: needed 1, available 1, no shortage.
  - Cottage 5 out Saturday, in Sunday 16:00: a free housekeeper on Saturday → Saturday; nobody free on Saturday →
    Sunday (10:00 + 270 = 14:30 ≤ 16:00); nobody on Sunday either → shortfall.
- **R5g. Carry-over.** A task still waiting after the planning week's last day is **not** a shortfall: it is returned
  in `carriedOver` (`deferred = true`, `plannedDate` = the next week's first day = week start + 7, `tight` / `atRisk`
  recalculated for that day as for any deferred task, R5c) — only if it still fits there; otherwise it is a shortfall.
  Planning accepts the previous week's `carriedOver` as input; carried tasks are
  candidates from the week's first day and ordered by R5d with the others. A carried task that can no longer be
  finished on the week's first day (`start + workdayStart + estimatedMinutes > deadline`) goes to shortfall with reason
  `DEADLINE_PASSED`. A carried task must have departed before the week starts, and two carried tasks for the same
  cottage and departure date are not allowed (invariant 11); otherwise the input is invalid.
- **R5h. Weekend alternative.** The plan stays as it is: a task that can wait may still be deferred onto Saturday or
  Sunday (R5c, R5f). But when a task that was **deferred** is planned on a Saturday or Sunday, and a reserve
  housekeeper was **free** on a weekday from its departure date up to the day before its planned date (within the
  planning week), the task is marked with a **weekend alternative**: the **earliest** such weekday (departure day
  first) and that reserve.
  - **Free** means: active, available that day, not assigned that day, and fewer than 6 shifts this week, counting
    alternatives already offered as shifts (R9a). Among several free reserves the one with the fewest shifts this week
    (offers included) is offered; ties by lowest id (as in R10b).
  - **Only weekend deferrals.** A task deferred onto a weekday, or cleaned on its departure day, never gets one.
  - **The alternatives fit together.** Weekend tasks are taken in planned-date order, then R5d order; a reserve is
    offered at most once per weekday. So the manager can accept every alternative and R9 and R9a still hold.
  - **A suggestion, not a reserve call.** R10b and invariant 17 apply to the schedule, which does not change. The
    manager chooses in the UI later (§8 backlog).
  Example (week Mon 7 – Sun 13 Dec 2026): Friday 11 has 6 departures and 5 regulars; five of the cottages have
  arrivals that day. Cottage 12's next guest arrives Saturday 12 at 16:00. It fits on Saturday
  (10:00 + 300 = 15:00 ≤ 16:00) but cannot wait until Monday, so it is deferred to Saturday. Reserve R was free on
  Friday → alternative "Friday 11, R".

### Crew
- **R6. Default crew size.** Default crew size is 1 (one housekeeper — one cottage), for stable **and** premium. Every task gets
  `requiredCrewSize = 1`; only R8 may raise it.
- **R7. Any housekeeper, any cottage.** A housekeeper cleans any cottage alone, stable or premium (crew of 1, R6).
  There is no pair-only rule.
- **R7a. Stable first.** Applies after the day's tasks are decided (R5d, R5c, R10b) and after R11 has decided **who**
  works today. R7a only decides **which cottage** each working housekeeper cleans: first among the tasks staffed by
  regular places that day, then by a swap with a reserve (below). `stableFirst` never makes a housekeeper skip a
  shift, and never changes which tasks are staffed, deferred or in shortfall (invariant 18).
  - **Stable order:** latest deadline first — a task with no deadline counts as latest, so a task with no arrival today
    always comes before one with an arrival today; on a tie, lowest cottage number first.
  - **`stableFirst` housekeepers come first.** A working housekeeper with `stableFirst` **always** gets a stable task —
    the first one left in stable order — unless more `stableFirst` housekeepers work than there are stable tasks. Then
    the ones with the **fewest shifts this week** (before today; ties by lowest id) go without and take premium
    tasks. The others choose in the order **most shifts this week first** (the most tired gets the calmest), ties by
    lowest id.
  - **Other working regulars.** Premium tasks, in R5d order, each go to the one who has had the **fewest premium tasks
    this week** (before today); ties by lowest id. Then the remaining stable tasks, in R5d order, go to the rest by
    lowest id.
  - **Leftover premium.** `stableFirst` housekeepers without a stable task take the premium tasks the others did not,
    in R5d order — fewest shifts this week first, ties by lowest id.
  - **Before a reserve.** If a `stableFirst` regular then has a premium task while a reserve cleans a stable task that
    day, they swap — only when **both** tasks cannot wait (R5c), so the reserve still cleans only a task that cannot
    wait (R10b). Several pairs: the `stableFirst` housekeepers in the order they took premium, the reserves' stable
    tasks in stable order. The swap changes only who cleans which cottage; `needsReserveCall` follows the crew and the
    day's `reserveCalls` stays the same.
  Examples (cottages 1–10 stable; 11, 12, 15 premium):
  - Monday: departures 11, 12, 15, all with arrivals today, no stable departures. The `stableFirst` housekeeper and two
    other regulars work → the two others take 11 and 12, she takes 15. The reserve is not called.
  - Monday: departures 3 (stable) and 11 (premium). The `stableFirst` housekeeper and one other regular work → she gets
    3, the other gets 11.
  - Monday: departures 3 (stable, arrival today), 5 (stable, no arrival today) and 11 (premium, arrival today). The
    `stableFirst` housekeeper and one other regular work → 5 is deferred to Tuesday (R5d), she gets 3, the other gets 11.
    The reserve is not called.
  - Week from Monday: the `stableFirst` housekeeper is unavailable Monday and Tuesday; regular B works both days.
    Wednesday only cottage 11 (premium) departs, both are available, no other departures that week → R11 picks her
    (0 shifts vs 2), so she cleans 11. Her flag does not hand the shift to B.
  - Monday: stable 4 (next arrival Wednesday), 6 (no next arrival known) and 8 (next arrival Thursday) depart; the
    `stableFirst` housekeeper and two others work → she gets 6 (no deadline counts as latest).
  - Premium fairness: A and B, no flags. Monday 3 (stable) and 11 (premium) depart, Tuesday 4 and 12, all with
    arrivals that day → Monday A gets 11 (both 0 premium, lowest id), B gets 3; Tuesday B gets 12 (0 premium vs
    A's 1), A gets 4.
  - Several `stableFirst`: S1 (2 shifts so far) and S2 (1 shift) work; one stable and one premium task today → S2
    (fewest shifts) takes the premium task, S1 gets the stable one.
  - Before a reserve: Monday, S (`stableFirst`) is the only regular, reserve R is available. Cottage 11 has an early
    check-in today at 15:30 (10:00 + 300 = 15:00 ≤ 15:30), cottage 3 an arrival today at 16:00; neither can wait.
    By R5d, 11 (15:30) takes S's regular place and 3 needs the reserve → they swap: S cleans 3, R cleans 11, and R's
    call still needs confirming.
- **R8. Manual crew of 2.** The manager can manually raise any task's crew to 2 (e.g. very dirty) — this is a `manualOverride` and is preserved when the schedule is regenerated.

### Capacity
- **R9. One clean per housekeeper per day.** A housekeeper takes at most **one** cleaning task per day. This follows from R4 + R5: the earliest start is 10:00, one clean takes ≥ 4 h, so a second clean could not finish by 16:00.
- **R9a. Weekly rest.** A housekeeper — regular or reserve — works at most **6 shifts** in the planning week (at least
  one day off). The limit is checked when people are assigned (ADR 0004, step 2), not when days are planned.
  - A regular place left unfilled by the limit (R11) goes to an available reserve under the limit who is not already
    called that day (R10b), if the task **cannot wait**. Only if there is none, the task goes to the shortfall with
    reason `WEEKLY_LIMIT` — distinct from `NO_STAFF`, so the manager sees that a 7th shift would solve it. When a day
    has fewer places than tasks, the tasks last in R5d order lose the places.
  - The limit applies to reserve calls from day planning (R10b) too: the reserve is chosen among the available reserves
    under the limit; if every one of them already has 6 shifts, the task goes to the shortfall with reason
    `WEEKLY_LIMIT`.
  - Why a task that could wait never reaches `WEEKLY_LIMIT` in practice: when the planning week starts on Monday,
    nobody can have 6 shifts before Sunday (6 shifts need 6 working days). On Sunday only tasks that cannot wait until
    Monday are planned (R5f); everything else carries over (R5g). So `WEEKLY_LIMIT` can only happen on Sunday, for a
    task that cannot wait. In a week that does not start on Monday a task that could wait might reach it; the manager
    UI will not allow such weeks (§8 backlog).
  - A manual 7th shift set by the manager is out of scope for v1 (§8 backlog).
  Example: week from Monday; A is the only regular, available every day, no reserve. Cottages 1–5 depart Monday to
  Friday and 6 on Saturday, each with an arrival the same day → A cleans one per day (6 shifts). Sunday cottage 7
  departs with an arrival Sunday 16:00 → `WEEKLY_LIMIT` shortfall.
- **R10. Unavailable days.** A housekeeper is never scheduled on a day they are unavailable.
  - Planning takes the housekeepers and their availability for every day of the planning week. Who entered it
    (manager or housekeeper) is not the domain's concern.
  - Missing availability for an **active** housekeeper on any day of the week makes the input **invalid**: it is
    rejected with the list of housekeepers and dates affected. A missing entry is never treated as available or
    unavailable. Inactive housekeepers are not counted and need no availability.
  - Two entries for the same housekeeper and date, an entry for an unknown housekeeper id, or two housekeepers with
    the same id make the input **invalid** too; the error lists them. Entries for dates outside the planning week are
    ignored.
  - The headcount (R10a) is derived from it: `regular` / `reserve` = active housekeepers without / with `reserve`
    available that day.
  Examples (week from Mon 30 Nov 2026; A and B regular, R reserve):
  - A has no entry for Tue 1 Dec → invalid input "A: 2026-12-01". With every entry present and all three available
    on Monday → Monday's headcount is `{ regular: 2, reserve: 1 }`.
  - B has two entries for Wed 2 Dec and there is an entry for unknown id X on Thu 3 Dec → invalid input listing
    "B: 2026-12-02 (twice)" and "X: unknown housekeeper". An entry for A on Mon 7 Dec (next week) is ignored.
  - Two housekeepers with id A → invalid input "A: duplicate housekeeper id".
- **R10a. Shortfall.** Planning takes a **headcount** for every day of the planning week (housekeepers available,
  integer ≥ 0). A missing day, or a negative or non-integer count, makes the input **invalid**: it is rejected
  with the list of affected dates, never treated as 0. A day given twice is invalid too; dates outside the week are
  ignored. A task in `tasks` that departs outside the planning week makes the input invalid instead of being dropped.
  This check applies to `tasks` only: tasks carried over from the previous week (R5g) are a separate input and are
  expected to have departed before the week starts. (Deriving headcount from `Housekeeper` + `Availability` belongs to R10.)
  **Staff needed on a day** = Σ `requiredCrewSize` of that day's candidates (R5c). Weekend counting: see R5f.
  If staff needed > staff available, the schedule is still produced, and every task that can be neither staffed nor
  deferred is listed in the **shortfall** report — never silently dropped.
  The headcount gives `regular` and `reserve` separately for each day (R10b); the checks above apply to both numbers.
  A day entry without one of the two numbers is invalid too — a missing `reserve` is never treated as 0.
- **R10b. Reserve.** A housekeeper with `reserve` is used only for a task that **cannot be deferred** (R5c), and only
  after all available regular housekeepers under the weekly limit (R9a) have a task. A task that can wait is deferred
  instead of calling the reserve. If no reserve is available either, the task goes to the shortfall (R10a).
  - Order each day: regular housekeepers by R5d priority → defer what can wait → reserve for what cannot wait →
    shortfall.
  - Weekends follow the same rule (R5f): a reserve is called only for a task that cannot wait.
  - With two or more reserves available, the one with the **fewest shifts this week** is called; ties by lowest id.
  - Reserve availability is an input per day like any housekeeper's. An assignment is marked `needsReserveCall` ⇔
    its crew includes a reserve — a call from day planning or the R9a fallback — so the manager confirms it.
  - A weekend alternative (R5h) is a suggestion, not a reserve call.
  Examples:
  - Monday: 5 regulars work, 6 departures; cottage 2 has no arrival today, the other five have arrivals today → five
    cottages get regulars, cottage 2 is deferred to Tuesday. The reserve is not called.
  - Same, but all 6 cottages have arrivals today → five get regulars, the sixth gets the reserve. If no reserve is
    available → shortfall.

### Fairness
- **R11. Even distribution.** R11 decides **which regular housekeepers work** on each day of the planning week; reserves
  are excluded (R10b). Contract hours are ignored in v1 — every shift counts the same. Each day's number of regular
  places is already fixed by day planning (ADR 0004), so this is a balanced-assignment problem over the whole week:
  1. **Bounds.** First maximise the number of staffed regular places, then find the smallest **spread** `U − L`:
     bounds `L ≤ U` such that every regular works at least `min(L, their place days)` and at most `min(U, 6)`
     shifts (R9a), and no day gets more than its count of regular places. A regular's **place days** are the days
     they are available that have at least one regular place — a day with no work never lowers `L` for the team.
     If several bounds have the same smallest spread, the one with the **largest `L`** is used.
  2. **Build.** Fill the week day by day. On each day candidates are tried in priority order: **fewest shifts so
     far** this week, then **longest since their last shift** (no shift yet this week counts as longest), then
     **lowest id**. A candidate is accepted only if the rest of the week can still reach the staffed count and the
     bounds from step 1 (max-flow feasibility check). The result is deterministic and optimal.
  - Saturday and Sunday are part of the same week (R12).
  - A regular place left unfilled because of the 6-shift limit is handled by R9a (reserve if the task cannot wait,
    otherwise `WEEKLY_LIMIT`). In a week starting on Monday this can only happen on Sunday.
  Example: A and B are both available Monday and only A is available Tuesday; cottage 3 departs Monday and cottage 5
  Tuesday, each needing one regular; no other departures that week. Fewest-shifts-first alone would give Monday to A
  (lowest id) and leave Tuesday to A as well → 2 vs 0. R11 gives Monday to B and Tuesday to A → 1 vs 1.
- **R12. Weekend rotation.** A weekend day staffs only tasks that cannot wait until Monday (R5f). Who works it is
  decided by R11 within the same week, like any other day — the regular with the fewest shifts this week comes first.
  Reserves are excluded (R10b). No history across weeks in v1.
  Example: Sunday cottage 7 departs with an arrival Sunday 16:00; A has 4 shifts this week and B has 3, both are
  available and the R11 bounds allow either → B works Sunday.

### Time tracking
- **R13. Own assignment, today only.** A housekeeper can only start a time entry for their own assignment on the current date.
- **R14. One open time entry.** Only one open time entry per housekeeper at a time.
- **R15. UTC storage.** Times are stored in UTC and displayed in Europe/London — durations must be correct across BST ↔ GMT changes.

---

## 5. Roles

| Role | Can |
|---|---|
| **Admin** | everything, incl. cottages, housekeepers, configuration |
| **Manager** | import bookings, set late checkout / early check-in, enter days off / holidays, generate/edit schedule, view time reports |
| **Housekeeper** | see own schedule, start/stop work (mobile) |

---

## 6. Invariants (property-based tests)

For any randomly generated week of bookings and availability, the generated schedule must satisfy:

1. Every task is in exactly one of: staffed on its `plannedDate`, the shortfall report, or `carriedOver`.
   On no day does the staffed tasks' Σ `requiredCrewSize` exceed that day's `regular + reserve`, and on no day does
   `reserveCalls` exceed `reserve`.
2. No housekeeper is assigned on an unavailable day.
3. No housekeeper has more than one task per day.
4. Without a manual override (R8), every task's crew is exactly one housekeeper, whatever the cottage type (R7).
5. No task exists for a non-schedulable or non-existent cottage.
6. Regenerating the schedule keeps all manual overrides.
7. Generation is deterministic: same input → same schedule.
8. No task is planned after its deadline; a task that cannot meet it appears in the shortfall/at-risk report.
9. A task is deferred only if, on every day from its `departureDate` up to the day before its `plannedDate`, either
   no **regular** housekeeper was left for it (R5d) or it was a weekend day the task could wait through (R5f). A task with a
   same-day arrival is never deferred.
10. Re-importing the same CSV never removes manager overrides (time overrides, crew overrides).
11. At most one `DEPARTURE` task per cottage per day.
12. Every task's `earliestStart` falls on its `departureDate`.
13. A task without a deadline is never tight. With default check-in/out times and no overrides, `deadline >= earliestStart`
    whenever a deadline exists. (Overrides or booking times may produce a negative window — see invariant 14.)
14. A task is at risk ⇔ it has a deadline and `deadline − windowStart < estimatedMinutes` (`windowStart` = `earliestStart`,
    or `plannedDate + workdayStart` if deferred). A task without a deadline is never at risk; every at-risk task is
    tight; a task with a negative window is at risk; a deferred task is never at risk.
15. `deferred` ⇔ `plannedDate > departureDate`. Planning never changes `departureDate` or `earliestStart`.
16. A task is planned on a Saturday or Sunday only if it cannot wait until the following Monday (R5f).
17. A reserve is used on a day only when every available regular housekeeper under the weekly limit (R9a) has a task,
    and only for tasks that cannot be deferred (R10b).
18. `stableFirst` flags never change which tasks are staffed, deferred or in shortfall, nor **who works** on each day:
    the plan with and without them differs only in which cottage each working housekeeper cleans (R7a after R11).
19. On any day, if a task that cannot be deferred goes to the shortfall, no task that could have been deferred was
    staffed that day (R5d).
20. No housekeeper, regular or reserve, has more than 6 shifts in the planning week. On the day of a `WEEKLY_LIMIT`
    task every available regular without a task that day has 6 shifts; if the task cannot wait, so does every
    available reserve without a task that day (R9a).
21. Among regular housekeepers, the number of staffed places is the largest possible within the 6-shift limit, and for
    that number the spread `U − L` is the smallest possible for the given availability and day counts (R11) —
    checked against brute force on small weeks.
22. If every active regular housekeeper is available on every day of the planning week, the most and least loaded
    regular differ by at most 1 shift (R11).
23. If the planning week starts on Monday, `WEEKLY_LIMIT` happens only on Sunday and only for a task that cannot
    wait (R9a, R5f).
24. On any day, a `stableFirst` housekeeper cleans a premium task only if every stable task staffed by regulars that
    day is cleaned by a `stableFirst` housekeeper; no regular without `stableFirst` cleans a stable task that comes
    before, in stable order, a stable task cleaned by a `stableFirst` housekeeper that day; and no reserve cleans a
    stable task that cannot wait while a `stableFirst` regular cleans a premium task that cannot wait (R7a).
25. A weekend alternative appears only on a deferred task planned on Saturday or Sunday. Its date is a weekday from
    `departureDate` up to `plannedDate − 1` within the week; its reserves were available and not assigned that day;
    no earlier such weekday had a free reserve. The alternatives fit together: a reserve is offered at most once per
    weekday, and counting every offered alternative as accepted, no reserve has more than 6 shifts (R9, R9a hold if
    the manager accepts all of them). The schedule is the same with or without alternatives (R5h).
26. `needsReserveCall` ⇔ the crew includes a reserve; a day's `reserveCalls` = that day's assignments with
    `needsReserveCall` (R10b).

---

## 7. Open questions

Resolved:

- [x] **Crews:** one housekeeper per task, any cottage; stable-first and reserve flags → R7, R7a, R10b.
- [x] **Stayovers:** not cleaned → R2.
- [x] **Check-in time:** 16:00 → R5.
- [x] **Capacity:** one cottage per person per day → R9 (derived).
- [x] **Availability:** entered by the manager → §3, §5.

- [x] **No same-day arrival:** clean can be deferred when short-staffed, or over the weekend → R5c–R5f.
- [x] **Late checkout / early check-in:** set by the manager in the app → R5a, R5b.
- [x] **Deferral order:** one priority — earliest deadline first, no deadline last, then cottage number → R5d, R5e.
- [x] **How far a task is deferred:** chained to the first day with a free housekeeper, while it still fits → R5c.
- [x] **Weekend:** days off; only tasks that cannot wait until Monday are staffed → R5f.
- [x] **Past the planning week:** carried over into the next week, not shortfall → R5g.

- [x] **Who works each day:** exact even distribution over the week (smallest spread, then fewest shifts so far,
      longest since last shift, lowest id); contract hours ignored in v1 → R11.
- [x] **Stable first vs. fairness:** R11 decides who works, R7a only which cottage; the flag never costs a shift → R7a.
- [x] **Weekend staffing:** same rule as weekdays within the week; no multi-week history in v1 → R12.
- [x] **Weekly rest:** at most 6 shifts per week; otherwise reserve or `WEEKLY_LIMIT` shortfall → R9a.
- [x] **Availability as input:** required for every active housekeeper and day; headcount derived from it → R10.

- [x] **Which cottage:** exact stable order, `stableFirst` before other regulars and before a reserve's stable task,
      premium fairness among the other regulars (manager, 2026-11-27) → R7a.
- [x] **Short-staffed Friday vs. weekend:** the plan may still defer onto the weekend; a free reserve on a weekday is
      offered as an alternative for the manager to choose → R5h.

Open: none for v1.

---

## 8. Booking source (v1: CSV)

Booking data is imported from the RezLynx **Guest List** report, exported to CSV.
Sample (anonymised): `tests/fixtures/rezlynx-guest-list.sample.csv`.

| CSV column | Domain field | Notes |
|---|---|---|
| `BookRef` | `externalRef` | One line per cottage: `XX000900/1`, `/2`, `/3` = one group booking, three cottages |
| `Arrival` | `arrivalDate` | `dd/MM/yyyy HH:mm:ss`, time is always `00:00:00` → date only |
| `Departure` | `departureDate` | same format |
| `RoomID` | `cottageNumber` | may come as `1` or `1.0` → integer |
| `RoomType` | — | validation only (`STABLE`, `PREMIUM_4`); the cottage table is the source of truth |
| all others | — | **ignored** |

File format (as exported by RezLynx, verified on a real export):

- Encoding **UTF-8 with BOM**, line endings **LF**.
- Header row unquoted; every data value is wrapped in double quotes.
- Every data row ends with a **trailing comma** → one extra empty field beyond the 21 header columns.
- Numbers come as plain integers (`"1"`, `"15"`); booleans as `"True"` / `"False"`.

Rules for the importer:

- Strip the BOM before reading the header, otherwise the first column is read as `﻿BookRef`.
- Tolerate the trailing empty field.

- Unknown columns are ignored; missing required columns fail the import with a clear message.
- `GuestName`, rates, totals, GDS/CRS refs and channel data are **never read or stored** (GDPR, not needed).
- A `RoomID` that is not a known cottage (e.g. 13) is reported as an import warning, not silently dropped.
- A mismatch between `RoomType` and the cottage's configured type is reported as a warning.
- Re-importing an overlapping date range updates bookings by `BookRef` and never touches manager overrides.
- The report has no status column: a booking missing from a newer import of the same range is treated as cancelled. *(to confirm)*
- **Export range (R5):** the export must cover at least the planning week plus the following days up to the next arrivals.
  If it ends too early, tasks silently get no deadline and are never flagged tight.

Backlog:

- [ ] Importer must **warn** when the export's date range ends before planning-week end + 7 days (R5 input coverage).
- [ ] Adapter/API **reports orphan overrides** (R5a): an override whose booking is unknown, cancelled or produces no task
      — e.g. after a re-import changed or removed the booking — is shown to the manager instead of being ignored silently.
- [ ] API **warns** when a `LATE_CHECKOUT` is earlier than the booking/default checkout, or an `EARLY_CHECKIN` is later
      than the booking/default check-in (R5a — likely a typo).
- [ ] API **warns** when saving an override that gives a task a negative window (R5b).
- [ ] Reconcile carried-over tasks (R5g) with actual completion data from time tracking (R13–R15): a task cleaned
      anyway, or cleaned late, should not be carried again.
- [ ] When the manager raises a crew to 2 (R8), the deferral check (R5c) should use the crew-adjusted duration — e.g.
      premium with early check-in 14:00 fits on its arrival day with a crew of 2.
- [ ] API: housekeepers may enter their own availability; a manager entry for the same housekeeper and date wins.
      Deadline Thursday 18:00 for the next week; anyone who has not filled it in is treated as unavailable and the
      manager sees a "not filled in" list.
- [ ] Manual 7th shift (R9a): the manager may assign a housekeeper a 7th shift to resolve a `WEEKLY_LIMIT` shortfall.
- [ ] Manager UI allows only planning weeks starting on Monday (R9a, R11: shifts are counted per planning week).
- [ ] Contract hours in the even distribution (R11) — v1 counts every shift equally.
- [ ] Weekend fairness across weeks (R12) — v1 has no multi-week history.
- [ ] Manager UI: choose between the weekend plan and its alternative (R5h); accepting it moves the task to the
      weekday and calls the reserve.
