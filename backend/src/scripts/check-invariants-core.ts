import type { Types } from 'mongoose';
import { blocksWindow, overlaps } from '../domain/reservation-overlap.js';
import { foldAssetState } from '../domain/state-fold.js';
import { toDomainAsset, toDomainMovement, toDomainReservation } from '../persistence/mappers.js';
import type { AssetDoc, MovementDoc, ReservationDoc } from '../persistence/mappers.js';

/**
 * The seven checks, as a pure function over plain documents. Split from
 * check-invariants.ts the same way seed-data.ts is split from seed.ts: the
 * logic that matters is testable in milliseconds with no MongoDB, and the
 * script that reads the real database is a thin wrapper around it.
 *
 * Checks 1 and 4 come from the SAME fold every read endpoint uses
 * (foldAssetState), not a second parallel set of rules that could drift
 * from it: a fold that finds two hands on one asset, or a return that
 * closed nothing, shows up in that fold's own `violations` array.
 */

export const ALLOWED_CLOCK_SKEW_MS = 60_000;

export interface RawWithAsset {
  assetId: Types.ObjectId;
}
export interface RawMovement extends RawWithAsset {
  _id: Types.ObjectId;
  correctsMovementId: Types.ObjectId | null;
  occurredAt: Date;
  recordedAt: Date;
}
export interface RawHolding {
  _id: Types.ObjectId;
  state: 'PENDING' | 'ACTIVE' | 'RELEASING';
  workerId: Types.ObjectId;
  issueMovementId: Types.ObjectId;
  claimedAt: Date;
}

export interface InvariantInput {
  assets: AssetDoc[];
  movements: (MovementDoc & RawMovement)[];
  reservations: (ReservationDoc & RawWithAsset)[];
  holdings: RawHolding[];
  /** The instant to fold each asset's ledger up to. Defaults to now. */
  now?: Date;
}

export interface CheckResult {
  name: string;
  pass: boolean;
  failures: string[];
  info?: string[];
}

