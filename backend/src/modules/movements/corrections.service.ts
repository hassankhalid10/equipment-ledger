import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { AssetLockService } from '../../common/locking/asset-lock.service.js';
import { ClaimReplayService } from '../../common/write-path/claim-replay.service.js';
import { IdempotencyService } from '../../common/idempotency/idempotency.service.js';
import type { WriteOutcome } from '../../common/idempotency/idempotency.service.js';
import { conflict, notFound } from '../../common/errors/domain-error.js';
import { effectiveMovements, correctionChain } from '../../domain/corrections.js';
import { foldAssetState } from '../../domain/state-fold.js';
import { toDomainAsset, toDomainMovement } from '../../persistence/mappers.js';
import type { AssetDoc, MovementDoc } from '../../persistence/mappers.js';
import { Asset } from '../../persistence/schemas/asset.schema.js';
import { Keeper } from '../../persistence/schemas/keeper.schema.js';
import { Movement } from '../../persistence/schemas/movement.schema.js';
import { Worker } from '../../persistence/schemas/worker.schema.js';
import { StoreReaderService } from '../ledger/store-reader.service.js';
import type { CorrectMovementDto } from './dto/correct-movement.dto.js';

/**
 * Corrections, not erasures (FR-18): a wrong movement is never edited or
 * deleted. Correcting it inserts a new movement that points back at the
 * original via correctsMovementId; the domain layer's effectiveMovements()
 * then treats the original as superseded while the fold still sees both, so
 * the history can show the strike-through and the fix side by side.
 *
 * The one rule that makes this safe: the corrected value has to leave the
 * asset's WHOLE timeline valid, not just look plausible in isolation. That
 * is checked by literally re-running the same fold every read uses, against
 * every movement the asset has ever had with the correction substituted in
 * - reusing the fold rather than writing a second, parallel set of rules
 * that could drift from it.
 */
@Injectable()
export class CorrectionsService {
  constructor(
    @InjectModel(Asset.name) private readonly assets: Model<Asset>,
    @InjectModel(Worker.name) private readonly workers: Model<Worker>,
    @InjectModel(Keeper.name) private readonly keepers: Model<Keeper>,
    @InjectModel(Movement.name) private readonly movements: Model<Movement>,
    private readonly locks: AssetLockService,
    private readonly claims: ClaimReplayService,
    private readonly idempotency: IdempotencyService,
    private readonly store: StoreReaderService,
  ) {}

  async correct(
    movementIdParam: string,
    dto: CorrectMovementDto,
    idempotencyKey: string,
  ): Promise<WriteOutcome<Record<string, unknown>>> {
    return this.idempotency.run(idempotencyKey, 'movements/corrections', { movementIdParam, ...dto }, () =>
      this.doCorrect(movementIdParam, dto),
    );
  }

