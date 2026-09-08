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
 * Phase 5's own edge cases, several straight off the spec's attack list
 * (PLAN.md §5): reserve in the past, an inverted window, a year-long span,
 * an overlap that shares even a minute versus one that only touches an
 * edge, out-of-service while reserved and while issued, and the standing
 * reservation that gets cancelled with a reason rather than silently
 * failing later.
 */
describe('Reservations and service status (e2e)', () => {
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
    const assets = await connection.collection('assets').find({ code: /^RES-/ }).toArray();
    const assetIds = assets.map((a) => a._id);
    await connection.collection('movements').deleteMany({ assetId: { $in: assetIds } });
    await connection.collection('reservations').deleteMany({ assetId: { $in: assetIds } });
    await connection.collection('asset_holdings').deleteMany({ _id: { $in: assetIds } });
    await connection.collection('assets').deleteMany({ code: /^RES-/ });
    await connection.collection('workers').deleteMany({ employeeNo: /^R/ });
    await connection.collection('keepers').deleteMany({ name: 'Reservation Test Keeper' });
    await app.close();
  });

  async function seedFixture() {
    const assetId = new Types.ObjectId();
    const workerIds = Array.from({ length: 4 }, () => new Types.ObjectId());
    const keeperId = new Types.ObjectId();

    await connection.collection('assets').insertOne({
      _id: assetId,
      code: `RES-${assetId.toString().slice(-6)}`,
      name: 'Test asset',
      kind: 'test',
      requiredCertification: null,
      addedToStoreAt: new Date('2020-01-01T00:00:00Z'),
    });
    await connection.collection('workers').insertMany(
      workerIds.map((id, i) => ({
        _id: id,
        employeeNo: `R${id.toString().slice(-6)}${i}`,
        name: `Reservation Worker ${i}`,
        active: true,
        certifications: [],
      })),
    );
    await connection.collection('keepers').insertOne({ _id: keeperId, name: 'Reservation Test Keeper' });

    return { assetId, workerIds, keeperId };
  }

  function inDays(days: number, hour = 10): string {
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10) + `T${String(hour).padStart(2, '0')}:00:00Z`;
  }

  it('reserves a future window (FR-6)', async () => {
    const { assetId, workerIds, keeperId } = await seedFixture();
    const res = await request(server())
      .post('/reservations')
      .set('Idempotency-Key', randomUUID())
      .send({
        assetId: assetId.toString(),
        workerId: workerIds[0].toString(),
        keeperId: keeperId.toString(),
        startsAt: inDays(2, 9),
        endsAt: inDays(2, 17),
      });

    expect(res.status).toBe(201);
    expect(res.body.reservation.status).toBe('PENDING');
  });

  it('refuses a reservation starting in the past', async () => {
    const { assetId, workerIds, keeperId } = await seedFixture();
    const res = await request(server())
      .post('/reservations')
      .set('Idempotency-Key', randomUUID())
      .send({
        assetId: assetId.toString(),
        workerId: workerIds[0].toString(),
        keeperId: keeperId.toString(),
        startsAt: '2020-01-01T09:00:00Z',
        endsAt: '2020-01-01T17:00:00Z',
      });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('RESERVATION_IN_PAST');
  });

  it('refuses a window that ends before it starts', async () => {
    const { assetId, workerIds, keeperId } = await seedFixture();
    const res = await request(server())
      .post('/reservations')
      .set('Idempotency-Key', randomUUID())
      .send({
        assetId: assetId.toString(),
        workerId: workerIds[0].toString(),
        keeperId: keeperId.toString(),
        startsAt: inDays(3, 17),
        endsAt: inDays(3, 9),
      });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('RESERVATION_INVERTED');
  });

  it('refuses a reservation spanning more than 30 days', async () => {
    const { assetId, workerIds, keeperId } = await seedFixture();
    const res = await request(server())
      .post('/reservations')
      .set('Idempotency-Key', randomUUID())
      .send({
        assetId: assetId.toString(),
        workerId: workerIds[0].toString(),
        keeperId: keeperId.toString(),
        startsAt: inDays(1, 0),
        endsAt: inDays(400, 0),
      });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('RESERVATION_TOO_LONG');
  });

  it('refuses an overlap that shares even a minute (FR-7)', async () => {
    const { assetId, workerIds, keeperId } = await seedFixture();
    await request(server())
      .post('/reservations')
      .set('Idempotency-Key', randomUUID())
      .send({
        assetId: assetId.toString(),
        workerId: workerIds[0].toString(),
        keeperId: keeperId.toString(),
        startsAt: inDays(5, 9),
        endsAt: inDays(5, 17),
      })
      .expect(201);

    const res = await request(server())
      .post('/reservations')
      .set('Idempotency-Key', randomUUID())
      .send({
        assetId: assetId.toString(),
        workerId: workerIds[1].toString(),
        keeperId: keeperId.toString(),
        startsAt: inDays(5, 16),
        endsAt: inDays(5, 20),
      });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('RESERVATION_OVERLAP');
  });

  it('allows two reservations that share only an edge (half-open, adjacent is fine)', async () => {
    const { assetId, workerIds, keeperId } = await seedFixture();
    await request(server())
      .post('/reservations')
      .set('Idempotency-Key', randomUUID())
      .send({
        assetId: assetId.toString(),
        workerId: workerIds[0].toString(),
        keeperId: keeperId.toString(),
        startsAt: inDays(6, 9),
        endsAt: inDays(6, 17),
      })
      .expect(201);

    const res = await request(server())
      .post('/reservations')
      .set('Idempotency-Key', randomUUID())
      .send({
        assetId: assetId.toString(),
        workerId: workerIds[1].toString(),
        keeperId: keeperId.toString(),
        startsAt: inDays(6, 17),
        endsAt: inDays(6, 20),
      });

    expect(res.status).toBe(201);
  });

  it('cancels a pending reservation, then refuses to cancel it twice', async () => {
    const { assetId, workerIds, keeperId } = await seedFixture();
    const created = await request(server())
      .post('/reservations')
      .set('Idempotency-Key', randomUUID())
      .send({
        assetId: assetId.toString(),
        workerId: workerIds[0].toString(),
        keeperId: keeperId.toString(),
        startsAt: inDays(7, 9),
        endsAt: inDays(7, 17),
      })
      .expect(201);

    await request(server())
      .post(`/reservations/${created.body.reservation.id}/cancel`)
      .set('Idempotency-Key', randomUUID())
      .send({ keeperId: keeperId.toString(), reason: 'Job cancelled' })
      .expect(201);

    const second = await request(server())
      .post(`/reservations/${created.body.reservation.id}/cancel`)
      .set('Idempotency-Key', randomUUID())
      .send({ keeperId: keeperId.toString(), reason: 'Job cancelled' });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('RESERVATION_NOT_PENDING');
  });

  it('taking an asset out of service does not force a return of the current holder', async () => {
    const { assetId, workerIds, keeperId } = await seedFixture();
    await request(server())
      .post('/movements/issue')
      .set('Idempotency-Key', randomUUID())
      .send({ assetId: assetId.toString(), workerId: workerIds[0].toString(), keeperId: keeperId.toString() })
      .expect(201);

    const oos = await request(server())
      .post(`/assets/${assetId}/out-of-service`)
      .set('Idempotency-Key', randomUUID())
      .send({ keeperId: keeperId.toString(), reason: 'Frayed cable found' })
      .expect(201);
    expect(oos.body.movement.type).toBe('OUT_OF_SERVICE');

    const holding = await connection.collection('asset_holdings').findOne({ _id: assetId });
    expect(holding).not.toBeNull();
    expect(holding?.workerId.toString()).toBe(workerIds[0].toString());

    const state = await request(server()).get(`/assets/RES-${assetId.toString().slice(-6)}`).expect(200);
    expect(state.body.status).toBe('OUT_OF_SERVICE');
    expect(state.body.serviceable).toBe(false);
  });

  it('refuses to take an asset out of service twice', async () => {
    const { assetId, keeperId } = await seedFixture();
    await request(server())
      .post(`/assets/${assetId}/out-of-service`)
      .set('Idempotency-Key', randomUUID())
      .send({ keeperId: keeperId.toString(), reason: 'First' })
      .expect(201);

    const res = await request(server())
      .post(`/assets/${assetId}/out-of-service`)
      .set('Idempotency-Key', randomUUID())
      .send({ keeperId: keeperId.toString(), reason: 'Second' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ASSET_ALREADY_OUT_OF_SERVICE');
  });

  it('out-of-service cancels a standing future reservation, with a recorded reason', async () => {
    const { assetId, workerIds, keeperId } = await seedFixture();
    const reserved = await request(server())
      .post('/reservations')
      .set('Idempotency-Key', randomUUID())
      .send({
        assetId: assetId.toString(),
        workerId: workerIds[0].toString(),
        keeperId: keeperId.toString(),
        startsAt: inDays(10, 9),
        endsAt: inDays(10, 17),
      })
      .expect(201);

    const oos = await request(server())
      .post(`/assets/${assetId}/out-of-service`)
      .set('Idempotency-Key', randomUUID())
      .send({ keeperId: keeperId.toString(), reason: 'Motor seized' })
      .expect(201);
    expect(oos.body.cancelledReservations).toBe(1);

    const reservation = await connection
      .collection('reservations')
      .findOne({ _id: new Types.ObjectId(reserved.body.reservation.id) });
    expect(reservation?.status).toBe('CANCELLED');
    expect(reservation?.cancelReason).toContain('Motor seized');
  });

  it('a new reservation is refused while the asset is out of service (FR-16)', async () => {
    const { assetId, workerIds, keeperId } = await seedFixture();
    await request(server())
      .post(`/assets/${assetId}/out-of-service`)
      .set('Idempotency-Key', randomUUID())
      .send({ keeperId: keeperId.toString(), reason: 'Broken' })
      .expect(201);

    const res = await request(server())
      .post('/reservations')
      .set('Idempotency-Key', randomUUID())
      .send({
        assetId: assetId.toString(),
        workerId: workerIds[0].toString(),
        keeperId: keeperId.toString(),
        startsAt: inDays(3, 9),
        endsAt: inDays(3, 17),
      });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ASSET_OUT_OF_SERVICE');
  });

  it('brings an asset back into service, and then refuses to do it again', async () => {
    const { assetId, keeperId } = await seedFixture();
    await request(server())
      .post(`/assets/${assetId}/out-of-service`)
      .set('Idempotency-Key', randomUUID())
      .send({ keeperId: keeperId.toString(), reason: 'Broken' })
      .expect(201);

    const back = await request(server())
      .post(`/assets/${assetId}/back-in-service`)
      .set('Idempotency-Key', randomUUID())
      .send({ keeperId: keeperId.toString(), note: 'Repaired' })
      .expect(201);
    expect(back.body.movement.type).toBe('BACK_IN_SERVICE');

    const again = await request(server())
      .post(`/assets/${assetId}/back-in-service`)
      .set('Idempotency-Key', randomUUID())
      .send({ keeperId: keeperId.toString(), note: 'Repaired again?' });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ASSET_ALREADY_IN_SERVICE');
  });

  it('an asset repaired and back in service can be issued again', async () => {
    const { assetId, workerIds, keeperId } = await seedFixture();
    await request(server())
      .post(`/assets/${assetId}/out-of-service`)
      .set('Idempotency-Key', randomUUID())
      .send({ keeperId: keeperId.toString(), reason: 'Broken' })
      .expect(201);
    await request(server())
      .post(`/assets/${assetId}/back-in-service`)
      .set('Idempotency-Key', randomUUID())
      .send({ keeperId: keeperId.toString(), note: 'Repaired' })
      .expect(201);

    const issued = await request(server())
      .post('/movements/issue')
      .set('Idempotency-Key', randomUUID())
      .send({ assetId: assetId.toString(), workerId: workerIds[0].toString(), keeperId: keeperId.toString() });
    expect(issued.status).toBe(201);
  });

  it('replaying the same Idempotency-Key on a reservation create never creates a second one', async () => {
    const { assetId, workerIds, keeperId } = await seedFixture();
    const key = randomUUID();
    const payload = {
      assetId: assetId.toString(),
      workerId: workerIds[0].toString(),
      keeperId: keeperId.toString(),
      startsAt: inDays(8, 9),
      endsAt: inDays(8, 17),
    };

    await request(server()).post('/reservations').set('Idempotency-Key', key).send(payload).expect(201);
    const replay = await request(server()).post('/reservations').set('Idempotency-Key', key).send(payload);
    expect(replay.status).toBe(201);
    expect(replay.headers['idempotent-replay']).toBe('true');

    const count = await connection.collection('reservations').countDocuments({ assetId });
    expect(count).toBe(1);
  });
});
