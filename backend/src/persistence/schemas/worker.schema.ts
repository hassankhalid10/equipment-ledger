import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

@Schema({ _id: false })
export class Certification {
  @Prop({ required: true, trim: true })
  code: string;

  @Prop({ required: true })
  issuedAt: Date;

  @Prop({ required: true })
  expiresAt: Date;
}

const CertificationSchema = SchemaFactory.createForClass(Certification);

@Schema({ collection: 'workers', timestamps: true })
export class Worker {
  @Prop({ required: true, unique: true, trim: true })
  employeeNo: string;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ default: true })
  active: boolean;

  @Prop({ type: [CertificationSchema], default: [] })
  certifications: Certification[];
}

export type WorkerDocument = HydratedDocument<Worker>;
export const WorkerSchema = SchemaFactory.createForClass(Worker);
