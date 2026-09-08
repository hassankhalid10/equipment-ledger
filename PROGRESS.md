# Progress

Status tracker for [PLAN.md](PLAN.md). Phases and their deliverables are defined there;
this file only records what is done.

**Now:** Phase 3 complete. Phase 4 (issue and return — the concurrency guarantee) is next.

---

## Phases

| # | Phase | Status | Commit |
|---|---|---|---|
| 0 | Ground — scaffolds, health, repo hygiene | ✅ done | `82103db` `c4653fc` `9fc58ba` |
| 1 | Model — domain rules, schemas, indexes | ✅ done | `3a2baee` `2639439` |
| 2 | Seed — 60 assets, 12 workers, 30 days | ✅ done | `83ed6de` |
| 3 | Read API — assets, history, as-of | ✅ done | `56bc6c0` `3b3c04b` |
| 4 | **Issue and return** — the concurrency guarantee | ⬜ next | |
| 5 | Reservations and service status | ⬜ | |
| 6 | Corrections | ⬜ | |
| 7 | Invariant checker + reconcile | ⬜ | |
| 8 | Frontend — five pages, five dialogs | ⬜ | |
| 9 | README and recording | ⬜ | |

---

## What runs today

```bash
cd backend  && npm run start:dev   # 127.0.0.1:3001/health -> {"status":"ok"}
cd frontend && npm run dev         # 127.0.0.1:3000
cd backend  && npm run seed        # deterministic; re-run gives the same store
cd backend  && npm test            # 38 unit tests, ~1s, no database
cd backend  && npm run test:e2e    # 23 e2e tests, ~2.5s, real MongoDB
```

Read endpoints, all against `127.0.0.1:3001`: `GET /assets` (status/kind/q filters),
`/assets/:code`, `/assets/:code/history`, `/ledger/as-of?at=<ISO>`, `/movements`
(paginated), `/reservations`, `/workers`, `/workers/:id`, `/keepers`.

**Built so far:** the pure domain (state fold, as-of, corrections, reservation overlap,
certification), all eight collections with their indexes, a deterministic seed —
60 assets, 12 workers, 213 movements, 6 reservations, 7 still out (4 overdue) — and
the full read API, every answer folded from the ledger at request time.

**Not built yet:** every write path. Nothing can issue, return, reserve or correct.

---

## Deviations from the plan

Recorded in PLAN.md where they apply; listed here so they are not lost.

| Planned | Actual | Why |
|---|---|---|
| Mongo replica set + transactions | Standalone, per-asset lease + unique holding key | Runs on an ordinary local MongoDB with no setup. Cost — the crash window — is documented in PLAN.md §7. |
| Jest | Vitest | What the Nest 12 scaffold ships. |
| `@nestjs/throttler` | Dropped | No Nest 12 support, and rate limiting was already first on the cut list. |
| `api/` and `web/` | `backend/` and `frontend/` | Matches the folders already in use. |

---

## Open, to settle before Phase 9

- Screen recording (FR-29) is not started.
- README's four "why" sections are still placeholders.
