import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { AssetLockService } from '../../common/locking/asset-lock.service.js';
import { ClaimReplayService } from '../../common/write-path/claim-replay.service.js';
import { IdempotencyService } from '../../common/idempotency/idempotency.service.js';
import type { WriteOutcome } from '../../common/idempotency/idempotency.service.js';
import { conflict, notFound } from '../../common/errors/domain-error.js';
import { foldAssetState } from '../../domain/state-fold.js';
import { toDomainAsset, toDomainMovement } from '../../persistence/mappers.js';
import type { AssetDoc, MovementDoc } from '../../persistence/mappers.js';
import { Asset } from '../../persistence/schemas/asset.schema.js';
import { Keeper } from '../../persistence/schemas/keeper.schema.js';
import { Movement } from '../../persistence/schemas/movement.schema.js';
import { Reservation } from '../../persistence/schemas/reservation.schema.js';
import type { BackInServiceDto, OutOfServiceDto } from './dto/service-status.dto.js';

/**
 * Two judgement calls live here, both stated in PLAN.md §12 and repeated in
 * the README: taking an asset out of service does not force a return - the
 * holder keeps it, unserviceable from that instant - and it cancels any
 * standing future reservations rather than leaving them to fail later
 * without explanation.
 *
 * Simpler than issue/return's claim/intent machinery on purpose: each
 * change here is one movement insert plus, for out-of-service, a bulk
 * cancel of reservations that is idempotent on its own filter (status:
 * 'PENDING' - cancelling an already-cancelled reservation is a no-op). A
 * crash between the two leaves the movement recorded and the reservations
 * to be caught by their own overlap/serviceability checks on the next
 * write, rather than needing a formal replay entry.
 */
@Injectable()
export class ServiceStatusService {
  constructor(
    @InjectModel(Asset.name) private readonly assets: Model<Asset>,
    @InjectModel(Keeper.name) private readonly keepers: Model<Keeper>,
    @InjectModel(Movement.name) private readonly movements: Model<Movement>,
    @InjectModel(Reservation.name) private readonly reservations: Model<Reservation>,
    private readonly locks: AssetLockService,
    private readonly claims: ClaimReplayService,
    private readonly idempotency: IdempotencyService,
  ) {}

  async outOfService(
    assetIdParam: string,
    dto: OutOfServiceDto,
    idempotencyKey: string,
  ): Promise<WriteOutcome<Record<string, unknown>>> {
    return this.idempotency.run(idempotencyKey, 'assets/out-of-service', { assetIdParam, ...dto }, () =>
      this.doOutOfService(assetIdParam, dto),
    );
  }

  async backInService(
    assetIdParam: string,
    dto: BackInServiceDto,
    idempotencyKey: string,
  ): Promise<WriteOutcome<Record<string, unknown>>> {
    return this.idempotency.run(idempotencyKey, 'assets/back-in-service', { assetIdParam, ...dto }, () =>
      this.doBackInService(assetIdParam, dto),
    );
  }

