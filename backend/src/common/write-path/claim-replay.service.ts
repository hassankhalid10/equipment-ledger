import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Collection, Model, Types } from 'mongoose';
import { AssetHolding } from '../../persistence/schemas/asset-holding.schema.js';
import { Movement } from '../../persistence/schemas/movement.schema.js';
import { Reservation } from '../../persistence/schemas/reservation.schema.js';

interface HoldingIntentRaw {
  movementIds: Types.ObjectId[];
  movements: Record<string, unknown>[];
  collectReservationId: Types.ObjectId | null;
}

interface HoldingRaw {
  _id: Types.ObjectId;
  state: 'PENDING' | 'ACTIVE' | 'RELEASING';
  intent: HoldingIntentRaw | null;
}

/**
 * Settles whatever a claim left behind. This is the piece that exists only
 * because there are no transactions (PLAN.md §7): a process killed between
 * writing the claim and writing its movements leaves the guard in PENDING or
 * RELEASING. The claim carries the exact documents to insert, with ids
 * generated before either write happened, so replaying it is deterministic -
 * inserting a movement whose `_id` already exists is a no-op, not a twin.
 *
 * Every write calls this on its own asset before doing anything else, so a
 * half-finished write from a crashed process is cleaned up by the very next
 * request rather than left to rot. `npm run reconcile` runs the same logic
 * across every asset on demand.
 */
@Injectable()
export class ClaimReplayService {
  private readonly holdings: Collection<HoldingRaw>;
  private readonly movements: Collection<Record<string, unknown>>;
  private readonly reservations: Collection<{
    _id: Types.ObjectId;
    status: string;
    collectedMovementId: Types.ObjectId | null;
  }>;

  constructor(
    @InjectModel(AssetHolding.name) holdings: Model<AssetHolding>,
    @InjectModel(Movement.name) movements: Model<Movement>,
    @InjectModel(Reservation.name) reservations: Model<Reservation>,
  ) {
    this.holdings = holdings.collection as unknown as Collection<HoldingRaw>;
    this.movements = movements.collection as unknown as Collection<Record<string, unknown>>;
    this.reservations = reservations.collection as unknown as Collection<{
      _id: Types.ObjectId;
      status: string;
      collectedMovementId: Types.ObjectId | null;
    }>;
  }

  /** Settles the asset's claim if it is mid-flight. A no-op if it is not. */
  async replayIfUnsettled(assetId: Types.ObjectId): Promise<void> {
    const holding = await this.holdings.findOne({ _id: assetId });
    if (!holding || holding.state === 'ACTIVE' || !holding.intent) return;
    await this.applyAndSettle(holding);
  }

  /** Every claim not in its settled state, across the whole store. */
  async allUnsettled(): Promise<HoldingRaw[]> {
    return this.holdings.find({ state: { $in: ['PENDING', 'RELEASING'] } }).toArray();
  }

  async settle(holding: HoldingRaw): Promise<void> {
    if (!holding.intent) return;
    await this.applyAndSettle(holding);
  }

  private async applyAndSettle(holding: HoldingRaw): Promise<void> {
    const intent = holding.intent!;

    for (const movement of intent.movements) {
      try {
        await this.movements.insertOne(movement as never);
      } catch (err) {
        if (!isDuplicateKey(err)) throw err;
        // Already inserted by an earlier attempt at this same replay - the
        // whole point of pre-generated ids.
      }
    }

    if (intent.collectReservationId) {
      await this.reservations.updateOne(
        { _id: intent.collectReservationId, status: 'PENDING' },
        { $set: { status: 'COLLECTED', collectedMovementId: intent.movementIds[0] } },
      );
    }

    if (holding.state === 'PENDING') {
      await this.holdings.updateOne({ _id: holding._id }, { $set: { state: 'ACTIVE', intent: null } });
    } else {
      await this.holdings.deleteOne({ _id: holding._id });
    }
  }
}

function isDuplicateKey(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}
