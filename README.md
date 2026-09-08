# The Equipment Ledger

A replacement for the paper book at a construction-site tool store. Issue an asset,
take it back, reserve it for a future window, and reconstruct the store as it stood
at any past instant.

The plan this is built from is in [PLAN.md](PLAN.md); the original brief is in
[docs/technical-test-spec.html](docs/technical-test-spec.html).

---

## Prerequisites

- Node.js 20+
- A local MongoDB running on `127.0.0.1:27017`

**No replica set, no Docker, nothing to configure.** An ordinary standalone MongoDB
service is enough — see [Concurrency](#how-a-double-issue-was-made-impossible) for why
that was a deliberate design constraint rather than a shortcut.

## Running it

```bash
# backend  -> http://127.0.0.1:3001
cd backend
cp .env.example .env
npm install
npm run start:dev

# frontend -> http://127.0.0.1:3000
cd frontend
cp .env.example .env.local
npm install
npm run dev
```

## Seeding

```bash
cd backend
npm run seed
```

Deterministic and re-runnable: seeding twice gives the same store, not a doubled one.

## Checking the invariants

```bash
cd backend
npm run check:invariants   # reads MongoDB directly, exits non-zero on failure
npm run reconcile          # settles any write interrupted mid-flight
```

## Tests

```bash
cd backend
npm test        # pure domain rules
npm run test:e2e   # includes the concurrency and crash-recovery tests
```

---

## The model, and why

*(written up at the end of the build — see PLAN.md sections 6 and 7 for the design)*

## How a double issue was made impossible

*(to be written — the per-asset lease and the unique holding key)*

## What another day would buy

*(to be written)*

## What was knowingly left out

*(to be written)*
