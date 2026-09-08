import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes } from 'mongoose';
import type { HydratedDocument, Types } from 'mongoose';

/**
 * A short lease on one asset. Every write acquires it first, which serialises
 * writes per asset. This replaces the writeSeq bump from the original plan,
 * whose only job was to force two transactions into conflict.
 *
 * Acquiring is one findOneAndUpdate matching `_id` and an expired lease with
 * upsert: a live lease makes the upsert collide on `_id`, and that duplicate
 * key IS the "someone else is writing" signal. Atomic on a standalone server.
 *
 * The lease is the serialisation layer, not the guarantee. If it had a bug,
 * asset_holdings' unique `_id` would still refuse a second holder.
 */
@Schema({ collection: 'asset_locks', versionKey: false })
export class AssetLock {
  /** = assetId. */
  @Prop({ type: SchemaTypes.ObjectId, required: true })
  _id: Types.ObjectId;

  /** Random per request. Only the holder of this token may release the lease. */
  @Prop({ required: true })
  token: string;

  /**
   * A dead process cannot hold an asset hostage: the acquire filter treats a
   * lease past this instant as free. Correctness comes from that comparison,
   * not from the TTL index below, which is only housekeeping - MongoDB's TTL
   * monitor runs about once a minute and is far too slow to rely on.
   */
  @Prop({ required: true })
  expiresAt: Date;

  @Prop({ required: true })
  acquiredAt: Date;

  /** Which endpoint took it. Only ever read by a human diagnosing a stuck lease. */
  @Prop({ type: String, default: null })
  route: string | null;
}

export type AssetLockDocument = HydratedDocument<AssetLock>;
export const AssetLockSchema = SchemaFactory.createForClass(AssetLock);

AssetLockSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