  private async doOutOfService(assetIdParam: string, dto: OutOfServiceDto): Promise<Record<string, unknown>> {
    const assetId = this.objectId(assetIdParam, 'assetId');
    const keeperId = this.objectId(dto.keeperId, 'keeperId');
    const occurredAt = this.parseOccurredAt(dto.occurredAt);

    return this.locks.withLease(assetId, 'assets/out-of-service', async () => {
      await this.claims.replayIfUnsettled(assetId);

      const [assetDoc, keeperDoc] = await Promise.all([
        this.assets.findById(assetId).lean<AssetDoc | null>().exec(),
        this.keepers.findById(keeperId).lean().exec(),
      ]);
      if (!assetDoc) throw notFound('ASSET_NOT_FOUND', `No asset with id ${assetIdParam}.`);
      if (!keeperDoc) throw notFound('KEEPER_NOT_FOUND', `No keeper with id ${dto.keeperId}.`);

      const movementDocs = await this.movements.find({ assetId }).lean<MovementDoc[]>().exec();
      const state = foldAssetState({
        asset: toDomainAsset(assetDoc),
        movements: movementDocs.map(toDomainMovement),
        at: occurredAt,
      });
      if (!state.serviceable) {
        throw conflict('ASSET_ALREADY_OUT_OF_SERVICE', `${assetDoc.code} is already out of service.`);
      }

      const movement = {
        _id: new Types.ObjectId(),
        assetId,
        type: 'OUT_OF_SERVICE' as const,
        occurredAt,
        recordedAt: new Date(),
        keeperId,
        workerId: null,
        returnedByWorkerId: null,
        dueAt: null,
        condition: null,
        reservationId: null,
        correctsMovementId: null,
        correctionReason: null,
        reason: dto.reason,
        note: null,
        idempotencyKey: null,
      };
      await this.movements.collection.insertOne(movement);

      // Standing reservations are resolved by a stated decision, not left to
      // fail silently later: cancelled, with the reason recorded, and they
      // stay visible in the ledger rather than being deleted.
      const cancelledAt = new Date();
      const cancelResult = await this.reservations.collection.updateMany(
        { assetId, status: 'PENDING', endsAt: { $gt: occurredAt } },
        {
          $set: {
            status: 'CANCELLED',
            cancelledAt,
            cancelReason: `Asset taken out of service: ${dto.reason}`,
          },
        },
      );

      return {
        movement: {
          id: movement._id.toString(),
          type: movement.type,
          occurredAt: movement.occurredAt,
          reason: movement.reason,
        },
        cancelledReservations: cancelResult.modifiedCount,
        assetCode: assetDoc.code,
      };
    });
  }

  private async doBackInService(assetIdParam: string, dto: BackInServiceDto): Promise<Record<string, unknown>> {
    const assetId = this.objectId(assetIdParam, 'assetId');
    const keeperId = this.objectId(dto.keeperId, 'keeperId');
    const occurredAt = this.parseOccurredAt(dto.occurredAt);

    return this.locks.withLease(assetId, 'assets/back-in-service', async () => {
      await this.claims.replayIfUnsettled(assetId);

      const [assetDoc, keeperDoc] = await Promise.all([
        this.assets.findById(assetId).lean<AssetDoc | null>().exec(),
        this.keepers.findById(keeperId).lean().exec(),
      ]);
      if (!assetDoc) throw notFound('ASSET_NOT_FOUND', `No asset with id ${assetIdParam}.`);
      if (!keeperDoc) throw notFound('KEEPER_NOT_FOUND', `No keeper with id ${dto.keeperId}.`);

      const movementDocs = await this.movements.find({ assetId }).lean<MovementDoc[]>().exec();
      const state = foldAssetState({
        asset: toDomainAsset(assetDoc),
        movements: movementDocs.map(toDomainMovement),
        at: occurredAt,
      });
      if (state.serviceable) {
        throw conflict('ASSET_ALREADY_IN_SERVICE', `${assetDoc.code} is already in service.`);
      }

      const movement = {
        _id: new Types.ObjectId(),
        assetId,
        type: 'BACK_IN_SERVICE' as const,
        occurredAt,
        recordedAt: new Date(),
        keeperId,
        workerId: null,
        returnedByWorkerId: null,
        dueAt: null,
        condition: null,
        reservationId: null,
        correctsMovementId: null,
        correctionReason: null,
        reason: null,
        note: dto.note,
        idempotencyKey: null,
      };
      await this.movements.collection.insertOne(movement);

      return {
        movement: {
          id: movement._id.toString(),
          type: movement.type,
          occurredAt: movement.occurredAt,
          note: movement.note,
        },
        assetCode: assetDoc.code,
      };
    });
  }

  private objectId(value: string, field: string): Types.ObjectId {
    if (!Types.ObjectId.isValid(value)) throw new BadRequestException(`${field} is not a valid id: ${value}`);
    return new Types.ObjectId(value);
  }

  private parseOccurredAt(value: string | undefined): Date {
    const at = value ? new Date(value) : new Date();
    if (Number.isNaN(at.getTime())) throw new BadRequestException(`occurredAt is not a valid instant: ${value}`);
    if (at.getTime() > Date.now()) throw new BadRequestException('occurredAt cannot be in the future.');
    return at;
  }
}
