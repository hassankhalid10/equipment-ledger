import { buildSeed } from './seed-data.js';
import { foldAssetState } from '../domain/state-fold.js';
import { storeAsOf } from '../domain/as-of.js';
import { blocksWindow, overlaps } from '../domain/reservation-overlap.js';
import type { Movement, Reservation } from '../domain/types.js';

const ANCHOR = new Date('2026-09-08T00:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

const store = buildSeed(ANCHOR);

/** The seed's own shapes, mapped onto the domain's. */
const asDomainMovements = (): Movement[] =>
  store.movements.map((m) => ({
    id: m._id,
    assetId: m.assetId,
    type: m.type,
    occurredAt: m.occurredAt,
    recordedAt: m.recordedAt,
    keeperId: m.keeperId,
    workerId: m.workerId ?? undefined,
    returnedByWorkerId: m.returnedByWorkerId ?? undefined,
    dueAt: m.dueAt ?? undefined,
    condition: m.condition ?? undefined,
    correctsMovementId: m.correctsMovementId ?? undefined,
  }));

const asDomainReservations = (): Reservation[] =>
  store.reservations.map((r) => ({
    id: r._id,
    assetId: r.assetId,
    workerId: r.workerId,
    startsAt: r.startsAt,
    endsAt: r.endsAt,
    status: r.status,
  }));

const assetSummaries = () =>
  store.assets.map((a) => ({ id: a._id, code: a.code, addedToStoreAt: a.addedToStoreAt }));

describe('the seed is deterministic', () => {
  it('produces a deeply equal store on every run (FR-25)', () => {
    expect(buildSeed(ANCHOR)).toEqual(buildSeed(ANCHOR));
  });

  it('gives the same document ids on every run, so re-seeding overwrites', () => {
    const first = buildSeed(ANCHOR).movements.map((m) => m._id);
    const second = buildSeed(ANCHOR).movements.map((m) => m._id);
    expect(first).toEqual(second);
    expect(new Set(first).size).toBe(first.length);
  });
});

describe('the seed satisfies the spec', () => {
  it('has about 60 assets across several kinds, some certificate-gated', () => {
    expect(store.assets).toHaveLength(60);
    expect(new Set(store.assets.map((a) => a.kind)).size).toBeGreaterThanOrEqual(5);
    expect(store.assets.some((a) => a.requiredCertification)).toBe(true);
    expect(store.assets.some((a) => !a.requiredCertification)).toBe(true);
  });

  it('has 12 workers, one with an expired certificate and one expiring in the window', () => {
    expect(store.workers).toHaveLength(12);

    const certs = store.workers.flatMap((w) => w.certifications);
    expect(certs.some((c) => c.expiresAt < ANCHOR)).toBe(true);
    expect(
      certs.some((c) => c.expiresAt > ANCHOR && c.expiresAt.getTime() < ANCHOR.getTime() + 30 * DAY),
    ).toBe(true);
  });

  it('has 30 days of movements, including outstanding, overdue and late-logged', () => {
    expect(store.movements.length).toBeGreaterThan(60);
    expect(store.holdings.length).toBeGreaterThan(0);
    expect(store.holdings.some((h) => h.dueAt && h.dueAt < ANCHOR)).toBe(true);
    expect(
      store.movements.some((m) => m.recordedAt.getTime() - m.occurredAt.getTime() > DAY),
    ).toBe(true);
  });

  it('has a correction, a damaged return and a non-holder return', () => {
    expect(store.movements.some((m) => m.correctsMovementId)).toBe(true);
    expect(store.movements.some((m) => m.condition === 'DAMAGED')).toBe(true);
    expect(store.movements.some((m) => m.type === 'OUT_OF_SERVICE')).toBe(true);
    expect(store.movements.some((m) => m.type === 'BACK_IN_SERVICE')).toBe(true);
  });

  it('has reservations in the past and future, including one never collected', () => {
    expect(store.reservations.some((r) => r.endsAt < ANCHOR)).toBe(true);
    expect(store.reservations.some((r) => r.startsAt > ANCHOR)).toBe(true);
    expect(store.reservations.some((r) => r.status === 'PENDING' && r.endsAt < ANCHOR)).toBe(true);
    expect(store.reservations.some((r) => r.status === 'CANCELLED')).toBe(true);
  });

  it('leaves at least one asset out of service', () => {
    const outOfService = storeAsOf({
      assets: assetSummaries(),
      movements: asDomainMovements(),
      reservations: asDomainReservations(),
      at: ANCHOR,
    }).filter((s) => s.status === 'OUT_OF_SERVICE');

    expect(outOfService.length).toBeGreaterThan(0);
  });
});

describe('the seeded ledger is one the fold accepts', () => {
  it('never puts an asset in two hands, at any point in the window', () => {
    const movements = asDomainMovements();
    const assets = assetSummaries();

    // Walk the whole window rather than only checking the end state: a double
    // issue that was tidied up later would still be a broken ledger.
    for (let day = -31; day <= 1; day += 1) {
      const at = new Date(ANCHOR.getTime() + day * DAY);
      for (const state of storeAsOf({ assets, movements, at })) {
        expect(state.violations).toEqual([]);
      }
    }
  });

  it('agrees with the holdings the seed wrote for the guard', () => {
    const movements = asDomainMovements();

    for (const asset of assetSummaries()) {
      const state = foldAssetState({ asset, movements, at: ANCHOR });
      const holding = store.holdings.find((h) => h._id === asset.id);

      if (holding) {
        expect(state.holder?.workerId).toBe(holding.workerId);
        expect(state.holder?.issueMovementId).toBe(holding.issueMovementId);
      } else {
        expect(state.holder).toBeUndefined();
      }
    }
  });

  it('only issues certificate-gated assets to workers who were certified that day', () => {
    const workersById = new Map(store.workers.map((w) => [w._id, w]));
    const assetsById = new Map(store.assets.map((a) => [a._id, a]));

    for (const m of store.movements) {
      if (m.type !== 'ISSUE' || !m.workerId) continue;
      const required = assetsById.get(m.assetId)?.requiredCertification;
      if (!required) continue;

      const held = workersById.get(m.workerId)!.certifications.filter((c) => c.code === required);
      const valid = held.some((c) => {
        const end = new Date(c.expiresAt);
        end.setUTCHours(23, 59, 59, 999);
        return c.issuedAt <= m.occurredAt && m.occurredAt <= end;
      });

      expect(valid).toBe(true);
    }
  });

  // Added after `npm run check:invariants` caught a real bug here: the
  // "adjacent, sharing an edge" reservation pair actually overlapped for
  // nine hours, because the seed's day-granularity helper defaults every
  // window to 08:00-17:00 regardless of what the comment claimed. The
  // checker running against MongoDB found it; this closes the gap so the
  // same class of mistake fails fast, in the same second as every other
  // seed test, without needing a database.
  it('never books two live reservations over the same window on one asset (FR-7)', () => {
    const byAsset = new Map<string, Reservation[]>();
    for (const r of asDomainReservations()) {
      const list = byAsset.get(r.assetId) ?? [];
      list.push(r);
      byAsset.set(r.assetId, list);
    }

    for (const [assetId, reservations] of byAsset) {
      const live = reservations.filter(blocksWindow);
      for (let i = 0; i < live.length; i += 1) {
        for (let j = i + 1; j < live.length; j += 1) {
          expect
            .soft(overlaps(live[i], live[j]), `${assetId}: ${live[i].id} and ${live[j].id} overlap`)
            .toBe(false);
        }
      }
    }
  });
});
