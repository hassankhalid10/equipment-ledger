/** The shapes the API actually returns. Kept in one file so a change to the
 * backend's response shape breaks the build here rather than at runtime. */

export type AssetStatus =
  | "IN_STORE"
  | "ISSUED"
  | "OVERDUE"
  | "RESERVED"
  | "OUT_OF_SERVICE"
  | "NOT_YET_IN_STORE";

export type MovementType = "ISSUE" | "RETURN" | "OUT_OF_SERVICE" | "BACK_IN_SERVICE";
export type ReservationStatus = "PENDING" | "COLLECTED" | "CANCELLED";

export interface WorkerRef {
  id: string;
  name: string;
  employeeNo: string;
}

export interface AssetView {
  id: string;
  code: string;
  name: string;
  kind: string;
  requiredCertification: string | null;
  addedToStoreAt: string;
  status: AssetStatus;
  serviceable: boolean;
  holder: (WorkerRef & { since: string; dueAt: string | null; issueMovementId: string }) | null;
  activeReservation: {
    id: string;
    worker: WorkerRef | null;
    startsAt: string;
    endsAt: string;
  } | null;
}

export interface MovementView {
  id: string;
  assetId: string;
  type: MovementType;
  occurredAt: string;
  recordedAt: string;
  worker: WorkerRef | null;
  returnedBy: WorkerRef | null;
  dueAt: string | null;
  condition: "OK" | "DAMAGED" | null;
  correctsMovementId: string | null;
  correctionReason: string | null;
  reason: string | null;
  note: string | null;
  /** occurredAt more than an hour before recordedAt: a late entry (FR-17). */
  loggedLate: boolean;
}

export interface TimelineEntry extends MovementView {
  /** True when a later correction replaced this entry. Still shown (FR-18). */
  superseded: boolean;
  chain: string[] | null;
}

export interface ReservationView {
  id: string;
  assetId?: string;
  worker: WorkerRef | null;
  startsAt: string;
  endsAt: string;
  status: ReservationStatus;
  /** Derived, not stored: PENDING with a window already past. */
  neverCollected: boolean;
  cancelReason: string | null;
}

export interface Certification {
  code: string;
  issuedAt: string;
  expiresAt: string;
  expired: boolean;
  expiringSoon: boolean;
}

export interface WorkerView {
  id: string;
  employeeNo: string;
  name: string;
  active: boolean;
  certifications: Certification[];
  holding: { code: string; name: string; since: string; dueAt: string | null; overdue: boolean }[];
}

export interface Keeper {
  id: string;
  name: string;
}

export interface AssetListResponse {
  at: string;
  total: number;
  assets: AssetView[];
}

export interface AsOfResponse {
  at: string;
  total: number;
  counts: Partial<Record<AssetStatus, number>>;
  assets: AssetView[];
}

export interface HistoryResponse {
  asset: AssetView;
  timeline: TimelineEntry[];
  reservations: ReservationView[];
}

export interface MovementListResponse {
  page: number;
  pageSize: number;
  total: number;
  movements: MovementView[];
}

export interface WorkerListResponse {
  total: number;
  workers: WorkerView[];
}

export interface KeeperListResponse {
  keepers: Keeper[];
}

/** Every write returns the movement it wrote and the asset's new state. */
export interface WriteResponse {
  movement?: MovementView;
  correction?: MovementView;
  correctsMovementId?: string;
  asset?: AssetView;
  reservation?: Partial<ReservationView> & { id: string };
  cancelledReservations?: number;
  assetCode?: string;
}
