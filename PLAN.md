# Plan — The Equipment Ledger

> Source of truth: `fullstack-technical-test-equipment-ledger (1).html`
> Status: **plan only — no code written yet.**

---

## 1. What we are building

A replacement for the paper book at a construction-site tool store. A store keeper stands at a hatch and records who took which tool, when, and when it came back. The system must do four things: issue an asset, take it back, reserve it for a future window, and reconstruct the store as it stood at any past instant. The whole point of the exercise is correctness under pressure — the same drill can never be in two hands, even if two people click at the same millisecond.

---

## 2. Functional requirements (traceable to the spec)

**Issue**
- **FR-1** — Hand an asset to a worker, now.
- **FR-2** — Hand an asset to a worker against a reservation they made earlier.

**Return**
- **FR-3** — Take an asset back into the store.
- **FR-4** — Accept a return from a worker who is *not* the holder, and record that fact.
- **FR-5** — Accept a return marked damaged, which sends the asset out of service.

**Reserve**
- **FR-6** — A worker claims one asset for a window of time in the future.
- **FR-7** — Two overlapping claims on one asset are impossible.

**Reconstruct**
- **FR-8** — Show the whole store as it stood at any past instant.
- **FR-9** — Show the full life of any one asset.

**Domain**
- **FR-10** — An asset has its own identity (`HARN-014`), a kind, may require a certification, and can be taken out of service and later brought back.
- **FR-11** — A worker holds zero or more certifications, each with an expiry date.
- **FR-12** — A movement is a recorded fact: this asset went to this worker at this time, or came back at this time. The ledger is made of movements.

**Invariants (the eight rules)**
- **FR-13** — *One holder, ever.* At most one worker holds an asset at any instant. Never, including same-millisecond requests.
- **FR-14** — *Reservations don't overlap.* Two reservations on one asset may not share a minute. Adjacent is fine.
- **FR-15** — *Certification gates issue.* Expired on the day of issue means refused, with a reason a human can read.
- **FR-16** — *Out of service is real.* An unserviceable asset cannot be issued or newly reserved. Standing reservations against it must be resolved by a stated decision.
- **FR-17** — *Late entries happen.* The ledger records when a thing happened and when it was written, in two different fields.
- **FR-18** — *Corrections, not erasures.* A wrong movement can be fixed, and the history shows that a correction was made.
- **FR-19** — *Nothing lands twice.* Double-click, retry, refresh mid-submit → one movement.
- **FR-20** — *Any instant, answerable.* Answered from the ledger, not from a cache.

**Seed**
- **FR-21** — ~60 assets, a handful of kinds, some requiring certification, at least one out of service.
- **FR-22** — ~12 workers with certifications, including one expired and one expiring inside the seeded window.
- **FR-23** — 30 days of movements: ordinary issues and returns, a few still outstanding, at least one overdue, at least one late-logged, at least one correction.
- **FR-24** — Reservations past and future, including one never collected.
- **FR-25** — Seeding twice does not double the store; the same command gives the same store.

**Delivery**
- **FR-26** — Git repo with real commit history, not one dump commit.
- **FR-27** — README covering: run both sides, seed, run the invariant checks, the model and why, how concurrent issue was made impossible, what another day would buy, what was knowingly left out.
- **FR-28** — Invariant checks must be runnable as a command (implied by the README bullet — treating it as a hard requirement).
- **FR-29** — Screen recording, 2–3 minutes: issue, a refused issue, a backdated return, a correction, the "as of" answer.

**Scope limits**
- **FR-30** — No auth, no roles, no email, no uploads, no barcodes, no mobile app, no multi-site. Keeper and worker are picked from a list.

---

## 3. Tech stack (exactly as specified)

| Layer | Choice | Note |
|---|---|---|
| Frontend | **Next.js** (App Router) | as specified |
| Backend | **NestJS** | as specified |
| Database | **MongoDB** | as specified |
| Language | **TypeScript** | as specified, both sides |

The spec states no versions, so: current stable Next.js, current stable NestJS, MongoDB 7.x.

Supporting choices, kept deliberately small:

**Backend**

- **Mongoose** via the first-party `@nestjs/mongoose` — Nest's own database idiom, not an extra opinion.
- **class-validator / class-transformer** — Nest's built-in validation pipe uses them. The server is the validation authority.
- **Jest + Supertest** — ships with the Nest scaffold.
- **A plain local MongoDB (standalone).** No Docker, no replica set. See section 7 for why, and what it costs.

**Frontend**

- **Tailwind CSS** — all styling.
- **TanStack Query (`@tanstack/react-query`)** — the single client data path: cache, refetch, invalidation after writes.
- **React Hook Form + Zod** (`@hookform/resolvers/zod`) — every dialog form.
- **Zustand** — client UI state only: the selected keeper, and the as-of time-travel instant.
- **react-hot-toast** — success confirmations and refusal messages.

Nothing else. No ORM layer, no monorepo tool, no UI kit.

The split is deliberate and is one line in the README: **Zustand holds UI state, TanStack Query holds server state.** Nothing lives in both.

---

## 4. Constraints and rules of work

- **Time**: ~8 focused hours, spread over 3 calendar days.
- **Deliverables**: source, README, seed command, screen recording.
- **Explicitly out of scope**: authentication, roles and permissions, email, file uploads, barcode scanning, mobile app, multi-site.
- **Stated preference**: "the ledger provably correct" beats "six screens done thinly". Depth over breadth.
- **Free choices** (the spec says so outright): number of pages, API shape, collection shapes, events-vs-rows, where validation lives, what renders on the server.
- **Non-negotiable rules**: one holder, corrections, nothing twice, any instant.
- **On concurrency**: I must be able to point at *the line* that makes double-issue impossible, and say what it costs.
- **Commit history must be real** — commit per phase, meaningful messages.
- **Ambiguity**: ask, or decide and write it in the README. Both are acceptable. I will decide and document.
- **Do not publish** the finished submission as a solved interview exercise.

---

## 5. Grading criteria and how to score on each

The spec says: they run it, try to break it, *then* read the code. So the first job is to survive the attack list.

