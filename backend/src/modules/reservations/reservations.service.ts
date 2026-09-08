import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { AssetLockService } from '../../common/locking/asset-lock.service.js';
import { ClaimReplayService } from '../../common/write-path/claim-replay.service.js';
import { IdempotencyService } from '../../common/idempotency/idempotency.service.js';
import type { WriteOutcome } from '../../common/idempotency/idempotency.service.js';
import { conflict, notFound } from '../../common/errors/domain-error.js';
import { clashingReservations } from '../../domain/reservation-overlap.js';
import { foldAssetState } from '../../domain/state-fold.js';
import { toDomainAsset, toDomainMovement, toDomainReservation } from '../../persistence/mappers.js';
import type { AssetDoc, MovementDoc, ReservationDoc } from '../../persistence/mappers.js';
import { Asset } from '../../persistence/schemas/asset.schema.js';
import { Keeper } from '../../persistence/schemas/keeper.schema.js';
import { Movement } from '../../persistence/schemas/movement.schema.js';
import { Reservation } from '../../persistence/schemas/reservation.schema.js';
import { Worker } from '../../persistence/schemas/worker.schema.js';
import type { CancelReservationDto } from './dto/cancel-reservation.dto.js';
import type { CreateReservationDto } from './dto/create-reservation.dto.js';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Create and cancel a reservation. Unlike issue/return, there is no
 * asset_holdings-style unique key to lean on: overlap is a range test, and
 * no unique index can enforce a range constraint. This rule leans entirely
 * on the per-asset lease every write acquires (PLAN.md §10). After inserting,
 * the service re-reads the asset's reservations and asserts exactly one
 * match for the new window; if the lease were ever violated, the later
 * insert self-cancels rather than leaving two live overlapping claims.
 */
@Injectable()
export class ReservationsService {
  constructor(
    @InjectModel(Asset.name) private readonly assets: Model<Asset>,
    @InjectModel(Worker.name) private readonly workers: Model<Worker>,
    @InjectModel(Keeper.name) private readonly keepers: Model<Keeper>,
    @InjectModel(Movement.name) private readonly movements: Model<Movement>,
    @InjectModel(Reservation.name) private readonly reservations: Model<Reservation>,
    private readonly locks: AssetLockService,
    private readonly claims: ClaimReplayService,
    private readonly idempotency: IdempotencyService,
  ) {}

  async create(dto: CreateReservationDto, idempotencyKey: string): Promise<WriteOutcome<Record<string, unknown>>> {
    return this.idempotency.run(idempotencyKey, 'reservations', dto, () => this.doCreate(dto));
  }

  async cancel(
    reservationId: string,
    dto: CancelReservationDto,
    idempotencyKey: string,
  ): Promise<WriteOutcome<Record<string, unknown>>> {
    return this.idempotency.run(idempotencyKey, 'reservations/cancel', { reservationId, ...dto }, () =>
      this.doCancel(reservationId, dto),
    );
  }

  private async doCreate(dto: CreateReservationDto): Promise<Record<string, unknown>> {
    const assetId = this.objectId(dto.assetId, 'assetId');
    const workerId = this.objectId(dto.workerId, 'workerId');
    const keeperId = this.objectId(dto.keeperId, 'keeperId');

    // Minute precision (PLAN.md §12 #12): seconds and below are truncated
    // rather than rejected, so a client sending a plain-minute UI value and
    // one sending a timestamp with stray seconds are treated the same.
    const startsAt = truncateToMinute(new Date(dto.startsAt));
    const endsAt = truncateToMinute(new Date(dto.endsAt));
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
      throw new BadRequestException('startsAt/endsAt must be valid ISO-8601 timestamps.');
    }

    if (endsAt.getTime() <= startsAt.getTime()) {
      throw conflict('RESERVATION_INVERTED', 'A reservation must end after it starts.');
    }
    if (startsAt.getTime() <= Date.now()) {
      throw conflict('RESERVATION_IN_PAST', 'A reservation must start in the future.');
    }
    if (endsAt.getTime() - startsAt.getTime() > THIRTY_DAYS_MS) {
      throw conflict('RESERVATION_TOO_LONG', 'A reservation cannot span more than 30 days.');
    }

