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
 * Phase 6's own tests: a wrong worker fixed, a correction of a correction,
 * refusing to correct an old link in a chain directly, and refusing a
 * correction that would put the asset in two hands at once - the exact
 * shape the spec's attack list describes as "correcting a movement that a
 * later movement depends on."
 */
describe('Corrections (e2e)', () => {
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
    const assets = await connection.collection('assets').find({ code: /^CORR-/ }).toArray();
    const assetIds = assets.map((a) => a._id);
    await connection.collection('movements').deleteMany({ assetId: { $in: assetIds } });
    await connection.collection('asset_holdings').deleteMany({ _id: { $in: assetIds } });
    await connection.collection('assets').deleteMany({ code: /^CORR-/ });
    await connection.collection('workers').deleteMany({ employeeNo: /^C/ });
    await connection.collection('keepers').deleteMany({ name: 'Correction Test Keeper' });
    await app.close();
  });

  async function seedFixture() {
    const assetId = new Types.ObjectId();
    const workerIds = Array.from({ length: 4 }, () => new Types.ObjectId());
    const keeperId = new Types.ObjectId();

    await connection.collection('assets').insertOne({
      _id: assetId,
      code: `CORR-${assetId.toString().slice(-6)}`,
      name: 'Test asset',
      kind: 'test',
      requiredCertification: null,
      addedToStoreAt: new Date('2020-01-01T00:00:00Z'),
    });
    await connection.collection('workers').insertMany(
      workerIds.map((id, i) => ({
        _id: id,
        employeeNo: `C${id.toString().slice(-6)}${i}`,
        name: `Correction Worker ${i}`,
        active: true,
        certifications: [],
      })),
    );
    await connection.collection('keepers').insertOne({ _id: keeperId, name: 'Correction Test Keeper' });

    return { assetId, workerIds, keeperId };
  }

  it('fixes the wrong worker picked from the list, and the original stays visible', async () => {
    const { assetId, workerIds, keeperId } = await seedFixture();
    const issued = await request(server())
      .post('/movements/issue')
      .set('Idempotency-Key', randomUUID())
      .send({ assetId: assetId.toString(), workerId: workerIds[0].toString(), keeperId: keeperId.toString() })
      .expect(201);
    const originalMovementId = issued.body.movement.id;

    const corrected = await request(server())
      .post(`/movements/${originalMovementId}/corrections`)
      .set('Idempotency-Key', randomUUID())
      .send({
        keeperId: keeperId.toString(),
        workerId: workerIds[1].toString(),
        correctionReason: 'Wrong name picked from the list',
      })
      .expect(201);

    expect(corrected.body.correction.correctsMovementId).toBe(originalMovementId);
    expect(corrected.body.correction.worker.id).toBe(workerIds[1].toString());
    expect(corrected.body.asset.holder.id).toBe(workerIds[1].toString());

    const history = await request(server())
      .get(`/assets/CORR-${assetId.toString().slice(-6)}/history`)
      .expect(200);
    const original = history.body.timeline.find((m: { id: string }) => m.id === originalMovementId);
    const correction = history.body.timeline.find((m: { id: string }) => m.id === corrected.body.correction.id);
    expect(original.superseded).toBe(true);
    expect(correction.superseded).toBe(false);
  });

  it('allows a correction of a correction, and the chain resolves to the latest', async () => {
    const { assetId, workerIds, keeperId } = await seedFixture();
    const issued = await request(server())
      .post('/movements/issue')
      .set('Idempotency-Key', randomUUID())
      .send({ assetId: assetId.toString(), workerId: workerIds[0].toString(), keeperId: keeperId.toString() })
      .expect(201);

    const first = await request(server())
      .post(`/movements/${issued.body.movement.id}/corrections`)
      .set('Idempotency-Key', randomUUID())
      .send({ keeperId: keeperId.toString(), workerId: workerIds[1].toString(), correctionReason: 'First fix' })
      .expect(201);

    const second = await request(server())
      .post(`/movements/${first.body.correction.id}/corrections`)
      .set('Idempotency-Key', randomUUID())
      .send({ keeperId: keeperId.toString(), workerId: workerIds[2].toString(), correctionReason: 'Second fix' })
      .expect(201);

    expect(second.body.asset.holder.id).toBe(workerIds[2].toString());
  });

  it('refuses to correct a movement that is not the tip of its own chain', async () => {
    const { assetId, workerIds, keeperId } = await seedFixture();
    const issued = await request(server())
      .post('/movements/issue')
      .set('Idempotency-Key', randomUUID())
      .send({ assetId: assetId.toString(), workerId: workerIds[0].toString(), keeperId: keeperId.toString() })
      .expect(201);

    await request(server())
      .post(`/movements/${issued.body.movement.id}/corrections`)
      .set('Idempotency-Key', randomUUID())
      .send({ keeperId: keeperId.toString(), workerId: workerIds[1].toString(), correctionReason: 'First fix' })
      .expect(201);

    // Trying to correct the ORIGINAL again, after it was already corrected.
    const res = await request(server())
      .post(`/movements/${issued.body.movement.id}/corrections`)
      .set('Idempotency-Key', randomUUID())
      .send({ keeperId: keeperId.toString(), workerId: workerIds[3].toString(), correctionReason: 'Second attempt' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('MOVEMENT_ALREADY_CORRECTED');
  });

  it('refuses a correction that would put the asset in two hands at once', async () => {
    const { assetId, workerIds, keeperId } = await seedFixture();
    const first = await request(server())
      .post('/movements/issue')
      .set('Idempotency-Key', randomUUID())
      .send({ assetId: assetId.toString(), workerId: workerIds[0].toString(), keeperId: keeperId.toString() })
      .expect(201);
    await request(server())
      .post('/movements/return')
      .set('Idempotency-Key', randomUUID())
      .send({ assetId: assetId.toString(), keeperId: keeperId.toString(), condition: 'OK' })
      .expect(201);
    const second = await request(server())
      .post('/movements/issue')
      .set('Idempotency-Key', randomUUID())
      .send({ assetId: assetId.toString(), workerId: workerIds[1].toString(), keeperId: keeperId.toString() })
      .expect(201);

    // Correcting the SECOND issue to have occurred before the FIRST issue's
    // return would mean two people held the asset at once.
    const firstIssuedAt = new Date(first.body.movement.occurredAt);
    const res = await request(server())
      .post(`/movements/${second.body.movement.id}/corrections`)
      .set('Idempotency-Key', randomUUID())
      .send({
        keeperId: keeperId.toString(),
        occurredAt: new Date(firstIssuedAt.getTime() + 1).toISOString(),
        correctionReason: 'Backdating attempt that breaks the timeline',
      });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CORRECTION_BREAKS_TIMELINE');
  });

  it('404s correcting a movement that does not exist', async () => {
    const { keeperId } = await seedFixture();
    const res = await request(server())
      .post(`/movements/${new Types.ObjectId().toString()}/corrections`)
      .set('Idempotency-Key', randomUUID())
      .send({ keeperId: keeperId.toString(), correctionReason: 'Does not matter' });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('MOVEMENT_NOT_FOUND');
  });

  it('replaying the same Idempotency-Key on a correction never creates a second one', async () => {
    const { assetId, workerIds, keeperId } = await seedFixture();
    const issued = await request(server())
      .post('/movements/issue')
      .set('Idempotency-Key', randomUUID())
      .send({ assetId: assetId.toString(), workerId: workerIds[0].toString(), keeperId: keeperId.toString() })
      .expect(201);

    const key = randomUUID();
    const payload = { keeperId: keeperId.toString(), workerId: workerIds[1].toString(), correctionReason: 'Fix' };
    await request(server())
      .post(`/movements/${issued.body.movement.id}/corrections`)
      .set('Idempotency-Key', key)
      .send(payload)
      .expect(201);
    const replay = await request(server())
      .post(`/movements/${issued.body.movement.id}/corrections`)
      .set('Idempotency-Key', key)
      .send(payload);

    expect(replay.status).toBe(201);
    expect(replay.headers['idempotent-replay']).toBe('true');

    const count = await connection
      .collection('movements')
      .countDocuments({ assetId, correctsMovementId: new Types.ObjectId(issued.body.movement.id) });
    expect(count).toBe(1);
  });
});