| What they will do | How I make it pass |
|---|---|
| Concurrent double issue (two at once, two tabs) | Every write takes a per-asset lease, then claims the asset with a single `insertOne` whose `_id` is the asset id — unique by definition. Exactly one wins; the loser gets a 409 with a readable reason. Works identically on standalone MongoDB, with no transactions. |
| Double-click / replay same payload / refresh mid-submit | Mandatory `Idempotency-Key` on every write, stored in the same transaction. Replay returns the original response, not a second movement. Submit buttons also disable, but the server is the guarantee. |
| Issue to a worker whose cert expired yesterday | Certification checked against the *issue date*, refusal message names the worker, the certificate and the expiry date. |
| Out of service while issued, and while reserved | A stated decision (below), applied consistently, and written in the README. |
| Return an asset that isn't out / return twice / return as a different worker | First two → 409 with reason. Third → succeeds and records who actually handed it back. The spec says returns may come from a different worker. |
| Backdate a return before its issue; backdate into the middle of a later hold | Every movement, and every correction, is re-validated against the *whole* timeline for that asset, not just the current state. |
| Reserve in the past / end before start / a whole year | Rejected with three distinct readable reasons. |
| "As of" exactly on a timestamp, and before the store existed | Boundary is inclusive and documented. Pre-history returns a clean, honest answer rather than an empty crash. |
| Kill the API mid-request | The claim carries the whole intent and the movement's pre-generated `_id`, so an interrupted write is replayed to exactly one movement on the next read or write of that asset. The UI never shows an optimistic result; it re-reads after the server confirms, and shows an explicit error state on failure. |
| Read Mongo directly and compare with the screens | The screens are computed from the same ledger, with no separate cache. An invariant-check command proves it. |
| "Why did you build it that way?" | README explains the model, the rejected alternatives, and the costs. |

Deliberate scoring tactics:

- Ship the **invariant checker** early and mention it prominently — it turns "trust me" into "run this".
- Ship a **concurrency test** that fires N simultaneous issues and asserts one winner. That is the headline test.
- Make every refusal message a sentence a store keeper could read aloud.
- Keep the code small enough to be read in twenty minutes.

---

## 6. Database schema

The core decision: **the ledger is an append-only log of movements. Current state is derived from it. Nothing is ever edited or deleted.**

### Collections

**`assets`**
- `_id` — ObjectId
- `code` — string, unique (e.g. `HARN-014`)
- `name` — string
- `kind` — string (harness, drill, gas detector, ladder, generator…)
- `requiredCertification` — string or null
- `addedToStoreAt` — date
- `createdAt` / `updatedAt`

Note: no current-state fields here. State is derived.

**`workers`**
- `_id`, `employeeNo` (unique), `name`, `active`
- `certifications` — array of `{ code, issuedAt, expiresAt }`

**`keepers`**
- `_id`, `name` — just the list the keeper is picked from.

**`movements`** — append-only, immutable, never updated
- `_id`
- `assetId` → assets
- `type` — `ISSUE` | `RETURN` | `OUT_OF_SERVICE` | `BACK_IN_SERVICE`
- `workerId` → workers (the holder, on ISSUE)
- `returnedByWorkerId` → workers (on RETURN; may differ from holder)
- `keeperId` → keepers (who wrote it)
- `occurredAt` — when it actually happened (business time)
- `recordedAt` — when it was written (server clock)
- `dueAt` — optional, on ISSUE
- `condition` — `OK` | `DAMAGED`, on RETURN
- `reservationId` — optional, on ISSUE against a reservation
- `correctsMovementId` — optional, self-reference; makes this entry a correction
- `correctionReason` — required when correcting
- `reason` / `note` — free text
- `idempotencyKey` — string, unique

**`reservations`**
- `_id`, `assetId`, `workerId`, `keeperId`
- `startsAt`, `endsAt` — half-open window `[start, end)`, minute precision
- `status` — `PENDING` | `COLLECTED` | `CANCELLED`
- `collectedMovementId` — optional
- `cancelledAt`, `cancelReason`
- `createdAt`, `idempotencyKey`

**`asset_holdings`** — a guard, not a cache. One document exists *only while an asset is held*.
- `_id` = assetId (this is the whole trick — the primary key is unique by definition)
- `state` — `PENDING` | `ACTIVE` | `RELEASING`
- `workerId`, `issueMovementId`, `since`, `dueAt`
- `intent` — the complete payload of the movement(s) this claim is about to write, including their **pre-generated `_id`s**. This is what makes a half-finished write replayable rather than lost.
- `claimedAt` — when the claim was taken; a claim still `PENDING` after the settle timeout is replayed by the next caller.
- `idempotencyKey`

**`asset_locks`** — a short lease, one document per asset, the serialisation point for every write.
- `_id` = assetId
- `token` — random per-request string; only the holder of the token may release
- `expiresAt` — now + 10s; a dead process cannot hold the asset hostage
- `route`, `acquiredAt` — for diagnosing a stuck lease

**`idempotency_keys`**
- `_id` = the key string
- `route`, `requestHash`, `responseStatus`, `responseBody`, `createdAt` (TTL 24h)

### Indexes that carry weight

- `assets.code` unique
- `movements` on `{assetId, occurredAt}`, on `{occurredAt}`, on `{recordedAt}`, on `{correctsMovementId}`, and `idempotencyKey` unique
- `asset_holdings._id` — implicit unique, this is the "one holder" backstop
- `asset_locks._id` — implicit unique, this is what makes the lease atomic
- `movements._id` — pre-generated by the writer, so replaying a half-finished write is idempotent rather than duplicating
- `reservations` on `{assetId, startsAt}` and `{assetId, status, endsAt}`
- `workers.employeeNo` unique

### Text ER outline

```
Keeper ──1:N──> Movement            (recorded by)
Worker ──1:N──> Movement            (as holder, on ISSUE)
Worker ──1:N──> Movement            (as returner, on RETURN)
Worker ──1:N──> Reservation
Asset  ──1:N──> Movement            (the asset's whole life)
Asset  ──1:N──> Reservation
Asset  ──1:0..1─> AssetHolding      (exists only while held)
Movement ──0..1──> Movement         (correctsMovementId, self-reference chain)
Reservation ──0..1──> Movement      (collectedMovementId)
```

### Why this model (README material)

