# Domain Model — Housekeeping Scheduler

> Status: **v0.3 — ready for implementation** · Owner: Oleksandra Netreba
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
   until Monday (R5f), staffed by rotation (R12)).
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
| **Crew** | The housekeepers assigned to one cleaning task (1 by default, 2 for premium or extra-dirty). |
| **Weekend rotation** | Fair turn-taking for Saturday/Sunday shifts. |
| **Time entry** | Actual start/stop recorded by a housekeeper for an assignment. |
| **Headcount** | Number of housekeepers available on a date — input to planning (R10a). |
| **Workday start** | Time housekeepers start work; the start of a deferred task's window (R5c). |
| **Deferral** | Cleaning a task on a later day than its departure (R5c). |
| **Shortfall** | A task that cannot be staffed before its deadline — reported, never dropped (R10a). |
| **Carry-over** | A task still waiting after the planning week; it moves into the next week's planning (R5g). |

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
  premiumMode: SOLO | PAIR_ONLY   # PAIR_ONLY = cleans premium only together with the other PAIR_ONLY housekeeper
  active: boolean

Availability                  # entered by the manager only
  housekeeperId
  date
  available: boolean          # days off, holidays, sickness

CleaningTask                  # derived from bookings, never entered manually
  bookingRef                  # Booking.externalRef of the departing booking (lowest among duplicates, R1)
  cottageNumber
  kind: DEPARTURE
  departureDate               # when the guest leaves
  plannedDate                 # when it is cleaned (= departureDate, or later if deferred, R5c)
  deferred: boolean           # ⇔ plannedDate > departureDate (invariant 15)
  estimatedMinutes: int
  requiredCrewSize: 1 | 2     # R6: always 1 for now; R7a / R8 raise it later
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

Headcount                     # R10a: input to planning, one entry for every day of the planning week
  date
  available: int >= 0         # housekeepers available that day (derived from Housekeeper + Availability with R10)

WeekPlan                      # output of planning one week (R5c–R5g, R10a)
  tasks: [CleaningTask]       # staffed, plannedDate within the week
  days: [{ date, needed, available }]   # needed = Σ requiredCrewSize of that day's candidates;
                                        # on Sat/Sun only those that cannot wait until Monday (R5f)
  shortfall: [{ task, reason: NO_STAFF | DEADLINE_PASSED, lastPossibleDate? }]
                              # lastPossibleDate (NO_STAFF): last day the task could still have been cleaned
  carriedOver: [CleaningTask] # still waiting after the week's last day → input to the next week (R5g)

Assignment
  taskId
  housekeeperIds: [id]        # crew
  manualOverride: boolean     # e.g. manager added a 2nd person because it's very dirty

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
- **R1.** A `CleaningTask` is created for every booking whose `departureDate` falls in the planning week
  and whose status is not `CANCELLED`.
  - The **planning week** is 7 consecutive days starting on a given date (start and start + 6 inclusive); it is not tied to a weekday.
  - A booking with `departureDate <= arrivalDate` is **invalid** and is skipped.
  - Several bookings for the same cottage with the same `departureDate` produce **one** task.
    Among duplicates the booking with the **lowest `externalRef`** is kept (plain string order); it becomes the
    task's `bookingRef`, independent of input order.
- **R2.** Empty cottages (no departure that day) are **not** cleaned. Occupied cottages (stayovers) are **not** cleaned either.
- **R3.** Non-schedulable cottages never produce tasks, even if a booking exists.
- **R4.** Estimated effort: `STABLE` ≈ 4–4.5 h, `PREMIUM` ≈ 5 h. Planning uses the upper bound — every task gets
  `estimatedMinutes` from `SchedulingConfig.estimatedMinutes` by cottage type (seed: 270 / 300). Configurable, never hard-coded.
