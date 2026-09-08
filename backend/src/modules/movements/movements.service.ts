import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { AssetLockService } from '../../common/locking/asset-lock.service.js';
import { ClaimReplayService } from '../../common/write-path/claim-replay.service.js';
import { IdempotencyService, hashRequestBody } from '../../common/idempotency/idempotency.service.js';
import { conflict, notFound } from '../../common/errors/domain-error.js';
import { checkCertification } from '../../domain/certification.js';
import { foldAssetState } from '../../domain/state-fold.js';
import { toDomainAsset, toDomainMovement, toDomainReservation } from '../../persistence/mappers.js';
import type { AssetDoc, MovementDoc, ReservationDoc } from '../../persistence/mappers.js';
import { Asset } from '../../persistence/schemas/asset.schema.js';
import { AssetHolding } from '../../persistence/schemas/asset-holding.schema.js';
import { Keeper } from '../../persistence/schemas/keeper.schema.js';
import { Movement } from '../../persistence/schemas/movement.schema.js';
import { Reservation } from '../../persistence/schemas/reservation.schema.js';
import { Worker } from '../../persistence/schemas/worker.schema.js';
import { StoreReaderService } from '../ledger/store-reader.service.js';
import type { IssueDto } from './dto/issue.dto.js';
import type { ReturnDto } from './dto/return.dto.js';

export interface WriteResult {
  status: 201;
  body: Record<string, unknown>;
  replay: boolean;
}

/**
 * Issue and return: the write path from PLAN.md §7, in full.
 *
 * Every mutation follows the same eight steps: reject a missing idempotency
 * key, look up a prior result under that key, acquire the asset's lease,
 * replay any claim the lease's previous holder left unsettled, run the
 * domain rules against the freshly-replayed timeline, take a claim naming
 * exactly which movements are about to be written, apply that claim, and
 * settle it. Nothing here uses a MongoDB transaction; each of those steps is
 * a single-document write, which is what stays atomic on a standalone
 * server.
 */
@Injectable()
export class MovementsService {
  constructor(
    @InjectModel(Asset.name) private readonly assets: Model<Asset>,
    @InjectModel(Worker.name) private readonly workers: Model<Worker>,
    @InjectModel(Keeper.name) private readonly keepers: Model<Keeper>,
    @InjectModel(Movement.name) private readonly movements: Model<Movement>,
    @InjectModel(Reservation.name) private readonly reservations: Model<Reservation>,
    @InjectModel(AssetHolding.name) private readonly holdings: Model<AssetHolding>,
    private readonly locks: AssetLockService,
    private readonly claims: ClaimReplayService,
    private readonly idempotency: IdempotencyService,
    private readonly store: StoreReaderService,
  ) {}

  async issue(dto: IssueDto, idempotencyKey: string): Promise<WriteResult> {
    const requestHash = hashRequestBody(dto);
    const prior = await this.idempotency.begin(idempotencyKey, 'movements/issue', requestHash);
    if (prior) return { status: 201, body: prior.body, replay: true };

    try {
      const body = await this.doIssue(dto, idempotencyKey);
      await this.idempotency.complete(idempotencyKey, 201, body);
      return { status: 201, body, replay: false };
    } catch (err) {
      await this.recordFailureIfDomainError(idempotencyKey, err);
      throw err;
    }
  }

  async returnAsset(dto: ReturnDto, idempotencyKey: string): Promise<WriteResult> {
    const requestHash = hashRequestBody(dto);
    const prior = await this.idempotency.begin(idempotencyKey, 'movements/return', requestHash);
    if (prior) return { status: 201, body: prior.body, replay: true };

    try {
      const body = await this.doReturn(dto, idempotencyKey);
      await this.idempotency.complete(idempotencyKey, 201, body);
      return { status: 201, body, replay: false };
    } catch (err) {
      await this.recordFailureIfDomainError(idempotencyKey, err);
      throw err;
    }
  }

  private async recordFailureIfDomainError(key: string, err: unknown): Promise<void> {
    // A domain refusal is a final answer worth replaying: retrying the same
    // key should see the same 409 again, not re-run the checks. Anything
    // else (a bug, a dropped connection) leaves the key IN_FLIGHT, which
    // blocks a same-key retry rather than caching a result nobody decided.
    const isDomainError =
      typeof err === 'object' && err !== null && 'code' in err && 'status' in err && 'message' in err;
    if (!isDomainError) return;
    const e = err as { code: string; status: number; message: string; details?: unknown };
    await this.idempotency.complete(key, e.status, {
      error: { code: e.code, message: e.message, details: e.details },
    });
  }

  // ---------------------------------------------------------------------

