import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Asset, AssetSchema } from './schemas/asset.schema.js';
import { AssetHolding, AssetHoldingSchema } from './schemas/asset-holding.schema.js';
import { AssetLock, AssetLockSchema } from './schemas/asset-lock.schema.js';
import { IdempotencyKey, IdempotencyKeySchema } from './schemas/idempotency-key.schema.js';
import { Keeper, KeeperSchema } from './schemas/keeper.schema.js';
import { Movement, MovementSchema } from './schemas/movement.schema.js';
import { Reservation, ReservationSchema } from './schemas/reservation.schema.js';
import { Worker, WorkerSchema } from './schemas/worker.schema.js';

const models = MongooseModule.forFeature([
  { name: Asset.name, schema: AssetSchema },
  { name: Worker.name, schema: WorkerSchema },
  { name: Keeper.name, schema: KeeperSchema },
  { name: Movement.name, schema: MovementSchema },
  { name: Reservation.name, schema: ReservationSchema },
  { name: AssetHolding.name, schema: AssetHoldingSchema },
  { name: AssetLock.name, schema: AssetLockSchema },
  { name: IdempotencyKey.name, schema: IdempotencyKeySchema },
]);

/**
 * Every model in one place, re-exported so feature modules import this rather
 * than repeating the forFeature list.
 */
@Module({
  imports: [models],
  exports: [models],
})
export class PersistenceModule {}
