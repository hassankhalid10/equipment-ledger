# Progress

Status tracker for [PLAN.md](PLAN.md). Phases and their deliverables are defined there;
this file only records what is done.

**Now:** Phase 6 complete. Phase 7 (invariant checker + reconcile) is next.

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
| 6 | Corrections | ✅ done | *(pending commit)* |
| 7 | Invariant checker + reconcile | ⬜ next | |
| 8 | Frontend — five pages, five dialogs | ⬜ | |
| 9 | README and recording | ⬜ | |

---

## What runs today

```bash
cd backend  && npm run start:dev   # 127.0.0.1:3001/health -> {"status":"ok"}
cd frontend && npm run dev         # 127.0.0.1:3000
cd backend  && npm run seed        # deterministic; re-run gives the same store
cd backend  && npm test            # 38 unit tests, ~1s, no database
cd backend  && npm run test:e2e    # 55 e2e tests, ~17s, real MongoDB (own test db, see below)
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
deterministic seed, the full read API, and every write: issue/return with the
concurrency guarantee (10 simultaneous issues → 1 winner, proven under test),
crash-recovery replay for the no-transaction write path, reservations with
overlap/window validation, out-of-service/back-in-service with the standing-
reservation cancellation, and corrections with full-timeline revalidation.

**Not built yet:** the invariant checker, `npm run reconcile`, and the frontend.

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
