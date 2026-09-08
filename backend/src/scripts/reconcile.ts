import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { ClaimReplayService } from '../common/write-path/claim-replay.service.js';

/**
 * `npm run reconcile`
 *
 * Sweeps every asset for a claim still PENDING or RELEASING - a write
 * interrupted between taking the claim and writing its movement(s), the one
 * gap the no-transaction write path leaves (PLAN.md §7) - and settles each
 * one with the exact logic every ordinary request already runs on its own
 * asset before doing anything else. Nothing here is special-cased: this
 * script just calls the same ClaimReplayService the write paths use,
 * across the whole store instead of one asset.
 *
 * Safe to run at any time, including when nothing is unsettled - it does
 * nothing and says so.
 */
async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });

  try {
    const claims = app.get(ClaimReplayService);
    const unsettled = await claims.allUnsettled();

    if (unsettled.length === 0) {
      console.log('Nothing to reconcile: no unsettled claims.');
      return;
    }

    console.log(`Found ${unsettled.length} unsettled claim(s):`);
    for (const holding of unsettled) {
      console.log(`  asset ${holding._id.toString()}: ${holding.state}`);
      await claims.settle(holding);
      console.log('    -> settled');
    }
    console.log('\nDone.');
  } finally {
    await app.close();
  }
}

await main();