- Movements as an immutable log is the only shape where "corrections, not erasures" and "any instant, answerable" fall out for free rather than being bolted on.
- Service changes live in the *same* log because they are facts about the asset on the same timeline; that keeps "as of" a single fold over one collection.
- `asset_holdings` is not a cache — no read path uses it. It exists purely so the storage engine, not my code, refuses a second holder.
- Cost, stated honestly: state is recomputed on read. At 60 assets and 30 days that is trivial. At 60,000 assets I would add periodic snapshots and fold forward from the nearest one.

---

## 7. Backend architecture

### Layers

- **Controllers** — HTTP only. Parse, validate shape, map domain errors to status codes.
- **Application services** — one per use case (issue, return, correct, reserve, service-status). They open the transaction and orchestrate.
- **Domain** — pure functions, no database: the state fold, the overlap test, the certification check, the timeline validator. This is where the rules live and where the unit tests point.
- **Persistence** — Mongoose models, repositories, index definitions.
- **Cross-cutting** — validation pipe, idempotency interceptor, transaction helper with retry, error filter, request-id.

### Why there are no transactions

MongoDB only offers multi-document transactions on a replica set. The target machine runs an ordinary standalone MongoDB service, where `session.withTransaction` fails outright with *"Transaction numbers are only allowed on a replica set"*. Requiring the assessor to convert their MongoDB to a replica set before the app will start is a setup tax and a first-run failure I am not willing to ship.

So the concurrency guarantee is built from operations that are atomic on **any** MongoDB, standalone or replica set: **single-document writes**. Two independent layers:

1. **A per-asset lease** (`asset_locks`) serialises writes to one asset. This replaces the old `writeSeq` bump, which existed only to force transactions into conflict.
2. **A unique `_id` on `asset_holdings`** structurally refuses a second holder. This layer does not depend on my locking being correct — if the lease logic had a bug tomorrow, the storage engine still refuses the second issue.

The honest cost is stated below and goes in the README.

### The write path (identical for every mutation)

1. Reject the request if `Idempotency-Key` is missing → `428`.
2. Look the key up. If a completed record exists, return the original status and body, marked as a replay.
3. **Acquire the asset's lease**: `findOneAndUpdate` on `asset_locks` matching `_id: assetId` and `expiresAt <= now`, with `upsert: true`, setting a fresh token and `expiresAt`. A live lease makes the upsert collide on `_id` and raise a duplicate-key error — that *is* the "someone else is writing" signal. Bounded retry with jittered backoff, then `409 ASSET_BUSY`.
4. **Replay any unfinished claim** on this asset first (see below), so the timeline we are about to read is complete.
5. Load the asset's movements and holding. Run the pure domain rules. Any refusal throws a typed domain error carrying a code and a human sentence.
6. **Take the claim, and pre-generate the movement `_id`s.** This is the commit point:
   - **ISSUE** → `insertOne` into `asset_holdings` with `state: PENDING` and the full `intent`. **This is the line.** A duplicate key here means someone already holds the asset → `409 ASSET_ALREADY_HELD`. It is one atomic write; exactly one of N simultaneous issues can win, on standalone as on a replica set.
   - **RETURN** → `findOneAndUpdate` matching `_id: assetId, state: ACTIVE`, setting `state: RELEASING` and the intent. No match → `409 ASSET_NOT_HELD`.
7. **Apply the intent**: insert the movement(s) using the pre-generated `_id`s. A duplicate `_id` here is benign — it means this intent was already applied, which is exactly what makes replay safe.
8. **Settle**: `PENDING → ACTIVE`, or delete the `RELEASING` holding. Touch the reservation. Write the idempotency record. Release the lease by token.

### The crash window, stated plainly

Steps 6 and 7 are two separate writes, so a process killed exactly between them leaves a claim taken and its movement not yet written. This is the one thing a transaction would have given me for free, and I am not going to pretend otherwise.

It is handled, not ignored: the claim carries the entire intent **and the `_id`s the movements will use**, so replaying it is deterministic and produces the same documents no matter how many times it runs. Step 4 replays any unsettled claim before the next write to that asset, `GET /assets/:code` replays before it reads, and `npm run reconcile` sweeps every unsettled claim on demand. An asset can therefore be briefly locked-but-not-yet-logged; it can never end up held by two workers, and no movement is ever written twice.

Cost, stated plainly: writes to one asset are serialised, a write takes two round trips instead of one commit, and crash recovery is my code's job rather than the storage engine's. Different assets never contend. Nothing here changes if the database is later moved to a replica set — the same code runs correctly, it simply gains a shorter recovery window.

### API endpoints

There is no auth (spec), so the **Actor** column records the actor the client must send.

**Reads**

| Method | Path | Actor | Request | Response | Codes |
|---|---|---|---|---|---|
| GET | `/health` | — | — | service + db status | 200 |
| GET | `/assets` | — | `?state=&kind=&q=&page=` | assets with derived current state | 200 |
| GET | `/assets/:code` | — | — | asset + current state + active reservation | 200, 404 |
| GET | `/assets/:code/history` | — | — | full life: movements, corrections, reservations | 200, 404 |
| GET | `/workers` | — | `?q=` | workers + certs + what they hold | 200 |
| GET | `/workers/:id` | — | — | worker detail + current holdings | 200, 404 |
| GET | `/keepers` | — | — | the pick-a-name list | 200 |
| GET | `/movements` | — | `?assetId=&workerId=&from=&to=&page=` | ledger, newest first | 200 |
| GET | `/reservations` | — | `?assetId=&status=&from=&to=` | reservations | 200 |
| GET | `/ledger/as-of?at=<ISO>` | — | instant | whole store at that instant | 200, 400 |

**Writes** — all require an `Idempotency-Key` header and a `keeperId` in the body.

| Method | Path | Request body | Response | Codes |
|---|---|---|---|---|
| POST | `/movements/issue` | assetId, workerId, keeperId, occurredAt?, dueAt?, reservationId?, note? | created movement + new asset state | 201, 400, 404, 409, 428 |
| POST | `/movements/return` | assetId, returnedByWorkerId, keeperId, occurredAt?, condition, note? | created movement + new asset state | 201, 400, 404, 409, 428 |
| POST | `/movements/:id/corrections` | occurredAt?, workerId?, dueAt?, correctionReason, keeperId | correction movement + corrected chain | 201, 400, 404, 409, 428 |
| POST | `/reservations` | assetId, workerId, startsAt, endsAt, keeperId | reservation | 201, 400, 404, 409, 428 |
| POST | `/reservations/:id/cancel` | reason, keeperId | reservation | 200, 404, 409, 428 |
| POST | `/assets/:id/out-of-service` | reason, occurredAt?, keeperId | movement + new state | 201, 404, 409, 428 |
| POST | `/assets/:id/back-in-service` | note, occurredAt?, keeperId | movement + new state | 201, 404, 409, 428 |