export function runInvariantChecks(input: InvariantInput): CheckResult[] {
  const now = input.now ?? new Date();
  const movementsByAsset = groupBy(input.movements, (m) => m.assetId.toString());
  const reservationsByAsset = groupBy(input.reservations, (r) => r.assetId.toString());
  const movementIds = new Set(input.movements.map((m) => m._id.toString()));
  const holdingByAsset = new Map(input.holdings.map((h) => [h._id.toString(), h]));

  const results: CheckResult[] = [];
  const doubleHold: string[] = [];
  const returnWithoutIssue: string[] = [];
  const holdingMismatch: string[] = [];
  const unsettledClaims: string[] = [];

  for (const assetDoc of input.assets) {
    const assetIdStr = assetDoc._id.toString();
    const asset = toDomainAsset(assetDoc);
    const movements = (movementsByAsset.get(assetIdStr) ?? []).map((m) => toDomainMovement(m));
    const state = foldAssetState({ asset, movements, at: now });

    for (const v of state.violations) {
      const msg = `${assetDoc.code}: ${v.message} (movement ${v.movementId})`;
      if (v.code === 'ISSUE_WHILE_HELD') doubleHold.push(msg);
      if (v.code === 'RETURN_WHILE_NOT_HELD') returnWithoutIssue.push(msg);
    }

    // Check 2: the guard against the ledger. A claim still PENDING or
    // RELEASING is a write in flight, not a failure - reported separately
    // so `npm run reconcile` is the next step, not a red herring.
    const holding = holdingByAsset.get(assetIdStr);
    if (holding?.state === 'PENDING' || holding?.state === 'RELEASING') {
      unsettledClaims.push(
        `${assetDoc.code}: holding is ${holding.state} (claimed ${new Date(holding.claimedAt).toISOString()}). Run \`npm run reconcile\`.`,
      );
      continue;
    }

    const ledgerHeld = Boolean(state.holder);
    const guardHeld = holding?.state === 'ACTIVE';
    if (ledgerHeld !== guardHeld) {
      holdingMismatch.push(
        `${assetDoc.code}: ledger says ${ledgerHeld ? 'held' : 'not held'}, guard says ${guardHeld ? 'held' : 'not held'}`,
      );
    } else if (ledgerHeld && guardHeld && holding) {
      if (holding.workerId.toString() !== state.holder!.workerId) {
        holdingMismatch.push(
          `${assetDoc.code}: ledger holder ${state.holder!.workerId} but guard says ${holding.workerId.toString()}`,
        );
      }
      if (holding.issueMovementId.toString() !== state.holder!.issueMovementId) {
        holdingMismatch.push(
          `${assetDoc.code}: ledger's issuing movement ${state.holder!.issueMovementId} does not match the guard's ${holding.issueMovementId.toString()}`,
        );
      }
    }
  }

  results.push({
    name: '1. No asset is held by two workers at any instant',
    pass: doubleHold.length === 0,
    failures: doubleHold,
  });
  results.push({
    name: '2. asset_holdings matches what the ledger says is currently held',
    pass: holdingMismatch.length === 0,
    failures: holdingMismatch,
    info: unsettledClaims,
  });

  // Check 3: no two live reservations on the same asset overlap.
  const overlapFailures: string[] = [];
  for (const assetDoc of input.assets) {
    const assetIdStr = assetDoc._id.toString();
    const live = (reservationsByAsset.get(assetIdStr) ?? [])
      .map((r) => toDomainReservation(r))
      .filter(blocksWindow);
    for (let i = 0; i < live.length; i += 1) {
      for (let j = i + 1; j < live.length; j += 1) {
        if (overlaps(live[i], live[j])) {
          overlapFailures.push(`${assetDoc.code}: reservations ${live[i].id} and ${live[j].id} overlap`);
        }
      }
    }
  }
  results.push({
    name: '3. No reservation overlaps another on the same asset',
    pass: overlapFailures.length === 0,
    failures: overlapFailures,
  });

  results.push({
    name: '4. Every RETURN closes an ISSUE that precedes it',
    pass: returnWithoutIssue.length === 0,
    failures: returnWithoutIssue,
  });

  // Check 5: every correction points at a movement that actually exists.
  const correctionFailures: string[] = [];
  for (const m of input.movements) {
    if (m.correctsMovementId && !movementIds.has(m.correctsMovementId.toString())) {
      correctionFailures.push(
        `movement ${m._id.toString()} corrects ${m.correctsMovementId.toString()}, which does not exist`,
      );
    }
  }
  results.push({
    name: '5. Every correction points at a real, existing movement',
    pass: correctionFailures.length === 0,
    failures: correctionFailures,
  });

  // Check 6: occurredAt is never suspiciously after recordedAt. Late
  // entries (occurredAt well BEFORE recordedAt) are expected and fine;
  // this only catches the other direction.
  const skewFailures: string[] = [];
  for (const m of input.movements) {
    const occurredAt = new Date(m.occurredAt).getTime();
    const recordedAt = new Date(m.recordedAt).getTime();
    if (occurredAt - recordedAt > ALLOWED_CLOCK_SKEW_MS) {
      skewFailures.push(`movement ${m._id.toString()}: occurredAt is ${occurredAt - recordedAt}ms after recordedAt`);
    }
  }
  results.push({
    name: `6. No movement has occurredAt after recordedAt by more than ${ALLOWED_CLOCK_SKEW_MS}ms`,
    pass: skewFailures.length === 0,
    failures: skewFailures,
  });

  // Check 7: an ACTIVE holding's issuing movement actually exists. Intent
  // is cleared to null once a claim settles, so this is the only trace
  // left of "the movement a settled claim promised" - it should always be
  // there; if it is not, a settle happened without its insert landing.
  const missingSettledMovement: string[] = [];
  for (const h of input.holdings) {
    if (h.state === 'ACTIVE' && !movementIds.has(h.issueMovementId.toString())) {
      missingSettledMovement.push(
        `asset ${h._id.toString()}: holding is ACTIVE but its issuing movement ${h.issueMovementId.toString()} is missing`,
      );
    }
  }
  results.push({
    name: '7. No movement promised by a settled claim is missing from the ledger',
    pass: missingSettledMovement.length === 0,
    failures: missingSettledMovement,
  });

  return results;
}

function groupBy<T extends RawWithAsset>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k);
    if (list) list.push(item);
    else map.set(k, [item]);
  }
  return map;
}
