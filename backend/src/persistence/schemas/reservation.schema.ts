import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes } from 'mongoose';
import type { HydratedDocument, Types } from 'mongoose';
import type { ReservationStatus } from '../../domain/types.js';

/**
 * A claim on one asset for a window of time. The window is half-open,
 * [startsAt, endsAt), at minute precision, so adjacent windows both stand.
 *
 * "Never collected" is not a status: it is derived as PENDING with endsAt in
 * the past, so no background job has to age these (PLAN.md §12 #10).
 */
@Schema({ collection: 'reservations', timestamps: true })
export class Reservation {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'Asset', required: true })
  assetId: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Worker', required: true })
  workerId: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Keeper', required: true })
  keeperId: Types.ObjectId;

  @Prop({ required: true })
  startsAt: Date;

  @Prop({ required: true })
  endsAt: Date;

  @Prop({
    type: String,
    required: true,
    enum: ['PENDING', 'COLLECTED', 'CANCELLED'],
    default: 'PENDING',
  })
  status: ReservationStatus;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Movement', default: null })
  collectedMovementId: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  cancelledAt: Date | null;

  @Prop({ type: String, default: null })
  cancelReason: string | null;

  @Prop({ type: String, default: null })
  idempotencyKey: string | null;
}

export type ReservationDocument = HydratedDocument<Reservation>;
export const ReservationSchema = SchemaFactory.createForClass(Reservation);

// Overlap is a range test, so no index can enforce it. These two only make
// the check cheap: load the asset's live reservations near the window.
ReservationSchema.index({ assetId: 1, startsAt: 1 });
ReservationSchema.index({ assetId: 1, status: 1, endsAt: 1 });
ReservationSchema.index({ workerId: 1, startsAt: -1 });
