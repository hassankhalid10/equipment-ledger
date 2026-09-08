import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Connection } from 'mongoose';
import { AppModule } from './../src/app.module.js';

/**
 * Proves the indexes the design leans on actually exist in MongoDB, rather
 * than only in the schema files. The one-holder guard in particular is worth
 * nothing if its unique key is missing, so the last test does not inspect
 * metadata - it tries the double insert and expects MongoDB to refuse it.
 */
describe('Indexes (e2e)', () => {
  let app: INestApplication;
  let connection: Connection;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    connection = app.get<Connection>(getConnectionToken());
  });

  afterAll(async () => {
    await app.close();
  });

  const keysOf = async (collection: string) => {
    const indexes = await connection.collection(collection).indexes();
    return indexes.map((i) => JSON.stringify(i.key));
  };

  it('indexes the ledger for the per-asset fold and the ledger view', async () => {
    const keys = await keysOf('movements');
    expect(keys).toContain('{"assetId":1,"occurredAt":1}');
    expect(keys).toContain('{"occurredAt":-1}');
    expect(keys).toContain('{"recordedAt":-1}');
    expect(keys).toContain('{"correctsMovementId":1}');
  });

  it('enforces the unique business keys', async () => {
    const assetIndexes = await connection.collection('assets').indexes();
    expect(assetIndexes.find((i) => JSON.stringify(i.key) === '{"code":1}')?.unique).toBe(true);

    const workerIndexes = await connection.collection('workers').indexes();
    expect(workerIndexes.find((i) => JSON.stringify(i.key) === '{"employeeNo":1}')?.unique).toBe(true);
  });

  it('indexes reservations for the overlap check', async () => {
    const keys = await keysOf('reservations');
    expect(keys).toContain('{"assetId":1,"startsAt":1}');
    expect(keys).toContain('{"assetId":1,"status":1,"endsAt":1}');
  });

  it('expires leases and idempotency keys on their own', async () => {
    const locks = await connection.collection('asset_locks').indexes();
    expect(locks.find((i) => JSON.stringify(i.key) === '{"expiresAt":1}')?.expireAfterSeconds).toBe(0);

    const keys = await connection.collection('idempotency_keys').indexes();
    expect(keys.find((i) => JSON.stringify(i.key) === '{"createdAt":1}')?.expireAfterSeconds).toBe(86400);
  });

  it('refuses a second holding for the same asset', async () => {
    const assetId = new Types.ObjectId();
    const holdings = connection.collection('asset_holdings');
    const holding = {
      _id: assetId,
      state: 'ACTIVE',
      workerId: new Types.ObjectId(),
      issueMovementId: new Types.ObjectId(),
      since: new Date(),
      claimedAt: new Date(),
    };

    try {
      await holdings.insertOne(holding);

      // The whole one-holder guarantee, in one assertion: the storage engine
      // refuses the second holder, not application code.
      await expect(
        holdings.insertOne({ ...holding, workerId: new Types.ObjectId() }),
      ).rejects.toMatchObject({ code: 11000 });
    } finally {
      await holdings.deleteOne({ _id: assetId });
    }
  });
});
