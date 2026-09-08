import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { correctionChain, effectiveMovements } from '../../domain/corrections.js';
import { sortMovements } from '../../domain/ordering.js';
import { foldAssetState } from '../../domain/state-fold.js';
import { storeAsOf } from '../../domain/as-of.js';
import type { AssetState, Movement, Reservation } from '../../domain/types.js';
import {
  toDomainAsset,
  toDomainMovement,
  toDomainReservation,
  idToString,
} from '../../persistence/mappers.js';
import type { AssetDoc, MovementDoc, ReservationDoc } from '../../persistence/mappers.js';
import { Asset } from '../../persistence/schemas/asset.schema.js';
import { Movement as MovementSchemaClass } from '../../persistence/schemas/movement.schema.js';
import { Reservation as ReservationSchemaClass } from '../../persistence/schemas/reservation.schema.js';
import { Worker } from '../../persistence/schemas/worker.schema.js';

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
  addedToStoreAt: Date;
  status: AssetState['status'];
  serviceable: boolean;
  holder: (WorkerRef & { since: Date; dueAt: Date | null; issueMovementId: string }) | null;
  activeReservation: { id: string; worker: WorkerRef | null; startsAt: Date; endsAt: Date } | null;
}

/**
 * Every read in the API goes through here, and every answer is folded from
 * the ledger at request time. There is no cached current state to fall out of
 * step with the movements (FR-20), which is the property the invariant
 * checker exists to prove.
 *
 * Cost, stated plainly: answering "the whole store, now" reads every movement
 * and folds it. At 60 assets and a few hundred movements that is a few
 * milliseconds. At 60,000 assets I would snapshot the fold periodically and
 * roll forward from the nearest snapshot; the shape of this code would not
 * change, only where the fold starts.
 */
@Injectable()
export class StoreReaderService {
  constructor(
    @InjectModel(Asset.name) private readonly assets: Model<Asset>,
    @InjectModel(MovementSchemaClass.name) private readonly movements: Model<MovementSchemaClass>,
    @InjectModel(ReservationSchemaClass.name)
    private readonly reservations: Model<ReservationSchemaClass>,
    @InjectModel(Worker.name) private readonly workers: Model<Worker>,
  ) {}

  async workerIndex(): Promise<Map<string, WorkerRef>> {
    const docs = await this.workers.find({}, { name: 1, employeeNo: 1 }).lean().exec();
    return new Map(
      docs.map((d) => [
        idToString(d._id),
        { id: idToString(d._id), name: d.name, employeeNo: d.employeeNo },
      ]),
    );
  }

  /** The whole store as it stood at `at`. `at` defaults to now. */
  async storeAt(at: Date = new Date()): Promise<AssetView[]> {
    const [assetDocs, movementDocs, reservationDocs, workers] = await Promise.all([
      this.assets.find().sort({ code: 1 }).lean<AssetDoc[]>().exec(),
      this.movements.find().lean<MovementDoc[]>().exec(),
      this.reservations.find().lean<ReservationDoc[]>().exec(),
      this.workerIndex(),
    ]);

    const states = storeAsOf({
      assets: assetDocs.map(toDomainAsset),
      movements: movementDocs.map(toDomainMovement),
      reservations: reservationDocs.map(toDomainReservation),
      at,
    });

    const stateById = new Map(states.map((s) => [s.assetId, s]));
    const reservationById = new Map(
      reservationDocs.map((r) => [idToString(r._id), toDomainReservation(r)]),
    );

    return assetDocs.map((doc) =>
      this.view(doc, stateById.get(idToString(doc._id))!, workers, reservationById),
    );
  }

  async assetByCode(code: string, at: Date = new Date()): Promise<AssetView> {
    const doc = await this.assets.findOne({ code }).lean<AssetDoc | null>().exec();
    if (!doc) throw new NotFoundException(`No asset with code ${code}.`);

    const [movementDocs, reservationDocs, workers] = await Promise.all([
      this.movements.find({ assetId: doc._id }).lean<MovementDoc[]>().exec(),
      this.reservations.find({ assetId: doc._id }).lean<ReservationDoc[]>().exec(),
      this.workerIndex(),
    ]);

    const state = foldAssetState({
      asset: toDomainAsset(doc),
      movements: movementDocs.map(toDomainMovement),
      reservations: reservationDocs.map(toDomainReservation),
      at,
    });

    const reservationById = new Map(
      reservationDocs.map((r) => [idToString(r._id), toDomainReservation(r)]),
    );
    return this.view(doc, state, workers, reservationById);
  }

