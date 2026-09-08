import { Types } from 'mongoose';
import { runInvariantChecks } from './check-invariants-core.js';
import type { InvariantInput } from './check-invariants-core.js';

const at = (iso: string) => new Date(iso);
const id = () => new Types.ObjectId();

/** A small, entirely valid store: one asset, issued and returned cleanly,
 * one live reservation, one correction. Every check should pass on this. */
function validStore(): InvariantInput {
  const assetId = id();
  const workerId = id();
  const keeperId = id();
  const issueId = id();
  const correctionId = id();
  const returnId = id();
  const reservationId = id();

  return {
    assets: [
      {
        _id: assetId,
        code: 'TEST-001',
        name: 'Test asset',
        kind: 'test',
        requiredCertification: null,
        addedToStoreAt: at('2020-01-01T00:00:00Z'),
      },
    ],
    movements: [
      {
        _id: issueId,
        assetId,
        type: 'ISSUE',
        occurredAt: at('2026-01-01T09:00:00Z'),
        recordedAt: at('2026-01-01T09:00:00Z'),
        keeperId,
        workerId,
        returnedByWorkerId: null,
        dueAt: null,
        condition: null,
        reservationId: null,
        correctsMovementId: null,
        correctionReason: null,
        reason: null,
        note: null,
      },
      {
        _id: correctionId,
        assetId,
        type: 'ISSUE',
        occurredAt: at('2026-01-01T09:00:00Z'),
        recordedAt: at('2026-01-01T10:00:00Z'),
        keeperId,
        workerId,
        returnedByWorkerId: null,
        dueAt: null,
        condition: null,
        reservationId: null,
        correctsMovementId: issueId,
        correctionReason: 'fixed the note',
        reason: null,
        note: null,
      },
      {
        _id: returnId,
        assetId,
        type: 'RETURN',
        occurredAt: at('2026-01-02T09:00:00Z'),
        recordedAt: at('2026-01-02T09:00:00Z'),
        keeperId,
        workerId: null,
        returnedByWorkerId: workerId,
        dueAt: null,
        condition: 'OK',
        reservationId: null,
        correctsMovementId: null,
        correctionReason: null,
        reason: null,
        note: null,
      },
    ] as InvariantInput['movements'],
    reservations: [
      {
        _id: reservationId,
        assetId,
        workerId,
        startsAt: at('2026-02-01T09:00:00Z'),
        endsAt: at('2026-02-01T17:00:00Z'),
        status: 'PENDING',
      },
    ] as InvariantInput['reservations'],
    holdings: [],
    now: at('2026-03-01T00:00:00Z'),
  };
}

function byName(results: ReturnType<typeof runInvariantChecks>, n: number) {
  const r = results.find((x) => x.name.startsWith(`${n}.`));
  if (!r) throw new Error(`no check numbered ${n}`);
  return r;
}

describe('runInvariantChecks - the valid store', () => {
  it('passes every check', () => {
    const results = runInvariantChecks(validStore());
    for (const r of results) expect(r.pass).toBe(true);
  });
});

describe('runInvariantChecks - check 1, no double hold', () => {
  it('fails when two ISSUEs land with no RETURN between them', () => {
    const store = validStore();
    const assetId = store.assets[0]._id;
    store.movements = store.movements.filter((m) => m.type !== 'RETURN');
    store.movements.push({
      _id: id(),
      assetId,
      type: 'ISSUE',
      occurredAt: at('2026-01-05T09:00:00Z'),
      recordedAt: at('2026-01-05T09:00:00Z'),
      keeperId: id(),
      workerId: id(),
      returnedByWorkerId: null,
      dueAt: null,
      condition: null,
      reservationId: null,
      correctsMovementId: null,
      correctionReason: null,
      reason: null,
      note: null,
    } as InvariantInput['movements'][number]);

    const result = byName(runInvariantChecks(store), 1);
    expect(result.pass).toBe(false);
    expect(result.failures[0]).toContain('TEST-001');
  });
});