  private async doCorrect(movementIdParam: string, dto: CorrectMovementDto): Promise<Record<string, unknown>> {
    const movementId = this.objectId(movementIdParam, 'movementId');
    const keeperId = this.objectId(dto.keeperId, 'keeperId');

    const target = await this.movements.findById(movementId).lean<MovementDoc | null>().exec();
    if (!target) throw notFound('MOVEMENT_NOT_FOUND', `No movement with id ${movementIdParam}.`);

    return this.locks.withLease(target.assetId, 'movements/corrections', async () => {
      await this.claims.replayIfUnsettled(target.assetId);

      const [assetDoc, keeperDoc] = await Promise.all([
        this.assets.findById(target.assetId).lean<AssetDoc | null>().exec(),
        this.keepers.findById(keeperId).lean().exec(),
      ]);
      if (!assetDoc) throw notFound('ASSET_NOT_FOUND', `No asset with id ${target.assetId.toString()}.`);
      if (!keeperDoc) throw notFound('KEEPER_NOT_FOUND', `No keeper with id ${dto.keeperId}.`);

      const allMovementDocs = await this.movements.find({ assetId: target.assetId }).lean<MovementDoc[]>().exec();
      const allMovements = allMovementDocs.map(toDomainMovement);

      // Only the tip of a chain may be corrected. Correcting an old link
      // directly would leave two entries both pointing at it - an ambiguous
      // branch rather than a chain. To fix something further back, correct
      // the latest correction; the chain is followed to its tip either way
      // when the history renders (PLAN.md §12 #14).
      const effectiveIds = new Set(effectiveMovements(allMovements).map((m) => m.id));
      if (!effectiveIds.has(movementId.toString())) {
        const chain = correctionChain(allMovements, movementId.toString());
        const tip = chain[chain.length - 1];
        throw conflict(
          'MOVEMENT_ALREADY_CORRECTED',
          `This movement has already been corrected. Correct the latest correction (${tip?.id ?? 'unknown'}) instead.`,
          { correctedBy: tip?.id },
        );
      }

      const occurredAt = dto.occurredAt ? new Date(dto.occurredAt) : target.occurredAt;
      if (Number.isNaN(occurredAt.getTime())) {
        throw new BadRequestException(`occurredAt is not a valid instant: ${dto.occurredAt}`);
      }
      if (occurredAt.getTime() > Date.now()) {
        throw new BadRequestException('occurredAt cannot be in the future.');
      }

      const workerId = dto.workerId ? this.objectId(dto.workerId, 'workerId') : (target.workerId ?? null);
      const returnedByWorkerId = dto.returnedByWorkerId
        ? this.objectId(dto.returnedByWorkerId, 'returnedByWorkerId')
        : (target.returnedByWorkerId ?? null);
      const dueAt = dto.dueAt ? new Date(dto.dueAt) : (target.dueAt ?? null);
      if (dueAt && dueAt.getTime() <= occurredAt.getTime()) {
        throw new BadRequestException('dueAt must be after occurredAt.');
      }
      if (dto.workerId) {
        const worker = await this.workers.findById(workerId).lean().exec();
        if (!worker) throw notFound('WORKER_NOT_FOUND', `No worker with id ${dto.workerId}.`);
      }
      if (dto.returnedByWorkerId) {
        const returner = await this.workers.findById(returnedByWorkerId).lean().exec();
        if (!returner) throw notFound('WORKER_NOT_FOUND', `No worker with id ${dto.returnedByWorkerId}.`);
      }

      const correctionId = new Types.ObjectId();
      const correction = {
        _id: correctionId,
        assetId: target.assetId,
        type: target.type,
        occurredAt,
        recordedAt: new Date(),
        keeperId,
        workerId,
        returnedByWorkerId,
        dueAt,
        condition: dto.condition ?? target.condition ?? null,
        reservationId: target.reservationId ?? null,
        correctsMovementId: movementId,
        correctionReason: dto.correctionReason,
        reason: dto.reason ?? target.reason ?? null,
        note: dto.note ?? target.note ?? null,
        idempotencyKey: null,
      };

      // The whole point: re-run the SAME fold every read uses, against the
      // asset's whole life with the correction substituted in. A violation
      // here means this correction would put the asset in two hands at
      // once, or close a hold that was never open - refused, not written.
      const projectedState = foldAssetState({
        asset: toDomainAsset(assetDoc),
        movements: [...allMovements, toDomainMovement(correction)],
      });
      if (projectedState.violations.length > 0) {
        throw conflict(
          'CORRECTION_BREAKS_TIMELINE',
          `This correction would leave the timeline invalid: ${projectedState.violations.map((v) => v.message).join('; ')}`,
          { violations: projectedState.violations },
        );
      }

      await this.movements.collection.insertOne(correction);

      const asset = await this.store.assetByCode(assetDoc.code);
      const workers = await this.store.workerIndex();
      return {
        correction: this.store.movementView(toDomainMovement(correction), workers),
        correctsMovementId: movementIdParam,
        asset,
      };
    });
  }

  private objectId(value: string, field: string): Types.ObjectId {
    if (!Types.ObjectId.isValid(value)) throw new BadRequestException(`${field} is not a valid id: ${value}`);
    return new Types.ObjectId(value);
  }
}