  private async doIssue(dto: IssueDto, idempotencyKey: string): Promise<Record<string, unknown>> {
    const assetId = this.objectId(dto.assetId, 'assetId');
    const workerId = this.objectId(dto.workerId, 'workerId');
    const keeperId = this.objectId(dto.keeperId, 'keeperId');
    const occurredAt = this.parseOccurredAt(dto.occurredAt);
    const dueAt = dto.dueAt ? new Date(dto.dueAt) : null;
    if (dueAt && dueAt.getTime() <= occurredAt.getTime()) {
      throw new BadRequestException('dueAt must be after occurredAt.');
    }

    return this.locks.withLease(assetId, 'issue', async () => {
      await this.claims.replayIfUnsettled(assetId);

      const [assetDoc, workerDoc, keeperDoc] = await Promise.all([
        this.assets.findById(assetId).lean<AssetDoc | null>().exec(),
        this.workers.findById(workerId).lean().exec(),
        this.keepers.findById(keeperId).lean().exec(),
      ]);
      if (!assetDoc) throw notFound('ASSET_NOT_FOUND', `No asset with id ${dto.assetId}.`);
      if (!workerDoc) throw notFound('WORKER_NOT_FOUND', `No worker with id ${dto.workerId}.`);
      if (!keeperDoc) throw notFound('KEEPER_NOT_FOUND', `No keeper with id ${dto.keeperId}.`);

      const movementDocs = await this.movements
        .find({ assetId })
        .lean<MovementDoc[]>()
        .exec();
      const reservationDocs = await this.reservations
        .find({ assetId })
        .lean<ReservationDoc[]>()
        .exec();

      const state = foldAssetState({
        asset: toDomainAsset(assetDoc),
        movements: movementDocs.map(toDomainMovement),
        reservations: reservationDocs.map(toDomainReservation),
        at: occurredAt,
      });

      if (state.status === 'NOT_YET_IN_STORE') {
        throw conflict(
          'ASSET_NOT_YET_IN_STORE',
          `${assetDoc.code} was not yet in the store at ${occurredAt.toISOString()}.`,
        );
      }
      if (state.holder) {
        const holderWorker = await this.workers.findById(state.holder.workerId).lean().exec();
        throw conflict(
          'ASSET_ALREADY_HELD',
          `${assetDoc.code} is already held by ${holderWorker?.name ?? 'someone else'}.`,
        );
      }
      if (!state.serviceable) {
        throw conflict('ASSET_OUT_OF_SERVICE', `${assetDoc.code} is out of service and cannot be issued.`);
      }

      // A reservation active for someone else refuses the issue outright.
      // Active for the same worker collects it automatically - the spec
      // does not require the client to pass reservationId for that to work,
      // though if it did, it must name the same reservation (PLAN.md §12 #9).
      let collectReservationId: Types.ObjectId | null = null;
      if (state.activeReservation) {
        if (state.activeReservation.workerId !== dto.workerId) {
          const reservedFor = await this.workers.findById(state.activeReservation.workerId).lean().exec();
          throw conflict(
            'ASSET_RESERVED_BY_ANOTHER_WORKER',
            `${assetDoc.code} is reserved for ${reservedFor?.name ?? 'another worker'} at this time.`,
          );
        }
        collectReservationId = new Types.ObjectId(state.activeReservation.id);
        if (dto.reservationId && dto.reservationId !== state.activeReservation.id) {
          throw conflict(
            'RESERVATION_NOT_FOUND',
            `reservationId does not match the active reservation for this asset and worker.`,
          );
        }
      } else if (dto.reservationId) {
        throw conflict(
          'RESERVATION_NOT_FOUND',
          `No active reservation ${dto.reservationId} for this asset and worker at this time.`,
        );
      }

      const certCheck = checkCertification(
        { name: workerDoc.name, certifications: workerDoc.certifications },
        assetDoc.requiredCertification,
        occurredAt,
      );
      if (!certCheck.ok) throw conflict(certCheck.code, certCheck.message);

      const movementId = new Types.ObjectId();
      const now = new Date();
      const movement = {
        _id: movementId,
        assetId,
        type: 'ISSUE' as const,
        occurredAt,
        recordedAt: now,
        keeperId,
        workerId,
        returnedByWorkerId: null,
        dueAt,
        condition: null,
        reservationId: collectReservationId,
        correctsMovementId: null,
        correctionReason: null,
        reason: null,
        note: dto.note ?? null,
        idempotencyKey,
      };

      // THE CLAIM. A duplicate key here means someone already holds the
      // asset - the storage engine refuses the second holder unconditionally,
      // whatever came before this line (PLAN.md §7).
      try {
        await this.holdings.collection.insertOne({
          _id: assetId,
          state: 'PENDING',
          workerId,
          issueMovementId: movementId,
          since: occurredAt,
          dueAt,
          intent: { movementIds: [movementId], movements: [movement], collectReservationId },
          claimedAt: now,
          idempotencyKey,
        });
      } catch (err) {
        if (isDuplicateKey(err)) {
          throw conflict('ASSET_ALREADY_HELD', `${assetDoc.code} is already held by someone else.`);
        }
        throw err;
      }

      await this.claims.replayIfUnsettled(assetId);

      const asset = await this.store.assetByCode(assetDoc.code);
      const workers = await this.store.workerIndex();
      return {
        movement: this.store.movementView(toDomainMovement({ ...movement }), workers),
        asset,
      };
    });
  }

