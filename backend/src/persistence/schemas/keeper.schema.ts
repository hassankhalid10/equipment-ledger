import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

/**
 * The list the store keeper picks their name from. Not a security boundary:
 * the spec forbids authentication, so this only records who wrote each entry
 * (PLAN.md §9).
 */
@Schema({ collection: 'keepers', timestamps: true })
export class Keeper {
  @Prop({ required: true, trim: true })
  name: string;
}

export type KeeperDocument = HydratedDocument<Keeper>;
export const KeeperSchema = SchemaFactory.createForClass(Keeper);
