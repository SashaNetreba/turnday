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

1. **Generate** a fair schedule automatically (Mon–Fri by demand, Sat–Sun by demand + rotation).
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

TimeOverride                  # set by the manager in the app, survives CSV re-imports
  bookingRef
  kind: LATE_CHECKOUT | EARLY_CHECKIN
  time: time
  setBy, setAt

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
  cottageNumber
  kind: DEPARTURE
  departureDate               # when the guest leaves
  plannedDate                 # when it is cleaned (= departureDate, or later if deferred)
  deferred: boolean
  estimatedMinutes: int
  requiredCrewSize: 1 | 2
  earliestStart: datetime     # local wall-clock YYYY-MM-DDTHH:MM: departure date + checkout time (incl. late checkout)
  deadline?: datetime         # local wall-clock: next arrival into this cottage + check-in time (incl. early check-in);
                              # empty if no next arrival is known
  tight: boolean              # R5: deadline exists and (deadline − earliestStart − estimatedMinutes) ≤ 0

SchedulingConfig              # passed into the domain, never hard-coded there
  estimatedMinutes: { STABLE: int, PREMIUM: int }   # R4, planning values (upper bound)
  defaultCheckoutTime: time   # R5
  defaultCheckinTime: time    # R5

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

---

## 4. Business rules

### Cleaning demand
- **R1.** A `CleaningTask` is created for every booking whose `departureDate` falls in the planning week
  and whose status is not `CANCELLED`.
  - The **planning week** is 7 consecutive days starting on a given date (start and start + 6 inclusive); it is not tied to a weekday.
  - A booking with `departureDate <= arrivalDate` is **invalid** and is skipped.
  - Several bookings for the same cottage with the same `departureDate` produce **one** task.
- **R2.** Empty cottages (no departure that day) are **not** cleaned. Occupied cottages (stayovers) are **not** cleaned either.
- **R3.** Non-schedulable cottages never produce tasks, even if a booking exists.
- **R4.** Estimated effort: `STABLE` ≈ 4–4.5 h, `PREMIUM` ≈ 5 h. Planning uses the upper bound — every task gets
  `estimatedMinutes` from `SchedulingConfig.estimatedMinutes` by cottage type (seed: 270 / 300). Configurable, never hard-coded.
- **R5.** A task cannot start before the guest's checkout time and must be finished before the **next** guest's check-in.
  - `earliestStart = departureDate + (booking.checkoutTime ?? defaultCheckoutTime)` (default 10:00; 11:00 or other times per booking).
  - `deadline = next arrival date + (that booking's checkinTime ?? defaultCheckinTime)` (default 16:00). The **next arrival** is the
    earliest non-cancelled, valid booking for the same cottage with `arrivalDate >= departureDate`. If several arrive that day,
    the earliest check-in counts. No next arrival known → **no deadline**.
  - **Precedence** for check-out and check-in times (highest first): manager override (R5a, `TimeOverride`, not
    implemented yet) → booking `checkoutTime` / `checkinTime` → `SchedulingConfig` default.
  - When several bookings collapse into one task (R1), the **latest** checkout time counts.
  - A task is **tight** when it has a deadline and `deadline − earliestStart − estimatedMinutes ≤ 0`. A task without a deadline is never tight.
    ⚠ Premium with an 11:00 checkout and a same-day arrival has zero slack (11:00 + 300 min = 16:00) → tight.
  - Times in the domain are **local wall-clock** (date + `HH:MM`), with no time zones; adapters convert to/from UTC (R15).
  - **Input coverage:** the bookings passed in must cover at least the planning week **plus the following days up to each
    cottage's next arrival**. With a too-short export a task **silently gets no deadline and is therefore never tight** —
    a known limitation of the input, not detected by the domain (see §8 backlog).
- **R5a. Late checkout / early check-in.** The manager can set a late checkout or an early check-in on a booking in the app. These overrides change `earliestStart` / `deadline`, are stored separately from imported data, and survive CSV re-imports.
- **R5b.** If an override makes a task impossible for one person (available window < estimated time), the schedule flags it as **at risk** and suggests a crew of 2. It is never silently dropped.

### Deferral
- **R5c.** A task may be **deferred** to a later day only when **both** are true:
  1. there are not enough available housekeepers on the departure day, and
  2. the cottage has no arrival that day (the deferred clean still finishes before the next arrival).
- **R5d.** Tasks with a same-day arrival are staffed first; deferrable tasks are the first to move when staff is short.
- **R5e.** Deferred tasks are prioritised on the day they move to (ordered by deadline).

### Crew
- **R6.** Default crew size is 1 (one housekeeper — one cottage), for stable **and** premium.
- **R7.** Premium crew is either:
  - **one** housekeeper with `premiumMode = SOLO`, or
  - **the two** housekeepers with `premiumMode = PAIR_ONLY`, together.
  A `PAIR_ONLY` housekeeper is never assigned to premium alone or with anyone else. They clean stable cottages normally.
- **R7a.** The algorithm prefers a solo crew for premium (one person per cottage). The `PAIR_ONLY` pair is used for premium only when no solo-capable housekeeper is free, or for a **tight** task.
- **R8.** The manager can manually raise any task's crew to 2 (e.g. very dirty) — this is a `manualOverride` and is preserved when the schedule is regenerated.

### Capacity
- **R9.** A housekeeper takes at most **one** cleaning task per day. This follows from R4 + R5: the earliest start is 10:00, one clean takes ≥ 4 h, so a second clean could not finish by 16:00.
- **R10.** A housekeeper is never scheduled on a day they are unavailable.
- ⇒ **Staff needed on a day** = Σ crew sizes of that day's tasks.
  If staff needed > staff available, the schedule is produced with an explicit **shortfall warning**, never silently.

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

1. Every task is either fully staffed or listed in the shortfall report.
2. No housekeeper is assigned on an unavailable day.
3. No housekeeper has more than one task per day.
4. Every premium task's crew is either one `SOLO` housekeeper or exactly the two `PAIR_ONLY` housekeepers.
4a. No `PAIR_ONLY` housekeeper appears on a premium task in any other combination.
5. No task exists for a non-schedulable or non-existent cottage.
6. Regenerating the schedule keeps all manual overrides.
7. Generation is deterministic: same input → same schedule.
8. No task is planned after its deadline; a task that cannot meet it appears in the shortfall/at-risk report.
9. A task is deferred only if its departure day was short-staffed and it had no same-day arrival.
10. Re-importing the same CSV never removes manager overrides (time overrides, crew overrides).
11. At most one `DEPARTURE` task per cottage per day.
12. Every task's `earliestStart` falls on its `departureDate`.
13. A task without a deadline is never tight. With default check-in/out times, `deadline >= earliestStart` whenever a deadline exists.

---

## 7. Open questions

Resolved:

- [x] **Premium crew:** one person normally; two specific housekeepers clean premium only together → R7.
- [x] **Stayovers:** not cleaned → R2.
- [x] **Check-in time:** 16:00 → R5.
- [x] **Capacity:** one cottage per person per day → R9 (derived).
- [x] **Availability:** entered by the manager → §3, §5.

- [x] **No same-day arrival:** clean can be deferred, but only when short-staffed → R5c–R5e.
- [x] **Late checkout / early check-in:** set by the manager in the app → R5a, R5b.

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