**Status code policy**

- `400` — the request is malformed (bad date, missing field, unknown enum).
- `404` — the asset, worker or movement does not exist.
- `409` — the ledger refuses it. Every business rule refusal uses 409 plus a machine-readable code, so there is one shape to learn.
- `428` — `Idempotency-Key` header missing.
- `500` — unexpected; the transaction rolled back and nothing was written.

Replay of a completed key returns the original status and body, plus a header marking it a replay.

---

## 8. Frontend

Next.js App Router, Tailwind for styling. Server components render the shell and layout; **TanStack Query is the single data path for everything that comes from the ledger**, in client components.

That is a deliberate choice over server-component fetching with `router.refresh()`. Two reasons: one obvious data path is easier to defend in the interview than two, and the as-of page is a slider that refetches constantly, which is a client concern. The cost, stated in the README: no RSC streaming, and the first paint waits on the client fetch.

### Routes

| Route | Purpose |
|---|---|
| `/` | **Store board.** Every asset with its current state: in store, issued to X (with due time), overdue, reserved now, out of service. Search and filter. |
| `/assets/[code]` | **Asset life.** Current state, the actions (issue, return, reserve, out/back in service), and the full timeline with corrections shown inline. |
| `/as-of` | **Reconstruction.** Pick a date and time, see the whole store as it stood. |
| `/ledger` | **The book.** Every movement newest-first, showing occurred-at and recorded-at side by side, with corrections flagged. |
| `/workers` | Workers, their certifications with expiry warnings, and what they currently hold. |

Five routes, and the spec's warning about "six screens done thinly" is respected: `/ledger` and `/workers` are thin list views, and the depth goes into `/assets/[code]` and `/as-of`.

### Components

- `AssetStateBadge` — one component that renders every state consistently everywhere.
- `KeeperPicker` — header dropdown, the "pick a name from a list" the spec asks for.
- `IssueDialog`, `ReturnDialog`, `ReserveDialog`, `CorrectDialog`, `ServiceDialog` — each a React Hook Form + Zod form that generates one idempotency key when opened.
- `MovementTimeline` — the asset life, correction chains rendered as struck-through original + the correction beneath it.
- `AsOfPicker` — datetime input, a slider, and quick presets ("one hour ago").
- `ErrorBanner` — renders the API's error code and message verbatim, inline in the form.

### State handling

**Server state — TanStack Query**

- One `queryKey` per resource (`['assets']`, `['asset', code]`, `['as-of', instant]`, …).
- Writes are `useMutation`, and on success invalidate the affected keys. The screen is re-read from the server, never patched locally.
- **No optimistic updates — `onMutate` is not used anywhere.** This is deliberate: the spec kills the API mid-request and looks at what the browser is left claiming. The UI shows pending, then either the server's truth or an explicit error. It never claims a movement happened.
- **`retry: false` on every mutation.** Idempotency keys make a retry *safe*, but a silent retry would hide exactly the mid-request failure the assessor is trying to provoke. Reads may retry; writes surface the error.

**UI state — Zustand**

- `useKeeperStore` — the selected keeper, `persist`ed to localStorage so it survives a refresh. Sent as `keeperId` on every write.
- `useAsOfStore` — the time-travel instant driving the as-of slider.
- Nothing from the ledger is ever copied into Zustand.

**Forms — React Hook Form + Zod**

- One Zod schema per dialog, resolved through `@hookform/resolvers/zod`.
- These schemas mirror the API contract for fast feedback only. **The server is the authority**; the client never refuses something the server would have accepted, and never trusts its own pass.
- The idempotency key is created when the dialog opens and reused on every retry of that same submit, so a retry after a timeout cannot create a second movement.
- Submit buttons disable while pending — a convenience, not the guarantee.

**Feedback — react-hot-toast**

- Success toasts on a confirmed write.
- Refusals render `error.message` from the API verbatim, in the toast and in the form's `ErrorBanner`. The frontend never invents wording for a business refusal.

---

## 9. Authentication and authorization

**The spec forbids this outright.** Section 01's scope note says: no authentication, no roles and permissions. So there are no roles, no permissions, no login, no sessions, no tokens.

What exists instead:

- **Keeper** — the person operating the hatch. Picked by name from a list in the header. Stored in a cookie so it survives a refresh. Sent as `keeperId` on every write and stamped onto every movement, so the ledger records who wrote each entry.
- **Worker** — the person taking the asset. Picked by name from a list in each form.

Neither is a security boundary. The API trusts the client for identity, by design.

- **What every actor can do**: everything. There is no restriction anywhere.
- **What nothing does**: verify identity. Anyone who can reach the API can write to the ledger.

This is stated in the README as a knowingly-accepted limitation, because pretending otherwise would be inventing a requirement.

---

## 10. Validation, error handling and security

### Input validation (at the edge, class-validator)

- IDs are valid ObjectIds and exist.
- Dates are valid ISO-8601 with a timezone; all times stored as UTC.
- `occurredAt` may be in the past (late entries are expected) but never in the future.
- `dueAt`, if given, is after `occurredAt`.
- `condition` is `OK` or `DAMAGED`.
- Reservation `startsAt` < `endsAt`, both truncated to whole minutes, `startsAt` in the future, duration at most 30 days.
- Free text fields length-capped; `correctionReason` and out-of-service `reason` are required and non-empty.
- Unknown properties are stripped.

### Domain validation (pure functions, inside the transaction)

- **Issue**: asset exists, is in service, is not held, has no active reservation for another worker, and the worker's certification is valid on the issue date.
- **Return**: asset is currently held; the return time is after the issue it closes and does not fall inside a later hold.
- **Correction**: the target movement exists, is not already superseded, and the corrected values leave the asset's whole timeline valid.
- **Reserve**: window does not overlap any `PENDING` or `COLLECTED` reservation on that asset, using half-open comparison so adjacent windows pass. Overlap is a range test, so no unique index can enforce it — this rule leans entirely on the per-asset lease from section 7, which every write acquires. After inserting, the service re-reads the asset's reservations and asserts exactly one match for the new window; if the lease were ever violated, the later insert self-cancels with a recorded reason rather than leaving two live overlapping claims.
- **Service change**: cannot take out an asset already out; cannot bring back one already in service.

