# Progress

Status tracker for [PLAN.md](PLAN.md). Phases and their deliverables are defined there;
this file only records what is done.

**Now:** Phase 1 complete. Phase 2 (seed) is next.

---

## Phases

| # | Phase | Status | Commit |
|---|---|---|---|
| 0 | Ground — scaffolds, health, repo hygiene | ✅ done | `82103db` `c4653fc` `9fc58ba` |
| 1 | Model — domain rules, schemas, indexes | ✅ done | `3a2baee` `2639439` |
| 2 | Seed — 60 assets, 12 workers, 30 days | ⬜ next | |
| 3 | Read API — assets, history, as-of | ⬜ | |
| 4 | **Issue and return** — the concurrency guarantee | ⬜ | |
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
cd backend  && npm test            # 27 unit tests, ~1s, no database
cd backend  && npm run test:e2e    #  6 e2e tests, ~3s, real MongoDB
```

**Built so far:** the pure domain (state fold, as-of, corrections, reservation overlap,
certification) and all eight collections with their indexes. Both apps start and the
API reports a live database connection.

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
