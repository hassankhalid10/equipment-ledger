import { NestFactory } from '@nestjs/core';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { AppModule } from '../app.module.js';
import { runInvariantChecks } from './check-invariants-core.js';
import type { CheckResult, RawHolding, RawMovement, RawWithAsset } from './check-invariants-core.js';
import type { AssetDoc, MovementDoc, ReservationDoc } from '../persistence/mappers.js';

/**
 * `npm run check:invariants`
 *
 * Reads MongoDB directly, not through the API - the whole point is to prove
 * the screens agree with the store rather than trusting that they do. The
 * seven checks themselves live in check-invariants-core.ts as a pure
 * function, unit-tested with no database; this file is the thin wrapper that
 * reads the real collections and prints the result. Exits non-zero on any
 * failure, so this is a command a CI step or an assessor can run without
 * reading the output closely.
 */
async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const connection = app.get<Connection>(getConnectionToken());

  try {
    const [assetDocs, movementDocs, reservationDocs, holdingDocs] = await Promise.all([
      connection.collection<AssetDoc>('assets').find().toArray(),
      connection.collection<MovementDoc & RawMovement>('movements').find().toArray(),
      connection.collection<ReservationDoc & RawWithAsset>('reservations').find().toArray(),
      connection.collection<RawHolding>('asset_holdings').find().toArray(),
    ]);

    const results = runInvariantChecks({
      assets: assetDocs,
      movements: movementDocs,
      reservations: reservationDocs,
      holdings: holdingDocs,
    });

    report(results);
    if (results.some((r) => !r.pass)) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

function report(results: CheckResult[]): void {
  console.log('\nInvariant check\n');
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`);
    for (const f of r.failures.slice(0, 20)) console.log(`      - ${f}`);
    if (r.failures.length > 20) console.log(`      ... and ${r.failures.length - 20} more`);
    for (const i of r.info ?? []) console.log(`      i ${i}`);
  }
  const failed = results.filter((r) => !r.pass).length;
  console.log(failed === 0 ? '\nAll invariants hold.\n' : `\n${failed} invariant(s) failed.\n`);
}

await main();
