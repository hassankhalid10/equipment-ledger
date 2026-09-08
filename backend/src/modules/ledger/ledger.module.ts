import { Module } from '@nestjs/common';
import { PersistenceModule } from '../../persistence/persistence.module.js';
import { LedgerController } from './ledger.controller.js';
import { PeopleController } from './people.controller.js';
import { StoreReaderService } from './store-reader.service.js';

/**
 * Every read endpoint. They share one StoreReaderService because they all
 * answer the same question - what does the ledger say - at different
 * granularities.
 */
@Module({
  imports: [PersistenceModule],
  controllers: [LedgerController, PeopleController],
  providers: [StoreReaderService],
  exports: [StoreReaderService],
})
export class LedgerModule {}
