import { Module } from '@nestjs/common';
import { AssetLockService } from '../../common/locking/asset-lock.service.js';
import { ClaimReplayService } from '../../common/write-path/claim-replay.service.js';
import { IdempotencyService } from '../../common/idempotency/idempotency.service.js';
import { PersistenceModule } from '../../persistence/persistence.module.js';
import { LedgerModule } from '../ledger/ledger.module.js';
import { CorrectionsService } from './corrections.service.js';
import { MovementsController } from './movements.controller.js';
import { MovementsService } from './movements.service.js';

@Module({
  imports: [PersistenceModule, LedgerModule],
  controllers: [MovementsController],
  providers: [MovementsService, CorrectionsService, AssetLockService, ClaimReplayService, IdempotencyService],
  exports: [AssetLockService, ClaimReplayService, IdempotencyService],
})
export class MovementsModule {}
