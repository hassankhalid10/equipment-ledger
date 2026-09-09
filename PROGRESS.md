# Progress

Status tracker for [PLAN.md](PLAN.md). Phases and their deliverables are defined there;
this file only records what is done.

**Now:** Phase 8 complete. Phase 9 (README and recording) is next — the last one.

---

## Phases

| # | Phase | Status | Commit |
|---|---|---|---|
| 0 | Ground — scaffolds, health, repo hygiene | ✅ done | `82103db` `c4653fc` `9fc58ba` |
| 1 | Model — domain rules, schemas, indexes | ✅ done | `3a2baee` `2639439` |
| 2 | Seed — 60 assets, 12 workers, 30 days | ✅ done | `83ed6de` |
| 3 | Read API — assets, history, as-of | ✅ done | `56bc6c0` `3b3c04b` |
| 4 | **Issue and return** — the concurrency guarantee | ✅ done | `771e4ea` `4f1af54` `4d5d970` `c3fc47c` |
| 5 | Reservations and service status | ✅ done | `08bc4a8` `8891f99` `985ecfe` `81f4f6e` |
| 6 | Corrections | ✅ done | `6fb2c35` `6c70756` |
| 7 | Invariant checker + reconcile | ✅ done | `4122208` `d3b37eb` |
| 8 | Frontend — five pages, six dialogs | ✅ done | *(pending commit)* |
| 9 | README and recording | ⬜ next | |

---

## What runs today

```bash
cd backend  && npm run start:dev   # 127.0.0.1:3001/health -> {"status":"ok"}
cd frontend && npm run dev         # 127.0.0.1:3000
cd backend  && npm run seed        # deterministic; re-run gives the same store
cd backend  && npm test              # 50 unit tests, <1s, no database
cd backend  && npm run test:e2e      # 55 e2e tests, ~17s, real MongoDB (own test db, see below)
cd backend  && npm run check:invariants   # 7 checks against the real store, exits non-zero on failure
cd backend  && npm run reconcile          # settles any claim still mid-flight
```

Read endpoints, all against `127.0.0.1:3001`: `GET /assets` (status/kind/q filters),
`/assets/:code`, `/assets/:code/history`, `/ledger/as-of?at=<ISO>`, `/movements`
(paginated), `/reservations`, `/workers`, `/workers/:id`, `/keepers`.

Write endpoints, all requiring an `Idempotency-Key` header (428 if missing):
`POST /movements/issue`, `/movements/return`, `/movements/:id/corrections`,
`/reservations`, `/reservations/:id/cancel`, `/assets/:id/out-of-service`,
`/assets/:id/back-in-service`.

e2e tests run against `equipment_ledger_test`, never the dev database `npm run seed`
fills — kept separate after a real bug where parallel test files corrupted the dev
seed (Phase 4d). Files run sequentially (`fileParallelism: false`) since several
assert exact collection counts against data they seed themselves.

**Built so far:** the pure domain, all eight collections and indexes, the
deterministic seed, the full read API, every write (issue/return with the
concurrency guarantee, reservations, service status, corrections), and the
invariant checker + reconcile — the whole backend the plan called for.

The checker's logic (`check-invariants-core.ts`) is a pure function, same split
as the seed: 11 unit tests build deliberately broken stores, one per check, with
no database. It also caught a real bug the moment it first ran against the
seeded store: Phase 2's "adjacent reservations sharing an edge" pair actually
overlapped for nine hours, because the seed's day-granularity helper defaulted
both to 08:00 regardless of what the comment claimed. Fixed in the seed, and a
seed-data.spec.ts test now asserts no two live reservations on one asset
overlap, closing the gap that let it through undetected in Phase 2.

**The frontend** covers all five routes — store board, asset life, as-of, ledger,
workers — and every write endpoint has a way to reach it: six dialogs, each a
React Hook Form + Zod form that mints one idempotency key when it opens and
reuses it for every retry of that submit.

Two rules live in `useWrite.ts` rather than being repeated per dialog, because
both are things the spec's attack list probes directly:

- **No optimistic updates.** `onMutate` appears nowhere in the app. A write
  shows pending, then either the server's confirmed truth or an explicit error.
  The UI never claims a movement happened.
- **`retry: false` on mutations.** The idempotency key makes a retry safe, but a
  silent one would hide exactly the mid-request failure being provoked.

**Not built yet:** the README's four "why" sections and the screen recording.

---

## Deviations from the plan

Recorded in PLAN.md where they apply; listed here so they are not lost.

| Planned | Actual | Why |
|---|---|---|
| Mongo replica set + transactions | Standalone, per-asset lease + unique holding key | Runs on an ordinary local MongoDB with no setup. Cost — the crash window — is documented in PLAN.md §7. |
| Jest | Vitest | What the Nest 12 scaffold ships. |
| `@nestjs/throttler` | Dropped | No Nest 12 support, and rate limiting was already first on the cut list. |
| `api/` and `web/` | `backend/` and `frontend/` | Matches the folders already in use. |
| — | e2e tests use `equipment_ledger_test`, sequential files | Real bug found in Phase 4d: parallel e2e files sharing the dev database corrupted the seeded demo data (73 assets instead of 60). Not in the original plan; added once the bug surfaced. |

---

## Open, to settle before Phase 9

- Screen recording (FR-29) is not started.
- README's four "why" sections are still placeholders.

