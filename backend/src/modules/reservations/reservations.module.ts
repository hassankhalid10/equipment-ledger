import { Module } from '@nestjs/common';
import { AssetLockService } from '../../common/locking/asset-lock.service.js';
import { ClaimReplayService } from '../../common/write-path/claim-replay.service.js';
import { IdempotencyService } from '../../common/idempotency/idempotency.service.js';
import { PersistenceModule } from '../../persistence/persistence.module.js';
import { ReservationsController } from './reservations.controller.js';
import { ReservationsService } from './reservations.service.js';
import { ServiceStatusController } from './service-status.controller.js';
import { ServiceStatusService } from './service-status.service.js';

/**
 * Reservations and service status share this module because Phase 5
 * grouped them for the same reason PLAN.md does: both are asset-lifecycle
 * writes built on the same lease and idempotency primitives as Phase 4,
 * without the claim/intent machinery issue/return needed (§7's guard is
 * about who *holds* an asset; neither of these changes that).
 */
@Module({
  imports: [PersistenceModule],
  controllers: [ReservationsController, ServiceStatusController],
  providers: [ReservationsService, ServiceStatusService, AssetLockService, ClaimReplayService, IdempotencyService],
})
export class ReservationsModule {}