describe('runInvariantChecks - check 2, guard matches the ledger', () => {
  it('reports a PENDING claim as informational, not a failure', () => {
    const store = validStore();
    store.holdings = [
      {
        _id: store.assets[0]._id,
        state: 'PENDING',
        workerId: id(),
        issueMovementId: id(),
        claimedAt: at('2026-03-01T00:00:00Z'),
      },
    ];
    const result = byName(runInvariantChecks(store), 2);
    expect(result.pass).toBe(true);
    expect(result.info).toHaveLength(1);
    expect(result.info![0]).toContain('reconcile');
  });

  it('fails when the guard says held but the ledger disagrees', () => {
    const store = validStore(); // ledger: returned, so not held
    store.holdings = [
      {
        _id: store.assets[0]._id,
        state: 'ACTIVE',
        workerId: id(),
        issueMovementId: id(),
        claimedAt: at('2026-01-01T09:00:00Z'),
      },
    ];
    const result = byName(runInvariantChecks(store), 2);
    expect(result.pass).toBe(false);
  });
});

describe('runInvariantChecks - check 3, no reservation overlap', () => {
  it('fails when two live reservations on one asset share a minute', () => {
    const store = validStore();
    const assetId = store.assets[0]._id;
    store.reservations.push({
      _id: id(),
      assetId,
      workerId: id(),
      startsAt: at('2026-02-01T16:00:00Z'),
      endsAt: at('2026-02-01T20:00:00Z'),
      status: 'PENDING',
    } as InvariantInput['reservations'][number]);

    const result = byName(runInvariantChecks(store), 3);
    expect(result.pass).toBe(false);
  });

  it('passes when two reservations only share an edge', () => {
    const store = validStore();
    const assetId = store.assets[0]._id;
    store.reservations.push({
      _id: id(),
      assetId,
      workerId: id(),
      startsAt: at('2026-02-01T17:00:00Z'), // exactly when the fixture reservation ends
      endsAt: at('2026-02-01T20:00:00Z'),
      status: 'PENDING',
    } as InvariantInput['reservations'][number]);

    expect(byName(runInvariantChecks(store), 3).pass).toBe(true);
  });
});

describe('runInvariantChecks - check 4, every RETURN closes an ISSUE', () => {
  it('fails when a RETURN has no open hold to close', () => {
    const store = validStore();
    store.movements = store.movements.filter((m) => m.type === 'RETURN');
    const result = byName(runInvariantChecks(store), 4);
    expect(result.pass).toBe(false);
  });
});

describe('runInvariantChecks - check 5, corrections point at real movements', () => {
  it('fails when correctsMovementId names a movement that does not exist', () => {
    const store = validStore();
    store.movements = store.movements.map((m) =>
      m.type === 'ISSUE' && m.correctsMovementId
        ? { ...m, correctsMovementId: id() }
        : m,
    );
    const result = byName(runInvariantChecks(store), 5);
    expect(result.pass).toBe(false);
  });
});

describe('runInvariantChecks - check 6, clock skew', () => {
  it('fails when occurredAt lands well after recordedAt', () => {
    const store = validStore();
    store.movements = store.movements.map((m, i) =>
      i === 0 ? { ...m, occurredAt: at('2026-01-01T09:05:00Z'), recordedAt: at('2026-01-01T09:00:00Z') } : m,
    );
    const result = byName(runInvariantChecks(store), 6);
    expect(result.pass).toBe(false);
  });

  it('passes a late-logged entry (occurredAt well BEFORE recordedAt)', () => {
    const store = validStore();
    store.movements = store.movements.map((m, i) =>
      i === 0 ? { ...m, occurredAt: at('2026-01-01T09:00:00Z'), recordedAt: at('2026-01-05T09:00:00Z') } : m,
    );
    expect(byName(runInvariantChecks(store), 6).pass).toBe(true);
  });
});

describe('runInvariantChecks - check 7, settled claims have their movement', () => {
  it('fails when an ACTIVE holding names a movement that was never written', () => {
    const store = validStore();
    store.holdings = [
      {
        _id: store.assets[0]._id,
        state: 'ACTIVE',
        workerId: id(),
        issueMovementId: id(), // not among store.movements
        claimedAt: at('2026-01-01T09:00:00Z'),
      },
    ];
    // Make the ledger agree it's held too, so only check 7 fires.
    store.movements = store.movements.filter((m) => m.type !== 'RETURN');

    const result = byName(runInvariantChecks(store), 7);
    expect(result.pass).toBe(false);
  });
});
