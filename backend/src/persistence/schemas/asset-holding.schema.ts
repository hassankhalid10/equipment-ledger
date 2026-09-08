import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes } from 'mongoose';
import type { HydratedDocument, Types } from 'mongoose';

export type HoldingState = 'PENDING' | 'ACTIVE' | 'RELEASING';

/**
 * What the claim is about to write, kept so an interrupted write can be
 * replayed rather than lost. The movement ids are generated before the
 * documents exist, which is what makes the replay produce the same
 * documents however many times it runs (PLAN.md §7).
 */
@Schema({ _id: false })
export class HoldingIntent {
  @Prop({ type: [SchemaTypes.ObjectId], required: true })
  movementIds: Types.ObjectId[];

  /** The movement documents to insert, already shaped. */
  @Prop({ type: SchemaTypes.Mixed, required: true })
  movements: Record<string, unknown>[];

  /** A reservation to mark COLLECTED once the movements land, if any. */
  @Prop({ type: SchemaTypes.ObjectId, default: null })
  collectReservationId: Types.ObjectId | null;
}

const HoldingIntentSchema = SchemaFactory.createForClass(HoldingIntent);

/**
 * THE ONE-HOLDER GUARD. A document exists here only while an asset is held,
 * and `_id` is the asset's own id, so it is unique by definition.
 *
 * This is the line that makes a double issue impossible: two simultaneous
 * issues both try to insert `_id: assetId`, and MongoDB gives exactly one of
 * them a duplicate-key error. It is a single-document write, so it is atomic
 * on a standalone server - no transaction, no replica set (PLAN.md §7).
 *
 * It is a guard, not a cache: no read path derives state from it. The
 * invariant checker proves it stays in step with the ledger.
 */
@Schema({ collection: 'asset_holdings', versionKey: false })
export class AssetHolding {
  /** = assetId. Supplied by the writer, never generated. */
  @Prop({ type: SchemaTypes.ObjectId, required: true })
  _id: Types.ObjectId;

  /**
   * PENDING  - claimed, movements not yet written
   * ACTIVE   - settled; the worker holds the asset
   * RELEASING - claimed for return, movements not yet written
   *
   * PENDING and RELEASING are in-flight states. Any caller that meets one
   * replays its intent before doing anything else.
   */
  @Prop({ type: String, required: true, enum: ['PENDING', 'ACTIVE', 'RELEASING'] })
  state: HoldingState;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Worker', required: true })
  workerId: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Movement', required: true })
  issueMovementId: Types.ObjectId;

  @Prop({ required: true })
  since: Date;

  @Prop({ type: Date, default: null })
  dueAt: Date | null;

  @Prop({ type: HoldingIntentSchema, default: null })
  intent: HoldingIntent | null;

  /** When the claim was taken. A stale in-flight claim is found by this. */
  @Prop({ required: true })
  claimedAt: Date;

  @Prop({ type: String, default: null })
  idempotencyKey: string | null;
}

export type AssetHoldingDocument = HydratedDocument<AssetHolding>;
export const AssetHoldingSchema = SchemaFactory.createForClass(AssetHolding);

// Finds every unfinished claim in one hit, for reconcile and the checker.
AssetHoldingSchema.index({ state: 1, claimedAt: 1 });
AssetHoldingSchema.index({ workerId: 1 });
