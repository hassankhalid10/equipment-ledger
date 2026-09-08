// Pure domain types. Nothing in this folder imports the database.
// Ids are strings here; the persistence layer converts ObjectIds at its edge.

export type MovementType = 'ISSUE' | 'RETURN' | 'OUT_OF_SERVICE' | 'BACK_IN_SERVICE';
export type ReturnCondition = 'OK' | 'DAMAGED';
export type ReservationStatus = 'PENDING' | 'COLLECTED' | 'CANCELLED';

export interface Movement {
  id: string;
  assetId: string;
  type: MovementType;
  /** When it actually happened (business time). */
  occurredAt: Date;
  /** When it was written (server clock). */
  recordedAt: Date;
  keeperId: string;
  /** The holder, on ISSUE. */
  workerId?: string;
  /** Who physically handed it back, on RETURN. May differ from the holder. */
  returnedByWorkerId?: string;
  dueAt?: Date;
  condition?: ReturnCondition;
  reservationId?: string;
  /** Present on a correction: the movement this one supersedes. */
  correctsMovementId?: string;
  correctionReason?: string;
  reason?: string;
  note?: string;
}

export interface Reservation {
  id: string;
  assetId: string;
  workerId: string;
  startsAt: Date;
  /** Half-open window: [startsAt, endsAt). */
  endsAt: Date;
  status: ReservationStatus;
}

export interface AssetSummary {
  id: string;
  code: string;
  addedToStoreAt: Date;
}

export type AssetStatus =
  | 'NOT_YET_IN_STORE'
  | 'OUT_OF_SERVICE'
  | 'OVERDUE'
  | 'ISSUED'
  | 'RESERVED'
  | 'IN_STORE';

export interface Holding {
  workerId: string;
  since: Date;
  dueAt?: Date;
  issueMovementId: string;
}

export type ViolationCode =
  | 'ISSUE_WHILE_HELD'
  | 'ISSUE_WITHOUT_WORKER'
  | 'RETURN_WHILE_NOT_HELD'
  | 'OUT_OF_SERVICE_WHILE_OUT'
  | 'BACK_IN_SERVICE_WHILE_IN';

export interface TimelineViolation {
  movementId: string;
  code: ViolationCode;
  message: string;
}

export interface AssetState {
  assetId: string;
  at: Date;
  status: AssetStatus;
  serviceable: boolean;
  holder?: Holding;
  /** A PENDING reservation whose window contains `at`. */
  activeReservation?: Reservation;
  /** Transitions that should have been impossible. Empty on a valid ledger. */
  violations: TimelineViolation[];
}