    return this.locks.withLease(assetId, 'reservations/create', async () => {
      await this.claims.replayIfUnsettled(assetId);

      const [assetDoc, workerDoc, keeperDoc] = await Promise.all([
        this.assets.findById(assetId).lean<AssetDoc | null>().exec(),
        this.workers.findById(workerId).lean().exec(),
        this.keepers.findById(keeperId).lean().exec(),
      ]);
      if (!assetDoc) throw notFound('ASSET_NOT_FOUND', `No asset with id ${dto.assetId}.`);
      if (!workerDoc) throw notFound('WORKER_NOT_FOUND', `No worker with id ${dto.workerId}.`);
      if (!keeperDoc) throw notFound('KEEPER_NOT_FOUND', `No keeper with id ${dto.keeperId}.`);

      const movementDocs = await this.movements.find({ assetId }).lean<MovementDoc[]>().exec();
      const state = foldAssetState({ asset: toDomainAsset(assetDoc), movements: movementDocs.map(toDomainMovement) });
      if (!state.serviceable) {
        throw conflict('ASSET_OUT_OF_SERVICE', `${assetDoc.code} is out of service and cannot be newly reserved.`);
      }

      const existing = await this.reservations.find({ assetId }).lean<ReservationDoc[]>().exec();
      const clashes = clashingReservations(existing.map(toDomainReservation), { startsAt, endsAt });
      if (clashes.length > 0) {
        throw conflict(
          'RESERVATION_OVERLAP',
          `${assetDoc.code} already has a reservation covering part of that window.`,
          { clashingReservationIds: clashes.map((c) => c.id) },
        );
      }

      const reservationId = new Types.ObjectId();
      await this.reservations.collection.insertOne({
        _id: reservationId,
        assetId,
        workerId,
        keeperId,
        startsAt,
        endsAt,
        status: 'PENDING',
        collectedMovementId: null,
        cancelledAt: null,
        cancelReason: null,
        idempotencyKey: null,
      });

      // The lease should make this impossible; verified rather than assumed,
      // because the lease is a serialisation aid, not the source of truth.
      const afterInsert = await this.reservations.find({ assetId }).lean<ReservationDoc[]>().exec();
      const stillClashing = clashingReservations(
        afterInsert.map(toDomainReservation).filter((r) => r.id !== reservationId.toString()),
        { startsAt, endsAt },
      );
      if (stillClashing.length > 0) {
        await this.reservations.collection.updateOne(
          { _id: reservationId },
          {
            $set: {
              status: 'CANCELLED',
              cancelledAt: new Date(),
              cancelReason: 'Self-cancelled: an overlapping reservation won the race.',
            },
          },
        );
        throw conflict(
          'RESERVATION_OVERLAP',
          `${assetDoc.code} already has a reservation covering part of that window.`,
        );
      }

      return {
        reservation: {
          id: reservationId.toString(),
          assetId: dto.assetId,
          worker: { id: workerDoc._id.toString(), name: workerDoc.name, employeeNo: workerDoc.employeeNo },
          startsAt,
          endsAt,
          status: 'PENDING',
        },
      };
    });
  }

  private async doCancel(reservationId: string, dto: CancelReservationDto): Promise<Record<string, unknown>> {
    const resId = this.objectId(reservationId, 'reservationId');
    const keeperId = this.objectId(dto.keeperId, 'keeperId');

    const reservationDoc = await this.reservations.findById(resId).lean<ReservationDoc | null>().exec();
    if (!reservationDoc) throw notFound('RESERVATION_NOT_FOUND', `No reservation with id ${reservationId}.`);

    return this.locks.withLease(reservationDoc.assetId, 'reservations/cancel', async () => {
      const current = await this.reservations.findById(resId).lean<ReservationDoc | null>().exec();
      if (!current) throw notFound('RESERVATION_NOT_FOUND', `No reservation with id ${reservationId}.`);
      if (current.status !== 'PENDING') {
        throw conflict(
          'RESERVATION_NOT_PENDING',
          `This reservation is ${current.status.toLowerCase()}, not pending; there is nothing to cancel.`,
        );
      }

      const keeperDoc = await this.keepers.findById(keeperId).lean().exec();
      if (!keeperDoc) throw notFound('KEEPER_NOT_FOUND', `No keeper with id ${dto.keeperId}.`);

      const cancelledAt = new Date();
      await this.reservations.collection.updateOne(
        { _id: resId, status: 'PENDING' },
        { $set: { status: 'CANCELLED', cancelledAt, cancelReason: dto.reason } },
      );

      return {
        reservation: {
          id: reservationId,
          status: 'CANCELLED',
          cancelledAt,
          cancelReason: dto.reason,
        },
      };
    });
  }

  private objectId(value: string, field: string): Types.ObjectId {
    if (!Types.ObjectId.isValid(value)) throw new BadRequestException(`${field} is not a valid id: ${value}`);
    return new Types.ObjectId(value);
  }
}

function truncateToMinute(date: Date): Date {
  const truncated = new Date(date);
  truncated.setSeconds(0, 0);
  return truncated;
}
