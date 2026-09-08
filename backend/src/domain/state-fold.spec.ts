import { foldAssetState } from './state-fold.js';
import { storeAsOf } from './as-of.js';
import type { AssetSummary, Movement, Reservation } from './types.js';

const asset: AssetSummary = {
  id: 'a1',
  code: 'HARN-014',
  addedToStoreAt: new Date('2026-01-01T00:00:00Z'),
};

let seq = 0;
function movement(partial: Partial<Movement> & Pick<Movement, 'type' | 'occurredAt'>): Movement {
  seq += 1;
  return {
    id: `m${seq}`,
    assetId: 'a1',
    keeperId: 'k1',
    recordedAt: partial.occurredAt,
    ...partial,
  };
}

const at = (iso: string) => new Date(iso);

describe('foldAssetState', () => {
  beforeEach(() => {
    seq = 0;
  });

  it('reports an untouched asset as in store', () => {
    const state = foldAssetState({ asset, movements: [], at: at('2026-02-01T10:00:00Z') });
    expect(state.status).toBe('IN_STORE');
    expect(state.holder).toBeUndefined();
    expect(state.violations).toEqual([]);
  });

  it('reports an asset that was not yet in the store', () => {
    const state = foldAssetState({ asset, movements: [], at: at('2025-06-01T00:00:00Z') });
    expect(state.status).toBe('NOT_YET_IN_STORE');
  });

  it('follows issue and return', () => {
    const movements = [
      movement({ type: 'ISSUE', workerId: 'w1', occurredAt: at('2026-02-01T09:00:00Z') }),
      movement({ type: 'RETURN', occurredAt: at('2026-02-01T17:00:00Z') }),
    ];

    const held = foldAssetState({ asset, movements, at: at('2026-02-01T12:00:00Z') });
    expect(held.status).toBe('ISSUED');
    expect(held.holder?.workerId).toBe('w1');

    const back = foldAssetState({ asset, movements, at: at('2026-02-01T18:00:00Z') });
    expect(back.status).toBe('IN_STORE');
    expect(back.holder).toBeUndefined();
  });

  it('treats the as-of boundary as inclusive', () => {
    const movements = [
      movement({ type: 'ISSUE', workerId: 'w1', occurredAt: at('2026-02-01T09:00:00Z') }),
    ];

    const onTheInstant = foldAssetState({ asset, movements, at: at('2026-02-01T09:00:00Z') });
    expect(onTheInstant.status).toBe('ISSUED');

    const oneMsBefore = foldAssetState({ asset, movements, at: at('2026-02-01T08:59:59.999Z') });
    expect(oneMsBefore.status).toBe('IN_STORE');
  });

  it('derives overdue from the due time rather than storing it', () => {
    const movements = [
      movement({
        type: 'ISSUE',
        workerId: 'w1',
        occurredAt: at('2026-02-01T09:00:00Z'),
        dueAt: at('2026-02-01T17:00:00Z'),
      }),
    ];

    expect(foldAssetState({ asset, movements, at: at('2026-02-01T16:00:00Z') }).status).toBe('ISSUED');
    expect(foldAssetState({ asset, movements, at: at('2026-02-01T18:00:00Z') }).status).toBe('OVERDUE');
  });

  it('keeps an asset out of service until it is brought back', () => {
    const movements = [
      movement({ type: 'OUT_OF_SERVICE', occurredAt: at('2026-02-01T09:00:00Z') }),
      movement({ type: 'BACK_IN_SERVICE', occurredAt: at('2026-02-03T09:00:00Z') }),
    ];

    expect(foldAssetState({ asset, movements, at: at('2026-02-02T00:00:00Z') }).status).toBe('OUT_OF_SERVICE');
    expect(foldAssetState({ asset, movements, at: at('2026-02-04T00:00:00Z') }).status).toBe('IN_STORE');
  });

  it('reports out of service even while a worker still holds it', () => {
    const movements = [
      movement({ type: 'ISSUE', workerId: 'w1', occurredAt: at('2026-02-01T09:00:00Z') }),
      movement({ type: 'OUT_OF_SERVICE', occurredAt: at('2026-02-01T10:00:00Z') }),
    ];

    const state = foldAssetState({ asset, movements, at: at('2026-02-01T11:00:00Z') });
    expect(state.status).toBe('OUT_OF_SERVICE');
    // The holder is not forced to hand it back (PLAN.md §12 #2).
    expect(state.holder?.workerId).toBe('w1');
  });

  it('applies a correction, including one recorded after the instant asked about', () => {
    const original = movement({
      type: 'ISSUE',
      workerId: 'w1',
      occurredAt: at('2026-02-01T09:00:00Z'),
    });
    const correction = movement({
      type: 'ISSUE',
      workerId: 'w2',
      occurredAt: at('2026-02-01T09:00:00Z'),
      recordedAt: at('2026-02-05T09:00:00Z'),
      correctsMovementId: original.id,
      correctionReason: 'wrong worker picked from the list',
    });

    const state = foldAssetState({
      asset,
      movements: [original, correction],
      at: at('2026-02-01T12:00:00Z'),
    });

    expect(state.holder?.workerId).toBe('w2');
  });

  it('follows a correction of a correction', () => {
    const first = movement({ type: 'ISSUE', workerId: 'w1', occurredAt: at('2026-02-01T09:00:00Z') });
    const second = movement({
      type: 'ISSUE',
      workerId: 'w2',
      occurredAt: at('2026-02-01T09:00:00Z'),
      correctsMovementId: first.id,
    });
    const third = movement({
      type: 'ISSUE',
      workerId: 'w3',
      occurredAt: at('2026-02-01T09:00:00Z'),
      correctsMovementId: second.id,
    });

    const state = foldAssetState({
      asset,
      movements: [first, second, third],
      at: at('2026-02-01T12:00:00Z'),
    });

    expect(state.holder?.workerId).toBe('w3');
  });

  it('reports a live reservation as reserved, and ignores a cancelled one', () => {
    const reservation: Reservation = {
      id: 'r1',
      assetId: 'a1',
      workerId: 'w1',
      startsAt: at('2026-02-01T09:00:00Z'),
      endsAt: at('2026-02-01T17:00:00Z'),
      status: 'PENDING',
    };

    const reserved = foldAssetState({
      asset,
      movements: [],
      reservations: [reservation],
      at: at('2026-02-01T10:00:00Z'),
    });
    expect(reserved.status).toBe('RESERVED');

    const cancelled = foldAssetState({
      asset,
      movements: [],
      reservations: [{ ...reservation, status: 'CANCELLED' }],
      at: at('2026-02-01T10:00:00Z'),
    });
    expect(cancelled.status).toBe('IN_STORE');
  });

  it('orders movements at the same instant deterministically', () => {
    const sameInstant = at('2026-02-01T09:00:00Z');
    const issue = movement({ type: 'ISSUE', workerId: 'w1', occurredAt: sameInstant });
    const ret = movement({ type: 'RETURN', occurredAt: sameInstant });

    const forwards = foldAssetState({ asset, movements: [issue, ret], at: sameInstant });
    const backwards = foldAssetState({ asset, movements: [ret, issue], at: sameInstant });

    expect(forwards.status).toBe(backwards.status);
    expect(forwards.status).toBe('IN_STORE');
  });

  it('flags a ledger that put one asset in two hands', () => {
    const movements = [
      movement({ type: 'ISSUE', workerId: 'w1', occurredAt: at('2026-02-01T09:00:00Z') }),
      movement({ type: 'ISSUE', workerId: 'w2', occurredAt: at('2026-02-01T10:00:00Z') }),
    ];

    const state = foldAssetState({ asset, movements, at: at('2026-02-01T11:00:00Z') });
    expect(state.violations.map((v) => v.code)).toEqual(['ISSUE_WHILE_HELD']);
  });
});

describe('storeAsOf', () => {
  it('folds each asset over one shared ledger', () => {
    const assets: AssetSummary[] = [
      asset,
      { id: 'a2', code: 'DRIL-002', addedToStoreAt: at('2026-01-01T00:00:00Z') },
    ];
    const movements: Movement[] = [
      { ...movement({ type: 'ISSUE', workerId: 'w1', occurredAt: at('2026-02-01T09:00:00Z') }) },
      {
        ...movement({ type: 'ISSUE', workerId: 'w2', occurredAt: at('2026-02-01T09:00:00Z') }),
        assetId: 'a2',
      },
      { ...movement({ type: 'RETURN', occurredAt: at('2026-02-01T10:00:00Z') }), assetId: 'a2' },
    ];

    const store = storeAsOf({ assets, movements, at: at('2026-02-01T11:00:00Z') });

    expect(store.map((s) => s.status)).toEqual(['ISSUED', 'IN_STORE']);
  });

  it('answers cleanly for an instant before the store existed', () => {
    const store = storeAsOf({ assets: [asset], movements: [], at: at('2020-01-01T00:00:00Z') });
    expect(store).toHaveLength(1);
    expect(store[0].status).toBe('NOT_YET_IN_STORE');
  });
});
