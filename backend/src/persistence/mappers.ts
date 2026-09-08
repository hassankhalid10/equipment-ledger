import type { Types } from 'mongoose';
import type {
  AssetSummary,
  Movement,
  Reservation,
  MovementType,
  ReservationStatus,
  ReturnCondition,
} from '../domain/types.js';

/**
 * The edge where MongoDB's ObjectIds become the domain's plain strings.
 * Nothing in src/domain knows Mongoose exists, and this is the only file
 * that has to change if that ever stops being true.
 */

type Id = Types.ObjectId | string | null | undefined;

export const idToString = (id: Id): string => (id ? id.toString() : '');

const optionalId = (id: Id): string | undefined => (id ? id.toString() : undefined);

export interface AssetDoc {
  _id: Types.ObjectId;
  code: string;
  name: string;
  kind: string;
  requiredCertification: string | null;
  addedToStoreAt: Date;
}

export interface MovementDoc {
  _id: Types.ObjectId;
  assetId: Types.ObjectId;
  type: MovementType;
  occurredAt: Date;
  recordedAt: Date;
  keeperId: Types.ObjectId;
  workerId?: Types.ObjectId | null;
  returnedByWorkerId?: Types.ObjectId | null;
  dueAt?: Date | null;
  condition?: ReturnCondition | null;
  reservationId?: Types.ObjectId | null;
  correctsMovementId?: Types.ObjectId | null;
  correctionReason?: string | null;
  reason?: string | null;
  note?: string | null;
}

export interface ReservationDoc {
  _id: Types.ObjectId;
  assetId: Types.ObjectId;
  workerId: Types.ObjectId;
  keeperId: Types.ObjectId;
  startsAt: Date;
  endsAt: Date;
  status: ReservationStatus;
  collectedMovementId?: Types.ObjectId | null;
  cancelledAt?: Date | null;
  cancelReason?: string | null;
}

export function toDomainAsset(doc: AssetDoc): AssetSummary {
  return {
    id: idToString(doc._id),
    code: doc.code,
    addedToStoreAt: doc.addedToStoreAt,
  };
}

export function toDomainMovement(doc: MovementDoc): Movement {
  return {
    id: idToString(doc._id),
    assetId: idToString(doc.assetId),
    type: doc.type,
    occurredAt: doc.occurredAt,
    recordedAt: doc.recordedAt,
    keeperId: idToString(doc.keeperId),
    workerId: optionalId(doc.workerId),
    returnedByWorkerId: optionalId(doc.returnedByWorkerId),
    dueAt: doc.dueAt ?? undefined,
    condition: doc.condition ?? undefined,
    reservationId: optionalId(doc.reservationId),
    correctsMovementId: optionalId(doc.correctsMovementId),
    correctionReason: doc.correctionReason ?? undefined,
    reason: doc.reason ?? undefined,
    note: doc.note ?? undefined,
  };
}

export function toDomainReservation(doc: ReservationDoc): Reservation {
  return {
    id: idToString(doc._id),
    assetId: idToString(doc.assetId),
    workerId: idToString(doc.workerId),
    startsAt: doc.startsAt,
    endsAt: doc.endsAt,
    status: doc.status,
  };
}
