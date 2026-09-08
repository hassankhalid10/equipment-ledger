import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHash } from 'node:crypto';
import type { Collection, Model } from 'mongoose';
import { conflict } from '../errors/domain-error.js';
import { IdempotencyKey } from '../../persistence/schemas/idempotency-key.schema.js';

export interface ReplayedResponse {
  status: number;
  body: Record<string, unknown>;
}

export function hashRequestBody(body: unknown): string {
  return createHash('sha256').update(JSON.stringify(body ?? null)).digest('hex');
}

/** The raw document shape. `_id` is the key string, which the Mongoose-typed
 * driver collection (ObjectId by default) does not know about. */
interface IdempotencyKeyRaw {
  _id: string;
  route: string;
  requestHash: string;
  state: 'IN_FLIGHT' | 'COMPLETED';
  responseStatus: number | null;
  responseBody: Record<string, unknown> | null;
  createdAt: Date;
}

/**
 * Makes "nothing lands twice" a property of the primary key rather than
 * something application code has to remember to check (FR-19). `_id` is the
 * client's Idempotency-Key, so two requests racing on the same key collide
 * on insert - one proceeds, the other is told to wait and then replay.
 */
@Injectable()
export class IdempotencyService {
  private readonly raw: Collection<IdempotencyKeyRaw>;

  constructor(@InjectModel(IdempotencyKey.name) keys: Model<IdempotencyKey>) {
    this.raw = keys.collection as unknown as Collection<IdempotencyKeyRaw>;
  }

  /**
   * Starts a request under `key`, or returns the previous result if this
   * exact request already ran. Throws if the same key arrives with a
   * different payload - reusing a key for a different request is a client
   * bug worth reporting, not a request worth silently answering with
   * someone else's result.
   */
  async begin(key: string, route: string, requestHash: string): Promise<ReplayedResponse | null> {
    const now = new Date();
    try {
      await this.raw.insertOne({
        _id: key,
        route,
        requestHash,
        state: 'IN_FLIGHT',
        responseStatus: null,
        responseBody: null,
        createdAt: now,
      });
      return null;
    } catch (err) {
      if (!isDuplicateKey(err)) throw err;
    }

    const existing = await this.raw.findOne({ _id: key });
    if (!existing) {
      // Deleted by its own TTL between the failed insert and this read.
      // Vanishingly unlikely at a 24h TTL; treated as a fresh request.
      return null;
    }

    if (existing.requestHash !== requestHash) {
      throw new BadRequestException(
        `Idempotency-Key ${key} was already used for a different request. Use a new key for a new request.`,
      );
    }

    if (existing.state === 'COMPLETED') {
      return { status: existing.responseStatus!, body: existing.responseBody! };
    }

    // Someone else is mid-write under this exact key right now (a genuine
    // double-click, not a retry after a timeout). The client's own submit
    // button should already be disabled; this is the server-side backstop.
    throw conflict(
      'ASSET_BUSY',
      'This request is already being processed. Wait a moment before retrying.',
    );
  }

  async complete(key: string, status: number, body: Record<string, unknown>): Promise<void> {
    await this.raw.updateOne(
      { _id: key },
      { $set: { state: 'COMPLETED', responseStatus: status, responseBody: body } },
    );
  }
}

function isDuplicateKey(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}
