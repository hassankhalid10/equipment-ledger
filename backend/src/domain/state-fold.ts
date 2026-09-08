import { effectiveMovements } from './corrections.js';
import { sortMovements } from './ordering.js';
import type {
  AssetState,
  AssetStatus,
  AssetSummary,
  Holding,
  Movement,
  Reservation,
  TimelineViolation,
  ViolationCode,
} from './types.js';

export interface FoldInput {
  asset: AssetSummary;
  /** Every movement ever written for this asset, corrections included. */
  movements: readonly Movement[];
  reservations?: readonly Reservation[];
  /** The instant to answer for. Defaults to now. */
  at?: Date;
}

/**
 * Replays the asset's effective ledger up to `at` and returns the state it was
 * in. Everything the screens show about an asset comes from here; there is no
 * stored "current state" field anywhere.
 *
 * Two decisions live in this function (PLAN.md §12):
 *  - The boundary is inclusive: a movement at exactly `at` has happened.
 *  - Corrections apply regardless of when they were recorded, because "who
 *    held it at 14:20" wants the truth, not the mistake that was fixed later.
 */
export function foldAssetState(input: FoldInput): AssetState {
  const at = input.at ?? new Date();
  const violations: TimelineViolation[] = [];
  const base = { assetId: input.asset.id, at, violations };

  if (input.asset.addedToStoreAt.getTime() > at.getTime()) {
    return { ...base, status: 'NOT_YET_IN_STORE', serviceable: true };
  }

  let serviceable = true;
  let holder: Holding | undefined;
  const flag = (m: Movement, code: ViolationCode, message: string) =>
    violations.push({ movementId: m.id, code, message });

  const timeline = sortMovements(effectiveMovements(input.movements)).filter(
    (m) => m.occurredAt.getTime() <= at.getTime(),
  );

  for (const m of timeline) {
    switch (m.type) {
      case 'ISSUE':
        if (!m.workerId) {
          flag(m, 'ISSUE_WITHOUT_WORKER', 'issue recorded with no worker');
          break;
        }
        if (holder) {
          flag(m, 'ISSUE_WHILE_HELD', `issued while already held by ${holder.workerId}`);
        }
        holder = {
          workerId: m.workerId,
          since: m.occurredAt,
          dueAt: m.dueAt,
          issueMovementId: m.id,
        };
        break;

      case 'RETURN':
        if (!holder) flag(m, 'RETURN_WHILE_NOT_HELD', 'returned while nobody held it');
        holder = undefined;
        break;

      case 'OUT_OF_SERVICE':
        if (!serviceable) {
          flag(m, 'OUT_OF_SERVICE_WHILE_OUT', 'taken out of service while already out');
        }
        serviceable = false;
        break;

      case 'BACK_IN_SERVICE':
        if (serviceable) {
          flag(m, 'BACK_IN_SERVICE_WHILE_IN', 'brought back while already in service');
        }
        serviceable = true;
        break;
    }
  }

  const activeReservation = (input.reservations ?? []).find(
    (r) =>
      r.status === 'PENDING' &&
      r.startsAt.getTime() <= at.getTime() &&
      at.getTime() < r.endsAt.getTime(),
  );

  return {
    ...base,
    serviceable,
    holder,
    activeReservation,
    status: statusOf(serviceable, holder, activeReservation, at),
  };
}

/**
 * Overdue and reserved are derived here, never stored, so no background job
 * has to keep a status column honest (PLAN.md §12 #10, #11).
 */
function statusOf(
  serviceable: boolean,
  holder: Holding | undefined,
  activeReservation: Reservation | undefined,
  at: Date,
): AssetStatus {
  if (!serviceable) return 'OUT_OF_SERVICE';
  if (holder) {
    return holder.dueAt && holder.dueAt.getTime() < at.getTime() ? 'OVERDUE' : 'ISSUED';
  }
  if (activeReservation) return 'RESERVED';
  return 'IN_STORE';
}
