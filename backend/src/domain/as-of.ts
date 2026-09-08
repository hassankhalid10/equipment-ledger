import { foldAssetState } from './state-fold.js';
import type { AssetState, AssetSummary, Movement, Reservation } from './types.js';

export interface StoreAsOfInput {
  assets: readonly AssetSummary[];
  /** The whole ledger, every asset. */
  movements: readonly Movement[];
  reservations?: readonly Reservation[];
  at: Date;
}

/**
 * The whole store as it stood at `at`: one fold per asset over one ledger,
 * with no cache anywhere in the path (FR-20).
 *
 * The movements are grouped once rather than filtered per asset, so this is
 * one pass over the ledger instead of one pass per asset. At 60 assets that
 * hardly matters; it is written this way because the shape of the cost is
 * what changes when the store gets big.
 */
export function storeAsOf(input: StoreAsOfInput): AssetState[] {
  const movementsByAsset = groupBy(input.movements, (m) => m.assetId);
  const reservationsByAsset = groupBy(input.reservations ?? [], (r) => r.assetId);

  return input.assets.map((asset) =>
    foldAssetState({
      asset,
      movements: movementsByAsset.get(asset.id) ?? [],
      reservations: reservationsByAsset.get(asset.id) ?? [],
      at: input.at,
    }),
  );
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const existing = map.get(k);
    if (existing) existing.push(item);
    else map.set(k, [item]);
  }
  return map;
}