  private async doReturn(dto: ReturnDto, idempotencyKey: string): Promise<Record<string, unknown>> {
    const assetId = this.objectId(dto.assetId, 'assetId');
    const keeperId = this.objectId(dto.keeperId, 'keeperId');
    const returnedByWorkerId = dto.returnedByWorkerId
      ? this.objectId(dto.returnedByWorkerId, 'returnedByWorkerId')
      : null;
    const occurredAt = this.parseOccurredAt(dto.occurredAt);

    return this.locks.withLease(assetId, 'return', async () => {
      await this.claims.replayIfUnsettled(assetId);

      const [assetDoc, keeperDoc] = await Promise.all([
        this.assets.findById(assetId).lean<AssetDoc | null>().exec(),
        this.keepers.findById(keeperId).lean().exec(),
      ]);
      if (!assetDoc) throw notFound('ASSET_NOT_FOUND', `No asset with id ${dto.assetId}.`);
      if (!keeperDoc) throw notFound('KEEPER_NOT_FOUND', `No keeper with id ${dto.keeperId}.`);
      if (returnedByWorkerId) {
        const returner = await this.workers.findById(returnedByWorkerId).lean().exec();
        if (!returner) throw notFound('WORKER_NOT_FOUND', `No worker with id ${dto.returnedByWorkerId}.`);
      }

      const movementDocs = await this.movements.find({ assetId }).lean<MovementDoc[]>().exec();
      const domainMovements = movementDocs.map(toDomainMovement);

      const stateAtReturn = foldAssetState({
        asset: toDomainAsset(assetDoc),
        movements: domainMovements,
        at: occurredAt,
      });

      if (!stateAtReturn.holder) {
        // Distinguish "never held" from "backdated before the issue that
        // currently holds it", because they read very differently to a
        // keeper (PLAN.md §12, the backdating attack).
        const stateNow = foldAssetState({ asset: toDomainAsset(assetDoc), movements: domainMovements });
        if (stateNow.holder && stateNow.holder.since.getTime() > occurredAt.getTime()) {
          throw conflict(
            'RETURN_BEFORE_ISSUE',
            `This return is dated ${occurredAt.toISOString()}, before the current holder took it at ${stateNow.holder.since.toISOString()}.`,
          );
        }
        throw conflict('ASSET_NOT_HELD', `${assetDoc.code} is not currently held; there is nothing to return.`);
      }

      const holderWorkerId = new Types.ObjectId(stateAtReturn.holder.workerId);
      const finalReturnedBy = returnedByWorkerId ?? holderWorkerId;
      const condition = dto.condition;
      const now = new Date();

      const returnMovementId = new Types.ObjectId();
      const returnMovement = {
        _id: returnMovementId,
        assetId,
        type: 'RETURN' as const,
        occurredAt,
        recordedAt: now,
        keeperId,
        workerId: null,
        returnedByWorkerId: finalReturnedBy,
        dueAt: null,
        condition,
        reservationId: null,
        correctsMovementId: null,
        correctionReason: null,
        reason: null,
        note: dto.note ?? null,
        idempotencyKey,
      };

      const intentMovements: Record<string, unknown>[] = [returnMovement];
      const intentIds = [returnMovementId];

      // A damaged return writes both movements under one claim, so they
      // apply together on replay even without a transaction (PLAN.md §12 #4).
      if (condition === 'DAMAGED') {
        const oosMovementId = new Types.ObjectId();
        intentMovements.push({
          _id: oosMovementId,
          assetId,
          type: 'OUT_OF_SERVICE' as const,
          occurredAt,
          recordedAt: now,
          keeperId,
          workerId: null,
          returnedByWorkerId: null,
          dueAt: null,
          condition: null,
          reservationId: null,
          correctsMovementId: null,
          correctionReason: null,
          reason: dto.note ? `Returned damaged: ${dto.note}` : 'Returned damaged.',
          note: null,
          idempotencyKey,
        });
        intentIds.push(oosMovementId);
      }

      // THE CLAIM, for the release side: only succeeds if the guard still
      // says ACTIVE, so a race against a second return loses here.
      const claimResult = await this.holdings.collection.updateOne(
        { _id: assetId, state: 'ACTIVE' },
        {
          $set: {
            state: 'RELEASING',
            intent: { movementIds: intentIds, movements: intentMovements, collectReservationId: null },
            claimedAt: now,
            idempotencyKey,
          },
        },
      );
      if (claimResult.matchedCount === 0) {
        throw conflict('ASSET_NOT_HELD', `${assetDoc.code} is not currently held; there is nothing to return.`);
      }

      await this.claims.replayIfUnsettled(assetId);

      const asset = await this.store.assetByCode(assetDoc.code);
      const workers = await this.store.workerIndex();
      return {
        movement: this.store.movementView(toDomainMovement({ ...returnMovement }), workers),
        asset,
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
    if (at.getTime() > Date.now()) {
      throw new BadRequestException('occurredAt cannot be in the future.');
    }
    return at;
  }
}

function isDuplicateKey(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}
