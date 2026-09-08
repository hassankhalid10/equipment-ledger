import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { randomUUID } from 'node:crypto';
import type { Model, Types } from 'mongoose';
import { conflict } from '../errors/domain-error.js';
import { AssetLock } from '../../persistence/schemas/asset-lock.schema.js';

const LEASE_MS = 10_000;
const ACQUIRE_RETRIES = 8;
const RETRY_BASE_MS = 15;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface Lease {
  assetId: Types.ObjectId;
  token: string;
}

/**
 * The per-asset lease: every write acquires this before touching an asset,
 * which serialises writes to one asset without a transaction (PLAN.md §7).
 *
 * Acquiring is a single findOneAndUpdate matching `_id` (= assetId) AND an
 * expired lease, with upsert on. A live lease makes that filter miss, the
 * upsert then tries to insert `_id: assetId`, and MongoDB's duplicate-key
 * error on that insert IS the "someone else is writing" signal - one atomic
 * operation, no transaction, correct on a standalone server.
 *
 * This is the serialisation layer, not the correctness guarantee. If the
 * lease had a bug, asset_holdings' unique `_id` would still refuse a second
 * holder; the lease only keeps two writers from wasting work at the same
 * time.
 */
@Injectable()
export class AssetLockService {
  constructor(@InjectModel(AssetLock.name) private readonly locks: Model<AssetLock>) {}

  async acquire(assetId: Types.ObjectId, route: string): Promise<Lease> {
    const token = randomUUID();

    for (let attempt = 0; attempt < ACQUIRE_RETRIES; attempt += 1) {
      const now = new Date();
      try {
        await this.locks.collection.updateOne(
          { _id: assetId, expiresAt: { $lte: now } },
          { $set: { token, expiresAt: new Date(now.getTime() + LEASE_MS), acquiredAt: now, route } },
          { upsert: true },
        );
        return { assetId, token };
      } catch (err) {
        if (isDuplicateKey(err)) {
          // Someone else holds the lease. Jittered backoff so a burst of
          // simultaneous callers do not all retry in lockstep.
          await sleep(RETRY_BASE_MS * (attempt + 1) + Math.random() * RETRY_BASE_MS);
          continue;
        }
        throw err;
      }
    }

    throw conflict('ASSET_BUSY', 'This asset is being written to by another request. Try again in a moment.');
  }

  /** Only the caller holding the current token may release. A stale caller's
   * release is a silent no-op rather than clobbering someone else's lease. */
  async release(lease: Lease): Promise<void> {
    await this.locks.collection.deleteOne({ _id: lease.assetId, token: lease.token });
  }

  async withLease<T>(assetId: Types.ObjectId, route: string, work: () => Promise<T>): Promise<T> {
    const lease = await this.acquire(assetId, route);
    try {
      return await work();
    } finally {
      await this.release(lease);
    }
  }
}

function isDuplicateKey(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}
