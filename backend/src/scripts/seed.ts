import { NestFactory } from '@nestjs/core';
import { getConnectionToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Connection } from 'mongoose';
import { AppModule } from '../app.module.js';
import { buildSeed } from './seed-data.js';

/**
 * `npm run seed`
 *
 * Booting the Nest app rather than opening a bare connection means the seed
 * writes through the same schemas and index definitions as the API, so there
 * is exactly one place where either is declared.
 *
 * Re-running replaces the store rather than adding to it: every id is derived
 * from the document's natural key, so a second run overwrites the same
 * documents. The collections are cleared first as well, so a store seeded
 * from an older version of this file cannot leave orphans behind (FR-25).
 *
 * The anchor defaults to today so the demo data always looks live. Pass
 * SEED_ANCHOR=2026-09-08 to pin it, which is how the determinism test gets a
 * byte-identical store on every run.
 */

const COLLECTIONS = [
  'assets',
  'workers',
  'keepers',
  'movements',
  'reservations',
  'asset_holdings',
  'asset_locks',
  'idempotency_keys',
];

/** The generator deals in hex strings; MongoDB wants ObjectIds. */
function toObjectIds(doc: object): Record<string, unknown> {
  const idFields = [
    '_id',
    'assetId',
    'workerId',
    'keeperId',
    'returnedByWorkerId',
    'reservationId',
    'correctsMovementId',
    'collectedMovementId',
    'issueMovementId',
  ];
  const out: Record<string, unknown> = { ...doc };
  for (const field of idFields) {
    const value = out[field];
    if (typeof value === 'string' && Types.ObjectId.isValid(value)) {
      out[field] = new Types.ObjectId(value);
    }
  }
  return out;
}

async function main() {
  const anchor = process.env.SEED_ANCHOR ? new Date(process.env.SEED_ANCHOR) : new Date();
  if (Number.isNaN(anchor.getTime())) {
    throw new Error(`SEED_ANCHOR is not a valid date: ${process.env.SEED_ANCHOR}`);
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const connection = app.get<Connection>(getConnectionToken());

  try {
    const store = buildSeed(anchor);

    for (const name of COLLECTIONS) {
      await connection.collection(name).deleteMany({});
    }

    await connection.collection('assets').insertMany(store.assets.map(toObjectIds));
    await connection.collection('workers').insertMany(store.workers.map(toObjectIds));
    await connection.collection('keepers').insertMany(store.keepers.map(toObjectIds));
    await connection.collection('movements').insertMany(store.movements.map(toObjectIds));
    await connection.collection('reservations').insertMany(store.reservations.map(toObjectIds));
    if (store.holdings.length > 0) {
      await connection.collection('asset_holdings').insertMany(store.holdings.map(toObjectIds));
    }

    report(store);
  } finally {
    await app.close();
  }
}

function report(store: ReturnType<typeof buildSeed>) {
  const overdue = store.holdings.filter((h) => h.dueAt && h.dueAt < store.anchor).length;
  const corrections = store.movements.filter((m) => m.correctsMovementId).length;
  const lateLogged = store.movements.filter(
    (m) => m.recordedAt.getTime() - m.occurredAt.getTime() > 60 * 60 * 1000,
  ).length;
  const neverCollected = store.reservations.filter(
    (r) => r.status === 'PENDING' && r.endsAt < store.anchor,
  ).length;

  const lines = [
    ['anchor', store.anchor.toISOString().slice(0, 10)],
    ['assets', store.assets.length],
    ['workers', store.workers.length],
    ['keepers', store.keepers.length],
    ['movements', store.movements.length],
    ['reservations', store.reservations.length],
    ['still out', store.holdings.length],
    ['of those, overdue', overdue],
    ['corrections', corrections],
    ['late-logged entries', lateLogged],
    ['reservations never collected', neverCollected],
  ];

  console.log('\nSeeded the store:\n');
  for (const [label, value] of lines) {
    console.log(`  ${String(label).padEnd(30)} ${value}`);
  }
  console.log('\nRe-run to get the same store, not a doubled one.\n');
}

await main();