- **R5.** A task cannot start before the guest's checkout time and must be finished before the **next** guest's check-in.
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
  - Suggesting a crew of 2 for an at-risk task belongs to the crew rules (R6/R7a), which read `atRisk`.

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
- **R5d. Priority.** A day's candidates are ordered by **deadline, earliest first**, tasks without a deadline last; ties
  by **cottage number, lowest first**, then by departure date. The same order decides who is staffed and who waits:
  - a task with a same-day arrival is staffed before any task that can wait (it has the day's earliest deadline);
  - on a short day the tasks that can wait longest move: no deadline first, then the latest deadline; on a tie the
    higher cottage number moves;
  - when even the tasks that cannot wait don't all fit, the ones with the latest deadline go to shortfall.
- **R5e. Deferred tasks on the new day** compete with that day's own tasks in the same order (R5d) — no separate
  queue. A deferred task does not jump ahead of a task with an earlier deadline.
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

### Crew
- **R6.** Default crew size is 1 (one housekeeper — one cottage), for stable **and** premium. Every task gets
  `requiredCrewSize = 1`; R7a and R8 may raise it.
- **R7.** Premium crew is either:
  - **one** housekeeper with `premiumMode = SOLO`, or
  - **the two** housekeepers with `premiumMode = PAIR_ONLY`, together.
  A `PAIR_ONLY` housekeeper is never assigned to premium alone or with anyone else. They clean stable cottages normally.
- **R7a.** The algorithm prefers a solo crew for premium (one person per cottage). The `PAIR_ONLY` pair is used for premium only when no solo-capable housekeeper is free, or for a **tight** task.
- **R8.** The manager can manually raise any task's crew to 2 (e.g. very dirty) — this is a `manualOverride` and is preserved when the schedule is regenerated.

### Capacity
- **R9.** A housekeeper takes at most **one** cleaning task per day. This follows from R4 + R5: the earliest start is 10:00, one clean takes ≥ 4 h, so a second clean could not finish by 16:00.
- **R10.** A housekeeper is never scheduled on a day they are unavailable.
- **R10a. Shortfall.** Planning takes a **headcount** for every day of the planning week (housekeepers available,
  integer ≥ 0). A missing day, or a negative or non-integer count, makes the input **invalid**: it is rejected
  with the list of affected dates, never treated as 0. A day given twice is invalid too; dates outside the week are
  ignored. A task in `tasks` that departs outside the planning week makes the input invalid instead of being dropped.
  This check applies to `tasks` only: tasks carried over from the previous week (R5g) are a separate input and are
  expected to have departed before the week starts. (Deriving headcount from `Housekeeper` + `Availability` belongs to R10.)
  **Staff needed on a day** = Σ `requiredCrewSize` of that day's candidates (R5c). Weekend counting: see R5f.
  If staff needed > staff available, the schedule is still produced, and every task that can be neither staffed nor
  deferred is listed in the **shortfall** report — never silently dropped.

### Fairness
- **R11.** Over a week, shifts are distributed as evenly as possible across active housekeepers (difference between most and least loaded ≤ 1 shift where availability allows).
- **R12.** Weekend shifts follow a **rotation**: the housekeepers with the fewest weekend shifts in the rolling history are picked first; ties broken by longest time since last weekend shift.

### Time tracking
- **R13.** A housekeeper can only start a time entry for their own assignment on the current date.
- **R14.** Only one open time entry per housekeeper at a time.
- **R15.** Times are stored in UTC and displayed in Europe/London — durations must be correct across BST ↔ GMT changes.

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
   On no day does the staffed tasks' Σ `requiredCrewSize` exceed that day's headcount.
2. No housekeeper is assigned on an unavailable day.
3. No housekeeper has more than one task per day.
4. Every premium task's crew is either one `SOLO` housekeeper or exactly the two `PAIR_ONLY` housekeepers.
4a. No `PAIR_ONLY` housekeeper appears on a premium task in any other combination.
5. No task exists for a non-schedulable or non-existent cottage.
6. Regenerating the schedule keeps all manual overrides.
7. Generation is deterministic: same input → same schedule.
8. No task is planned after its deadline; a task that cannot meet it appears in the shortfall/at-risk report.
9. A task is deferred only if, on every day from its `departureDate` up to the day before its `plannedDate`, either
   no housekeeper was left for it (R5d) or it was a weekend day the task could wait through (R5f). A task with a
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

---

## 7. Open questions

Resolved:

- [x] **Premium crew:** one person normally; two specific housekeepers clean premium only together → R7.
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
- [ ] When crew size 2 exists (R7a / R8), the deferral check (R5c) should use the crew-adjusted duration — e.g. premium
      with early check-in 14:00 fits on its arrival day with a crew of 2 — so that shortfall case becomes a deferral with crew 2.