### Error response shape

One shape everywhere, with these fields:

- `error.code` — a stable machine string, e.g. `ASSET_ALREADY_HELD`, `ASSET_NOT_HELD`, `ASSET_BUSY`, `CERTIFICATION_EXPIRED`, `RESERVATION_OVERLAP`, `RETURN_BEFORE_ISSUE`, `ASSET_OUT_OF_SERVICE`, `MOVEMENT_ALREADY_CORRECTED`, `IDEMPOTENCY_KEY_REQUIRED`.
- `error.message` — a full sentence a store keeper can read.
- `error.details` — optional structured extras (who holds it, which window clashed).
- `requestId` — for matching against server logs.

The frontend renders `message` directly. It never invents its own wording.

### Security (within the spec's scope)

- Helmet-style headers and a locked-down CORS origin.
- Rate limiting on write endpoints (Nest's built-in throttler) — cheap protection against the replay storm they will run.
- No secrets in the repo; connection string via environment variable, with an example file.
- Mongoose schemas plus the whitelisting validation pipe prevent operator injection from request bodies.
- Request-size limit.
- Structured logging with the request id; no personal data beyond names, which are invented for the test.
- Explicitly **not** done, and said so: authentication, authorization, transport security, audit of who *read* what.

---

## 11. Testing strategy

**Unit tests** (pure domain, fast, no database)

- The state fold: a sequence of movements → the resulting store state.
- The as-of fold at a boundary instant, before the first movement, and after the last.
- The reservation overlap predicate, including the adjacent case.
- The certification check at expiry-yesterday, expiry-today, expiry-tomorrow.
- Correction chain resolution, including a correction of a correction.
- The timeline validator: return before issue, movement into the middle of a later hold.

**Integration tests** (Nest + the same standalone Mongo, separate test database, cleaned per run)

- Issue → return → re-issue happy path.
- **The concurrency test**: fire 10 simultaneous issue requests for one asset; assert exactly one 201 and nine 409s, and exactly one movement in the collection. This is the single most important test in the suite.
- Idempotent replay: same key twice → one movement, identical response.
- Missing idempotency key → 428.
- Return when not out → 409. Return twice → 409. Return by a different worker → 201, with the returner recorded.
- Cert expired yesterday → 409 with the certificate name in the message.
- Out of service while issued, and while reserved.
- Backdated return before its issue → 409.
- Correction that lands inside a later hold → 409.
- Reservation overlap, past window, inverted window, year-long window → four distinct 409s.
- As-of exactly on a movement timestamp, and before the store existed.

**The invariant checker** (`npm run check:invariants` in the API package)

Reads Mongo directly — not through the API — and asserts:

1. No asset is held by two workers at any instant in the reconstructed timeline.
2. Every `ACTIVE` holding matches exactly what the ledger says is currently held. Claims still `PENDING` or `RELEASING` are reported separately as *unsettled*, not as failures — they are a write in flight, and the checker prints how to settle them (`npm run reconcile`).
3. No reservation overlaps another on the same asset.
4. Every RETURN closes an ISSUE that precedes it.
5. Every correction points at a real, existing movement.
6. No movement has `occurredAt` after `recordedAt` by more than a permitted clock skew.
7. No movement `_id` promised by a settled claim is missing from the ledger — the check that proves the intent-replay path never drops a write.

It prints a pass/fail line per invariant and exits non-zero on failure. It runs against the seeded database and again after the test suite. This is what turns "the ledger is correct" into something the assessor can verify in one command.

**Minimum to satisfy the spec**: the concurrency test, the idempotency test, the correction test, the as-of boundary tests, and the invariant checker.

---

## 12. Edge cases and tricky business rules

Decisions I am making, all to be written into the README:

1. **Out of service while reserved** → future `PENDING` reservations are **cancelled** with reason "asset taken out of service", not deleted. They stay visible with their cancellation recorded.
2. **Out of service while issued** → the asset is **not** force-returned. It is marked unserviceable from that instant, the holder keeps it, and it cannot be re-issued once it comes back until someone brings it back into service.
3. **Return by a non-holder** → allowed and recorded. The spec says a return may come from a different worker. Both the holder and the returner appear in the history.
4. **Damaged return** → writes two movements in one transaction: the RETURN, then an OUT_OF_SERVICE at the same instant.
5. **As-of boundary** → inclusive. An instant exactly on a movement's timestamp sees that movement as having happened.
6. **As-of before the store existed** → returns a valid, empty-ish store: assets not yet added are shown as "not yet in the store", not silently as "in store".
7. **As-of and corrections** → an as-of query applies *all* corrections, including ones recorded after the instant asked about. Reason: "who held the gas detector at 14:20" wants the truth, not the mistake that was later fixed. The mistake remains fully visible in the asset's history and the ledger. (A second "as known at" axis is possible and is listed as optional polish.)
8. **Ordering ties** → movements at the identical instant are ordered by `occurredAt`, then `recordedAt`, then `_id`, so the fold is deterministic.
9. **Issue against a reservation** → if a reservation is active now for another worker, issue is refused. For the same worker, the reservation is marked `COLLECTED` and linked to the movement.
10. **Never-collected reservation** → derived, not stored: `PENDING` with `endsAt` in the past. No background job.
11. **Overdue** → derived: currently held with `dueAt` before now. Not a stored state.
12. **Reservation windows** → half-open `[start, end)` at minute precision, so a window ending 10:00 and one starting 10:00 both stand.
13. **Year-long reservation** → refused, 30-day cap. The spec does not state a cap; this is my judgement call, documented.
14. **Correcting a correction** → allowed. The chain is followed to its tip; the whole chain renders in the history.
15. **Correcting a movement that a later movement depends on** → revalidated against the whole timeline, and refused if it would break it.
16. **Clock skew** → `recordedAt` always comes from the server, never the client. `occurredAt` may come from the client but cannot be in the future.
17. **API killed mid-request** → the browser shows an error rather than a claim. Server-side, one of three things is true: the claim was never taken and nothing was written; or the claim was taken and its movements written, and the next read of that asset settles it; or the claim was taken and the movements not yet written, and the next write or read of that asset replays the stored intent using its pre-generated `_id`s. In every case the asset ends up with one holder and one movement.
18. **Timezones** → everything stored UTC, displayed in the browser's local zone, with the raw ISO value shown on hover in the ledger.
19. **Two writes to the same asset at the same moment** → the second gets `409 ASSET_BUSY` from the lease and may be retried by a human. It is a distinct code from `ASSET_ALREADY_HELD`, because "try again in a second" and "Amir has it" are different sentences for a store keeper.
20. **A process dies holding a lease** → the lease carries `expiresAt` (10s) and is compared on acquire, so it frees itself. No dead process can hold an asset hostage, and no stuck lock needs a manual clear.

---

## 13. Folder structure

```
equipment-ledger/
├─ README.md
├─ .gitignore
│
├─ backend/                        # NestJS
│  ├─ src/
│  │  ├─ main.ts
│  │  ├─ app.module.ts
│  │  ├─ common/
│  │  │  ├─ errors/                # domain error types + HTTP mapping
│  │  │  ├─ idempotency/           # header guard, store, interceptor
│  │  │  ├─ locking/               # asset lease: acquire, release, expiry
│  │  │  ├─ write-path/            # claim → apply intent → settle, + replay
│  │  │  └─ filters/               # error shape, request id
│  │  ├─ domain/                   # PURE. no database imports.
│  │  │  ├─ state-fold.ts
│  │  │  ├─ as-of.ts
│  │  │  ├─ corrections.ts
│  │  │  ├─ timeline-rules.ts
│  │  │  ├─ certification.ts
│  │  │  └─ reservation-overlap.ts
│  │  ├─ persistence/
│  │  │  ├─ schemas/               # asset, worker, keeper, movement, reservation,
│  │  │  │                         # holding, lock, idempotency
│  │  │  └─ repositories/
│  │  ├─ modules/
│  │  │  ├─ assets/
│  │  │  ├─ workers/
│  │  │  ├─ keepers/
│  │  │  ├─ movements/             # issue, return, corrections
│  │  │  ├─ reservations/
│  │  │  └─ ledger/                # as-of + history
│  │  └─ scripts/
│  │     ├─ seed.ts
│  │     ├─ check-invariants.ts
│  │     └─ reconcile.ts           # settle any unfinished claim
│  ├─ test/
│  │  ├─ unit/
│  │  └─ e2e/
│  │     ├─ concurrency.e2e-spec.ts
│  │     ├─ idempotency.e2e-spec.ts
│  │     ├─ crash-recovery.e2e-spec.ts
│  │     ├─ corrections.e2e-spec.ts
│  │     ├─ reservations.e2e-spec.ts
│  │     └─ as-of.e2e-spec.ts
│  ├─ .env.example
│  └─ package.json
│
└─ frontend/                       # Next.js
   ├─ src/
   │  ├─ app/
   │  │  ├─ layout.tsx             # QueryClientProvider + Toaster
   │  │  ├─ page.tsx               # store board
   │  │  ├─ assets/[code]/page.tsx
   │  │  ├─ as-of/page.tsx
   │  │  ├─ ledger/page.tsx
   │  │  └─ workers/page.tsx
   │  ├─ components/
   │  ├─ hooks/                    # useAssets, useIssue, … (TanStack Query)
   │  ├─ stores/                   # keeper, as-of (Zustand)
   │  ├─ schemas/                  # Zod, one per dialog
   │  └─ lib/                      # api client, idempotency keys, dates
   ├─ .env.example
   └─ package.json
```

Two plain npm projects. No workspace tooling.

---

## 14. Implementation order

### Phase 0 — Ground *(~30 min)*
Repo, git init, `backend/` Nest scaffold and `frontend/` Next scaffold with Tailwind, TanStack Query provider, react-hot-toast `Toaster`, env examples, README skeleton. Connects to the local standalone MongoDB — no Docker, no replica set, nothing to install.
**Deliverable:** both apps start, API reports a healthy database connection.

### Phase 1 — Model and indexes *(~45 min)*
Schemas for all seven collections. Every index created explicitly, including the unique holding key. Pure domain functions for the state fold and as-of, with their unit tests.
**Deliverable:** `npm test` green on the pure domain; indexes visible in Mongo.

### Phase 2 — Seed *(~50 min)*
Deterministic, re-runnable seed: 60 assets, 12 workers, 30 days of movements including outstanding, overdue, late-logged and corrected entries, plus past and future reservations with one never collected.
**Deliverable:** `npm run seed` twice gives a byte-identical store.

### Phase 3 — Read API *(~50 min)*
Assets, workers, keepers, movements, reservations, asset history, and the as-of endpoint. All derived from the ledger.
**Deliverable:** the as-of endpoint answers "an hour ago" correctly against the seeded data.

### Phase 4 — Issue and return *(~100 min)* ← **the heart of it**
The asset lease with expiry and bounded retry, the claim → apply-intent → settle write path, the unsettled-claim replay, the idempotency interceptor, certification gating, timeline validation, the domain error → HTTP mapping.
**Deliverable:** concurrency test passes — 10 simultaneous issues, one winner. Idempotency test passes. Crash-recovery test passes: a claim taken with its movement withheld is replayed to exactly one movement.

### Phase 5 — Reservations and service status *(~50 min)*
Create, cancel, overlap refusal, the window validations, out-of-service and back-in-service including the cancel-standing-reservations decision.
**Deliverable:** all reservation and service edge-case tests pass.

### Phase 6 — Corrections *(~45 min)*
Append-only corrections, chain resolution, revalidation against the whole timeline, history rendering data.
**Deliverable:** a backdated return can be corrected, and the history shows both entries.

### Phase 7 — Invariant checker *(~40 min)*
The seven checks, a readable report, non-zero exit on failure, plus `npm run reconcile`.
**Deliverable:** `npm run check:invariants` passes against the seeded store.

### Phase 8 — Frontend *(~2 h)*
Store board, asset life page with all five dialogs, as-of page with the slider, ledger page, workers page. TanStack Query hooks, Zustand keeper and as-of stores, React Hook Form + Zod dialogs, toasts and error banners. No optimistic updates.
**Deliverable:** the whole main scenario can be driven from the browser.

### Phase 9 — README and recording *(~45 min)*
Every README bullet the spec lists, then the 2–3 minute recording: issue, refused issue, backdated return, correction, as-of.
**Deliverable:** submission-ready.

> That is roughly 9 hours 35 minutes of work against an 8-hour budget, which is why section 15 exists.

---

## 15. MVP versus polish

**Must ship — cutting any of these fails the test**

- Issue, return, reserve, reconstruct.
- One holder under concurrency, with the guarantee demonstrable, on a plain local MongoDB.
- The unsettled-claim replay. Without it the no-transaction design has a hole, so it is not optional.
- Idempotency on every write.
- `occurredAt` and `recordedAt` as separate fields.
- Corrections that leave the original visible.
- The as-of endpoint and page.
- Deterministic, repeatable seed.
- The invariant checker.
- The concurrency test.
- README and recording.

**Cut first if time runs short, in this order**

1. `/workers` page — fold the certification info into the issue dialog instead.
2. `/ledger` page — the asset history page already shows the ledger, per asset.
3. Search and filtering on the store board — a plain list is acceptable at 60 assets.
4. Pagination — 60 assets and 30 days fit on one page.
5. Rate limiting.
6. Back-in-service — leave out-of-service one-way and say so.
7. Styling polish — plain, legible, unstyled-but-tidy is fine.

**Never cut, even under time pressure**

- The invariant checker and the concurrency test. They are the evidence. A thinner UI with proof beats a pretty UI without it — the spec says so directly.

**Optional polish, only if hours remain**

- The second time axis: "as the store *believed* it at time T", using `recordedAt`.
- Snapshotting the fold for large ledgers.
- A per-asset "who held this longest" summary.
- Server-sent updates so two open tabs stay in step.

---

## 16. Final verification checklist

**Functional**

- [ ] FR-1 Issue an asset to a worker now
- [ ] FR-2 Issue against an existing reservation
- [ ] FR-3 Return an asset
- [ ] FR-4 Return from a non-holder, recorded
- [ ] FR-5 Damaged return sends the asset out of service
- [ ] FR-6 Reserve a future window
- [ ] FR-7 Overlapping reservations impossible
- [ ] FR-8 Whole store at any past instant
- [ ] FR-9 Full life of one asset
- [ ] FR-10 Asset identity, kind, certification requirement, service status
- [ ] FR-11 Worker certifications with expiry
- [ ] FR-12 Movements are the ledger

**Invariants**

- [ ] FR-13 One holder ever, proven under 10 simultaneous requests
- [ ] FR-14 Reservations never share a minute; adjacent allowed
- [ ] FR-15 Expired certification refuses issue, readable reason
- [ ] FR-16 Out-of-service blocks issue and new reservations; standing reservations resolved by a stated decision
- [ ] FR-17 `occurredAt` and `recordedAt` are separate and both shown
- [ ] FR-18 Corrections append; history shows the correction
- [ ] FR-19 Replay, double-click and mid-submit refresh produce one movement
- [ ] FR-20 As-of computed from the ledger with no cache in the path

**Seed**

- [ ] FR-21 ~60 assets, several kinds, some cert-gated, ≥1 out of service
- [ ] FR-22 ~12 workers, ≥1 expired cert, ≥1 expiring in window
- [ ] FR-23 30 days of movements: outstanding, ≥1 overdue, ≥1 late-logged, ≥1 correction
- [ ] FR-24 Reservations past and future, ≥1 never collected
- [ ] FR-25 Seeding twice does not double; output is deterministic

**Their attack list**

- [ ] Two tabs, two simultaneous issues → exactly one wins
- [ ] Same payload replayed → one movement
- [ ] Refresh mid-submit → one movement
- [ ] Cert expired yesterday → refused, readable
- [ ] Out of service while issued → handled per stated decision
- [ ] Out of service while reserved → handled per stated decision
- [ ] Return an asset that isn't out → refused
- [ ] Return twice → refused
- [ ] Return as a different worker → allowed and recorded
- [ ] Backdate a return before its issue → refused
- [ ] Backdate into the middle of a later hold → refused
- [ ] Reserve in the past → refused
- [ ] Reserve ending before it starts → refused
- [ ] Reserve for a year → refused
- [ ] As-of exactly on a timestamp → inclusive, documented
- [ ] As-of before the store existed → clean answer
- [ ] API killed mid-request → browser shows an error; server settles to exactly one movement, never two and never a lost one
- [ ] Raw Mongo agrees with every screen
- [ ] Reasoning ready for the "why" conversation

**Delivery**

- [ ] FR-26 Real commit history, one commit per phase
- [ ] FR-27 README: run both sides, seed, invariant checks, the model and why, how concurrent issue was made impossible, what another day would buy, what was left out
- [ ] FR-28 `npm run check:invariants` exists and passes
- [ ] FR-29 Recording, 2–3 min: issue, refused issue, backdated return, correction, as-of
- [ ] FR-30 No auth, roles, email, uploads, barcodes, mobile or multi-site; keeper and worker picked from a list

---

## Open Questions & Assumptions

### A template/spec conflict, resolved in favour of the spec

- The requested plan template asks for authentication and authorization with roles and permissions. **The spec forbids all of it by name.** Section 9 is therefore written as "no auth, by spec" with the pick-a-name actor model described instead. Auth can be added on request — but it would cost marks against the stated scope discipline.

### Judgement calls I am making (all documented in the README)

1. **Out-of-service resolves standing reservations by cancelling them** with a recorded reason. The spec says to decide and say what I decided.
2. **Out-of-service does not force a return** of an already-issued asset.
3. **Reservations are capped at 30 days.** The spec probes a year-long reservation but names no limit.
4. **Reservation windows are half-open at minute precision**, so adjacent windows both stand — this is my reading of "may not share a minute. Adjacent is fine."
5. **As-of applies all corrections**, including ones recorded after the instant asked about. The alternative reading ("as the store believed it then") is listed as optional polish.
6. **As-of boundary is inclusive** of a movement at exactly that instant.
7. **A return from a non-holder is allowed and recorded**, based on section 01's "possibly from a different worker".
8. **Service changes live in the movements collection**, not a separate one, so "as of" is one fold over one log.
9. **Runnable invariant checks are treated as a hard requirement**, inferred from the README bullet "how to run the invariant checks".
10. **Mongo runs standalone, and there are no transactions.** The guarantee comes from a per-asset lease plus a unique `_id` on `asset_holdings` — both atomic on any MongoDB. The trade is explicit: the app installs and runs against an ordinary local MongoDB with zero setup, and in exchange crash recovery between the claim and its movement is handled by intent-replay in my code instead of by the storage engine. Section 7 states the window; the README states it too.
11. **A worker may hold several different assets at once.** The spec constrains one holder per asset, not one asset per holder.
12. **Times are stored UTC and displayed in the browser's local zone.** The spec is silent on timezones.

### Genuine open questions — assumed unless told otherwise

- Should an asset with a reservation starting in ten minutes be issuable to someone else right now? *Assumption: yes — only a currently-active reservation blocks.*
- Is a "correction" allowed to change *who* held the asset, or only *when*? *Assumption: both, subject to full timeline revalidation.*
- Can a movement be corrected more than once? *Assumption: yes, chains are supported.*
- Should the seed's 30 days end at a fixed date or at today? *Assumption: a fixed anchor date so the store is byte-identical on every run, with "today" derived from it — otherwise "deterministic" is impossible.*

---

## Requirement Traceability

| Req | Spec source | Plan sections |
|---|---|---|
| FR-1, FR-2 Issue | §01 Issue | 6, 7, 8, 12, 14 (Ph4) |
| FR-3–FR-5 Return | §01 Return | 6, 7, 8, 12, 14 (Ph4) |
| FR-6, FR-7 Reserve | §01 Reserve | 6, 7, 10, 12, 14 (Ph5) |
| FR-8, FR-9 Reconstruct | §01 Reconstruct | 6, 7, 8, 12, 14 (Ph3) |
| FR-10 Asset | §02 Domain | 6, 12, 14 (Ph1) |
| FR-11 Worker | §02 Domain | 6, 9, 14 (Ph1) |
| FR-12 Movement is the ledger | §02 Domain | 6, 7, 14 (Ph1) |
| FR-13 One holder ever | §03 rule 1 + concurrency note | 6, 7, 11, 14 (Ph4) |
| FR-14 No overlapping reservations | §03 rule 2 | 6, 10, 12, 14 (Ph5) |
| FR-15 Certification gates issue | §03 rule 3 | 10, 11, 12, 14 (Ph4) |
| FR-16 Out of service is real | §03 rule 4 | 10, 12, 14 (Ph5) |
| FR-17 Late entries | §03 rule 5 | 6, 8, 12, 14 (Ph1) |
| FR-18 Corrections not erasures | §03 rule 6 | 6, 8, 12, 14 (Ph6) |
| FR-19 Nothing lands twice | §03 rule 7 | 7, 8, 10, 11, 14 (Ph4) |
| FR-20 Any instant, answerable | §03 rule 8 | 6, 7, 12, 14 (Ph3) |
| FR-21–FR-25 Seed | §04 Data | 14 (Ph2), 16 |
| Attack list | §05 Assessment | 5, 11, 12, 16 |
| FR-26 Git history | §06 Deliverables | 4, 14 |
| FR-27 README | §06 Deliverables | 4, 6, 12, 14 (Ph9) |
| FR-28 Invariant checks | §06 README bullet | 11, 13, 14 (Ph7) |
| FR-29 Recording | §06 Deliverables | 14 (Ph9), 16 |
| FR-30 Scope limits | §01 Scope discipline | 4, 9, 15 |

---

## Appendix — Code style and interview readiness

The spec ends with: *"Then we will ask you why you built it that way. Bring your reasoning, not your library list."* That conversation is only survivable if the code is genuinely simple and I genuinely understand every line of it. So style is not decoration here — it is part of passing.

### Style rules for every phase

- **Boring over clever.** No generic abstractions, no dependency-injection gymnastics, no metaprogramming. If a plain function works, it is a plain function.
- **No speculative layers.** A repository exists only where a real second caller exists. No interfaces with one implementation.
- **Short files.** If a file passes ~200 lines, it is doing two jobs and gets split.
- **Names say the domain, not the pattern.** `resolveCorrectionChain`, not `CorrectionChainResolverServiceImpl`.
- **Comments explain *why*, never *what*.** The only comments in the codebase are on the non-obvious decisions: why the `writeSeq` bump exists, why as-of applies later corrections, why the holding collection is a guard and not a cache.
- **One error path.** Every refusal is a typed domain error with a code and a human sentence. No scattered `throw new Error('bad')`.
- **Consistent shape across use cases.** Issue, return, correct and reserve all follow the same eight-step write path from section 7. A reviewer learns it once.
- **No dead code, no commented-out blocks, no TODOs** in the submitted repo.

### Understand-it-before-you-ship-it rule

Nothing goes into a commit that I cannot explain out loud. At the end of each phase I check:

- Can I explain what this phase's code does, in one paragraph, without reading it?
- Can I name the alternative I rejected and why?
- Do I know what this choice costs?

If any answer is no, the code gets simplified until all three are yes.

### The "why did you build it that way" prep list

Answers to have ready before the interview — each one written into the README:

1. Why an append-only ledger instead of mutable rows with a current-state field.
2. Why service changes live in the same log as issues and returns.
3. Exactly which line makes a double issue impossible — the `insertOne` into `asset_holdings` on a `_id` that is unique by definition — and what it costs (per-asset write serialisation, two round trips per write, my own crash recovery).
4. Why there are no transactions, what standalone MongoDB refuses, and why I chose zero-setup correctness over a replica set requirement.
5. Why the intent is written *before* the movement, and why pre-generating the movement `_id` is what makes replaying it safe.
6. Why `asset_holdings` is a guard and not a cache, and how the invariant checker proves it stays in step.
7. Why idempotency is enforced server-side rather than by disabling the button.
8. Why TanStack Query has `retry: false` on writes even though idempotency keys make a retry safe.
9. Why as-of applies corrections recorded after the instant asked about.
10. Why reservations are half-open intervals, and why the minute-slot alternative was rejected (a year-long reservation would be 525,600 documents).
11. What another day would buy: the second time axis, snapshots, and richer filtering.
12. What was knowingly left out and why.

### On disclosure

If the employer asks whether AI tooling was used, answer honestly. Writing code specifically to disguise its origin is not part of this plan — the goal is code so plain and so well understood that the question does not matter.

---

**Next step:** waiting for approval before Phase 0. No code, scaffolding, or config has been created.