  /**
   * One asset's whole life. Superseded movements are returned alongside the
   * effective ones rather than hidden, because "corrections, not erasures"
   * means the mistake has to stay visible (FR-18).
   */
  async assetHistory(code: string) {
    const doc = await this.assets.findOne({ code }).lean<AssetDoc | null>().exec();
    if (!doc) throw new NotFoundException(`No asset with code ${code}.`);

    const [movementDocs, reservationDocs, workers] = await Promise.all([
      this.movements.find({ assetId: doc._id }).lean<MovementDoc[]>().exec(),
      this.reservations.find({ assetId: doc._id }).sort({ startsAt: 1 }).lean<ReservationDoc[]>().exec(),
      this.workerIndex(),
    ]);

    const all = movementDocs.map(toDomainMovement);
    const effective = new Set(effectiveMovements(all).map((m) => m.id));

    const timeline = sortMovements(all).map((m) => ({
      ...this.movementView(m, workers),
      superseded: !effective.has(m.id),
      chain: m.correctsMovementId ? correctionChain(all, m.id).map((c) => c.id) : null,
    }));

    return {
      asset: await this.assetByCode(code),
      timeline,
      reservations: reservationDocs.map((r) => ({
        id: idToString(r._id),
        worker: workers.get(idToString(r.workerId)) ?? null,
        startsAt: r.startsAt,
        endsAt: r.endsAt,
        status: r.status,
        // Not a stored status: a booking whose window has passed and was
        // never turned into an issue (PLAN.md §12 #10).
        neverCollected: r.status === 'PENDING' && r.endsAt < new Date(),
        cancelReason: r.cancelReason ?? null,
      })),
    };
  }

  movementView(m: Movement, workers: Map<string, WorkerRef>) {
    return {
      id: m.id,
      assetId: m.assetId,
      type: m.type,
      occurredAt: m.occurredAt,
      recordedAt: m.recordedAt,
      worker: m.workerId ? (workers.get(m.workerId) ?? null) : null,
      returnedBy: m.returnedByWorkerId ? (workers.get(m.returnedByWorkerId) ?? null) : null,
      dueAt: m.dueAt ?? null,
      condition: m.condition ?? null,
      correctsMovementId: m.correctsMovementId ?? null,
      correctionReason: m.correctionReason ?? null,
      reason: m.reason ?? null,
      note: m.note ?? null,
      // The two clocks, side by side, so a late entry is visible (FR-17).
      loggedLate: m.recordedAt.getTime() - m.occurredAt.getTime() > 60 * 60 * 1000,
    };
  }

  private view(
    doc: AssetDoc,
    state: AssetState,
    workers: Map<string, WorkerRef>,
    reservations: Map<string, Reservation>,
  ): AssetView {
    const holderRef = state.holder ? workers.get(state.holder.workerId) : undefined;
    const reservation = state.activeReservation
      ? reservations.get(state.activeReservation.id)
      : undefined;

    return {
      id: idToString(doc._id),
      code: doc.code,
      name: doc.name,
      kind: doc.kind,
      requiredCertification: doc.requiredCertification,
      addedToStoreAt: doc.addedToStoreAt,
      status: state.status,
      serviceable: state.serviceable,
      holder:
        state.holder && holderRef
          ? {
              ...holderRef,
              since: state.holder.since,
              dueAt: state.holder.dueAt ?? null,
              issueMovementId: state.holder.issueMovementId,
            }
          : null,
      activeReservation: reservation
        ? {
            id: reservation.id,
            worker: workers.get(reservation.workerId) ?? null,
            startsAt: reservation.startsAt,
            endsAt: reservation.endsAt,
          }
        : null,
    };
  }
}
