import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

/**
 * An asset carries no current-state fields on purpose. Whether it is held,
 * overdue, reserved or out of service is folded from the ledger every time
 * it is asked for (PLAN.md §6).
 */
@Schema({ collection: 'assets', timestamps: true })
export class Asset {
  @Prop({ required: true, unique: true, trim: true })
  code: string;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, trim: true })
  kind: string;

  @Prop({ type: String, default: null })
  requiredCertification: string | null;

  @Prop({ required: true })
  addedToStoreAt: Date;
}

export type AssetDocument = HydratedDocument<Asset>;
export const AssetSchema = SchemaFactory.createForClass(Asset);

AssetSchema.index({ kind: 1 });
