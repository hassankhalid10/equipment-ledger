import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { StoreReaderService } from './store-reader.service.js';
import { WorkerListQuery } from './dto/query.dto.js';
import { idToString } from '../../persistence/mappers.js';
import { Keeper } from '../../persistence/schemas/keeper.schema.js';
import { Worker } from '../../persistence/schemas/worker.schema.js';

interface WorkerDoc {
  _id: Types.ObjectId;
  employeeNo: string;
  name: string;
  active: boolean;
  certifications: { code: string; issuedAt: Date; expiresAt: Date }[];
}

@Controller()
export class PeopleController {
  constructor(
    private readonly store: StoreReaderService,
    @InjectModel(Worker.name) private readonly workers: Model<Worker>,
    @InjectModel(Keeper.name) private readonly keepers: Model<Keeper>,
  ) {}

  @Get('workers')
  async listWorkers(@Query() query: WorkerListQuery) {
    const filter = query.q
      ? {
          $or: [
            { name: { $regex: escapeRegex(query.q), $options: 'i' } },
            { employeeNo: { $regex: escapeRegex(query.q), $options: 'i' } },
          ],
        }
      : {};

    const [docs, store] = await Promise.all([
      this.workers.find(filter).sort({ name: 1 }).lean<WorkerDoc[]>().exec(),
      this.store.storeAt(),
    ]);

    return {
      total: docs.length,
      workers: docs.map((doc) => this.workerView(doc, store)),
    };
  }

  @Get('workers/:id')
  async worker(@Param('id') id: string) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException(`No worker with id ${id}.`);

    const [doc, store] = await Promise.all([
      this.workers.findById(id).lean<WorkerDoc | null>().exec(),
      this.store.storeAt(),
    ]);
    if (!doc) throw new NotFoundException(`No worker with id ${id}.`);

    return this.workerView(doc, store);
  }

  /** The pick-a-name list. Not authentication - the spec forbids that (PLAN.md §9). */
  @Get('keepers')
  async listKeepers() {
    const docs = await this.keepers.find().sort({ name: 1 }).lean().exec();
    return { keepers: docs.map((k) => ({ id: idToString(k._id), name: k.name })) };
  }

  private workerView(doc: WorkerDoc, store: Awaited<ReturnType<StoreReaderService['storeAt']>>) {
    const id = idToString(doc._id);
    const now = new Date();
    const soon = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    return {
      id,
      employeeNo: doc.employeeNo,
      name: doc.name,
      active: doc.active,
      certifications: doc.certifications.map((c) => ({
        code: c.code,
        issuedAt: c.issuedAt,
        expiresAt: c.expiresAt,
        // Derived on read rather than stored, so nothing has to age a flag.
        expired: c.expiresAt < now,
        expiringSoon: c.expiresAt >= now && c.expiresAt <= soon,
      })),
      // A worker may hold several assets at once: the spec constrains one
      // holder per asset, not one asset per holder (PLAN.md judgement #11).
      holding: store
        .filter((a) => a.holder?.id === id)
        .map((a) => ({
          code: a.code,
          name: a.name,
          since: a.holder!.since,
          dueAt: a.holder!.dueAt,
          overdue: a.status === 'OVERDUE',
        })),
    };
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
