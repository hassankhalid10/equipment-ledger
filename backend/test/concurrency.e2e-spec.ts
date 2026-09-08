import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import type { Connection } from 'mongoose';
import { AppModule } from './../src/app.module.js';
import { DomainExceptionFilter } from './../src/common/errors/domain-exception.filter.js';

/**
 * The headline test (PLAN.md §11): fire many simultaneous issues at one
 * asset and prove exactly one wins. This is the whole point of the design in
 * §7 - the per-asset lease plus the unique holding key - working on a plain
 * standalone MongoDB with no transaction involved.
 */
describe('Concurrency (e2e)', () => {
  let app: INestApplication;
  let connection: Connection;
  const server = () => app.getHttpServer();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new DomainExceptionFilter());
    await app.init();
    connection = app.get<Connection>(getConnectionToken());
  });

  afterAll(async () => {
    // Fixtures are tagged with a CONC- code so a run leaves the test
    // database as it found it rather than growing forever.
    const assets = await connection.collection('assets').find({ code: /^CONC-/ }).toArray();
    const assetIds = assets.map((a) => a._id);
    await connection.collection('movements').deleteMany({ assetId: { $in: assetIds } });
    await connection.collection('asset_holdings').deleteMany({ _id: { $in: assetIds } });
    await connection.collection('assets').deleteMany({ code: /^CONC-/ });
    await connection.collection('workers').deleteMany({ employeeNo: /^T/ });
    await connection.collection('keepers').deleteMany({ name: 'Test Keeper' });
    await app.close();
  });

  async function seedFixture() {
    const assetId = new Types.ObjectId();
    const workerIds = Array.from({ length: 12 }, () => new Types.ObjectId());
    const keeperId = new Types.ObjectId();

    await connection.collection('assets').insertOne({
      _id: assetId,
      code: `CONC-${assetId.toString().slice(-6)}`,
      name: 'Test asset',
      kind: 'test',
      requiredCertification: null,
      addedToStoreAt: new Date('2020-01-01T00:00:00Z'),
    });
    await connection.collection('workers').insertMany(
      workerIds.map((id, i) => ({
        _id: id,
        employeeNo: `T${id.toString().slice(-6)}${i}`,
        name: `Test Worker ${i}`,
        active: true,
        certifications: [],
      })),
    );
    await connection.collection('keepers').insertOne({ _id: keeperId, name: 'Test Keeper' });

    return { assetId, workerIds, keeperId };
  }

  it('lets exactly one of ten simultaneous issues win, with nine 409s', async () => {
    const { assetId, workerIds, keeperId } = await seedFixture();

    const responses = await Promise.all(
      workerIds.slice(0, 10).map((workerId) =>
        request(server())
          .post('/movements/issue')
          .set('Idempotency-Key', randomUUID())
          .send({ assetId: assetId.toString(), workerId: workerId.toString(), keeperId: keeperId.toString() }),
      ),
    );

    const created = responses.filter((r) => r.status === 201);
    const refused = responses.filter((r) => r.status === 409);

    expect(created).toHaveLength(1);
    expect(refused).toHaveLength(9);
    expect(refused.every((r) => r.body.error.code === 'ASSET_ALREADY_HELD' || r.body.error.code === 'ASSET_BUSY')).toBe(
      true,
    );

    // The ledger agrees: exactly one ISSUE movement for this asset, and the
    // guard shows exactly one holder - not "the API said 201 once" but "the
    // database actually contains one movement, checked directly."
    const movementCount = await connection
      .collection('movements')
      .countDocuments({ assetId, type: 'ISSUE' });
    expect(movementCount).toBe(1);

    const holding = await connection.collection('asset_holdings').findOne({ _id: assetId });
    expect(holding?.state).toBe('ACTIVE');
    expect(holding?.workerId.toString()).toBe(created[0].body.movement.worker.id);
  });

  it('replaying the same Idempotency-Key never creates a second movement', async () => {
    const { assetId, workerIds, keeperId } = await seedFixture();
    const key = randomUUID();
    const payload = { assetId: assetId.toString(), workerId: workerIds[0].toString(), keeperId: keeperId.toString() };

    const [first, second, third] = await Promise.all([
      request(server()).post('/movements/issue').set('Idempotency-Key', key).send(payload),
      request(server()).post('/movements/issue').set('Idempotency-Key', key).send(payload),
      request(server()).post('/movements/issue').set('Idempotency-Key', key).send(payload),
    ]);

    // Every response under the same key must describe the same outcome.
    const statuses = [first, second, third].map((r) => r.status);
    expect(new Set(statuses).size).toBeLessThanOrEqual(2); // 201 and/or 409(ASSET_BUSY) while in flight

    const movementCount = await connection
      .collection('movements')
      .countDocuments({ assetId, type: 'ISSUE' });
    expect(movementCount).toBe(1);
  });

  it('rejects a write with no Idempotency-Key header with 428', async () => {
    const { assetId, workerIds, keeperId } = await seedFixture();
    const res = await request(server())
      .post('/movements/issue')
      .send({ assetId: assetId.toString(), workerId: workerIds[0].toString(), keeperId: keeperId.toString() });

    expect(res.status).toBe(428);
    expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('issue then return then re-issue: the ordinary path stays correct under the same machinery', async () => {
    const { assetId, workerIds, keeperId } = await seedFixture();
    const [a, b] = workerIds;

    const issued = await request(server())
      .post('/movements/issue')
      .set('Idempotency-Key', randomUUID())
      .send({ assetId: assetId.toString(), workerId: a.toString(), keeperId: keeperId.toString() })
      .expect(201);
    expect(issued.body.asset.status).toBe('ISSUED');

    await request(server())
      .post('/movements/return')
      .set('Idempotency-Key', randomUUID())
      .send({ assetId: assetId.toString(), keeperId: keeperId.toString(), condition: 'OK' })
      .expect(201);

    const reissued = await request(server())
      .post('/movements/issue')
      .set('Idempotency-Key', randomUUID())
      .send({ assetId: assetId.toString(), workerId: b.toString(), keeperId: keeperId.toString() })
      .expect(201);
    expect(reissued.body.movement.worker.id).toBe(b.toString());
  });

  it('a damaged return writes RETURN and OUT_OF_SERVICE together, and blocks a re-issue', async () => {
    const { assetId, workerIds, keeperId } = await seedFixture();

    await request(server())
      .post('/movements/issue')
      .set('Idempotency-Key', randomUUID())
      .send({ assetId: assetId.toString(), workerId: workerIds[0].toString(), keeperId: keeperId.toString() })
      .expect(201);

    const returned = await request(server())
      .post('/movements/return')
      .set('Idempotency-Key', randomUUID())
      .send({ assetId: assetId.toString(), keeperId: keeperId.toString(), condition: 'DAMAGED', note: 'Cracked' })
      .expect(201);
    expect(returned.body.asset.status).toBe('OUT_OF_SERVICE');

    const types = await connection
      .collection('movements')
      .find({ assetId })
      .project({ type: 1 })
      .toArray();
    expect(types.map((t) => t.type).sort()).toEqual(['ISSUE', 'OUT_OF_SERVICE', 'RETURN']);

    const blocked = await request(server())
      .post('/movements/issue')
      .set('Idempotency-Key', randomUUID())
      .send({ assetId: assetId.toString(), workerId: workerIds[1].toString(), keeperId: keeperId.toString() });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('ASSET_OUT_OF_SERVICE');
  });

  it('returning an asset nobody holds is refused with a readable reason', async () => {
    const { assetId, keeperId } = await seedFixture();
    const res = await request(server())
      .post('/movements/return')
      .set('Idempotency-Key', randomUUID())
      .send({ assetId: assetId.toString(), keeperId: keeperId.toString(), condition: 'OK' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ASSET_NOT_HELD');
  });

  it('a return may come from someone other than the holder, and records both (FR-4)', async () => {
    const { assetId, workerIds, keeperId } = await seedFixture();
    const [holder, returner] = workerIds;

    await request(server())
      .post('/movements/issue')
      .set('Idempotency-Key', randomUUID())
      .send({ assetId: assetId.toString(), workerId: holder.toString(), keeperId: keeperId.toString() })
      .expect(201);

    const res = await request(server())
      .post('/movements/return')
      .set('Idempotency-Key', randomUUID())
      .send({
        assetId: assetId.toString(),
        keeperId: keeperId.toString(),
        returnedByWorkerId: returner.toString(),
        condition: 'OK',
      })
      .expect(201);

    expect(res.body.movement.returnedBy.id).toBe(returner.toString());
  });
});
