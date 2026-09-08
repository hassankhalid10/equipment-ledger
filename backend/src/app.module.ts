import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { HealthModule } from './modules/health/health.module.js';
import { LedgerModule } from './modules/ledger/ledger.module.js';
import { MovementsModule } from './modules/movements/movements.module.js';
import { ReservationsModule } from './modules/reservations/reservations.module.js';
import { PersistenceModule } from './persistence/persistence.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.getOrThrow<string>('MONGODB_URI'),
        // Fail fast at boot rather than buffering commands for 30s and
        // timing out one by one if MongoDB is not running.
        serverSelectionTimeoutMS: 3000,
        // Indexes are built at boot. At this size that costs milliseconds,
        // and it means the unique key the one-holder guard depends on can
        // never be missing from a fresh clone. A large deployment would
        // build them out of band instead.
        autoIndex: true,
      }),
    }),
    PersistenceModule,
    HealthModule,
    LedgerModule,
    MovementsModule,
    ReservationsModule,
  ],
})
export class AppModule {}
