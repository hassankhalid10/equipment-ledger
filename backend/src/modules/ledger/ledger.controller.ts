import { BadRequestException, Controller, Get, Param, Query } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { StoreReaderService } from './store-reader.service.js';
import { AsOfQuery, AssetListQuery, MovementListQuery, ReservationListQuery } from './dto/query.dto.js';
import { toDomainMovement, idToString } from '../../persistence/mappers.js';
import type { MovementDoc, ReservationDoc } from '../../persistence/mappers.js';
import { Movement } from '../../persistence/schemas/movement.schema.js';
import { Reservation } from '../../persistence/schemas/reservation.schema.js';

@Controller()
export class LedgerController {
  constructor(
    private readonly store: StoreReaderService,
    @InjectModel(Movement.name) private readonly movements: Model<Movement>,
    @InjectModel(Reservation.name) private readonly reservations: Model<Reservation>,
  ) {}

  @Get('assets')
  async listAssets(@Query() query: AssetListQuery) {
    let assets = await this.store.storeAt();

    if (query.status) assets = assets.filter((a) => a.status === query.status);
    if (query.kind) assets = assets.filter((a) => a.kind === query.kind);
    if (query.q) {
      const needle = query.q.toLowerCase();
      assets = assets.filter(
        (a) => a.code.toLowerCase().includes(needle) || a.name.toLowerCase().includes(needle),
      );
    }

    return { at: new Date(), total: assets.length, assets };
  }

  @Get('assets/:code')
  asset(@Param('code') code: string) {
    return this.store.assetByCode(code);
  }

  @Get('assets/:code/history')
  history(@Param('code') code: string) {
    return this.store.assetHistory(code);
  }

  /**
   * The store as it stood at an instant. Answered by folding the ledger, with
   * no cache in the path, which is the whole point of FR-20.
   */
  @Get('ledger/as-of')
  async asOf(@Query() query: AsOfQuery) {
    const at = new Date(query.at);
    if (Number.isNaN(at.getTime())) throw new BadRequestException(`at is not a valid instant: ${query.at}`);

    const assets = await this.store.storeAt(at);
    const counts = assets.reduce<Record<string, number>>((acc, a) => {
      acc[a.status] = (acc[a.status] ?? 0) + 1;
      return acc;
    }, {});

    return {
      at,
      // An instant before the store existed is a real answer, not an empty
      // one: every asset reports NOT_YET_IN_STORE (PLAN.md §12 #6).
      total: assets.length,
      counts,
      assets,
    };
  }

  @Get('movements')
  async listMovements(@Query() query: MovementListQuery) {
    const filter: Record<string, unknown> = {};
    if (query.assetId) filter.assetId = this.objectId(query.assetId, 'assetId');
    if (query.workerId) filter.workerId = this.objectId(query.workerId, 'workerId');
    if (query.from || query.to) {
      const range: Record<string, Date> = {};
      if (query.from) range.$gte = new Date(query.from);
      if (query.to) range.$lte = new Date(query.to);
      filter.occurredAt = range;
    }

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 100;

    const [docs, total, workers] = await Promise.all([
      this.movements
        .find(filter)
        .sort({ occurredAt: -1, recordedAt: -1, _id: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean<MovementDoc[]>()
        .exec(),
      this.movements.countDocuments(filter),
      this.store.workerIndex(),
    ]);

    return {
      page,
      pageSize,
      total,
      movements: docs.map((d) => this.store.movementView(toDomainMovement(d), workers)),
    };
  }

  @Get('reservations')
  async listReservations(@Query() query: ReservationListQuery) {
    const filter: Record<string, unknown> = {};
    if (query.assetId) filter.assetId = this.objectId(query.assetId, 'assetId');
    if (query.status) filter.status = query.status;
    if (query.from) filter.endsAt = { $gte: new Date(query.from) };
    if (query.to) filter.startsAt = { $lte: new Date(query.to) };

    const [docs, workers] = await Promise.all([
      this.reservations.find(filter).sort({ startsAt: 1 }).lean<ReservationDoc[]>().exec(),
      this.store.workerIndex(),
    ]);

    const now = new Date();
    return {
      total: docs.length,
      reservations: docs.map((r) => ({
        id: idToString(r._id),
        assetId: idToString(r.assetId),
        worker: workers.get(idToString(r.workerId)) ?? null,
        startsAt: r.startsAt,
        endsAt: r.endsAt,
        status: r.status,
        neverCollected: r.status === 'PENDING' && r.endsAt < now,
        cancelReason: r.cancelReason ?? null,
      })),
    };
  }

  private objectId(value: string, field: string): Types.ObjectId {
    if (!Types.ObjectId.isValid(value)) {
      throw new BadRequestException(`${field} is not a valid id: ${value}`);
    }
    return new Types.ObjectId(value);
  }
}
