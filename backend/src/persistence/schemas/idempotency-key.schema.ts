import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes } from 'mongoose';
import type { HydratedDocument } from 'mongoose';

/**
 * One document per write request. `_id` is the client's Idempotency-Key, so
 * the uniqueness that makes "nothing lands twice" work is the primary key
 * itself (FR-19).
 *
 * A replay of a completed key returns the original status and body rather
 * than doing the work again. `requestHash` catches the other case: the same
 * key sent with a different payload, which is a client bug worth reporting
 * rather than silently answering with someone else's result.
 */
@Schema({ collection: 'idempotency_keys', versionKey: false })
export class IdempotencyKey {
  /** = the Idempotency-Key header. */
  @Prop({ type: String, required: true })
  _id: string;

  @Prop({ required: true })
  route: string;

  @Prop({ required: true })
  requestHash: string;

  /** IN_FLIGHT until the write settles, so a concurrent replay can be told apart. */
  @Prop({ type: String, required: true, enum: ['IN_FLIGHT', 'COMPLETED'] })
  state: 'IN_FLIGHT' | 'COMPLETED';

  @Prop({ type: Number, default: null })
  responseStatus: number | null;

  @Prop({ type: SchemaTypes.Mixed, default: null })
  responseBody: Record<string, unknown> | null;

  @Prop({ required: true })
  createdAt: Date;
}

export type IdempotencyKeyDocument = HydratedDocument<IdempotencyKey>;
export const IdempotencyKeySchema = SchemaFactory.createForClass(IdempotencyKey);

// Keys are only useful for as long as a client might retry. A day is
// generous; keeping them forever would grow without bound for no benefit.
IdempotencyKeySchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 });
