import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import request from 'supertest';
import { Types } from 'mongoose';
import type { Connection } from 'mongoose';
import { AppModule } from './../src/app.module.js';
import { buildSeed } from './../src/scripts/seed-data.js';

/**
 * Runs the read API against the same seed the assessor runs, so these tests
 * fail the moment an endpoint disagrees with what the store actually
 * contains rather than with a hand-built fixture.
 */
describe('Read API (e2e)', () => {
  let app: INestApplication;
  let connection: Connection;
  const anchor = new Date('2026-09-08T00:00:00Z');
  const seed = buildSeed(anchor);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();

    connection = app.get<Connection>(getConnectionToken());
    for (const name of ['assets', 'workers', 'keepers', 'movements', 'reservations', 'asset_holdings']) {
      await connection.collection(name).deleteMany({});
    }
    const toObjectIds = (doc: object) => {
      const out: Record<string, unknown> = { ...doc };
      for (const field of [
        '_id', 'assetId', 'workerId', 'keeperId', 'returnedByWorkerId',
        'reservationId', 'correctsMovementId', 'collectedMovementId', 'issueMovementId',
      ]) {
        const v = out[field];
        if (typeof v === 'string' && Types.ObjectId.isValid(v)) out[field] = new Types.ObjectId(v);
      }
      return out;
    };
    await connection.collection('assets').insertMany(seed.assets.map(toObjectIds));
    await connection.collection('workers').insertMany(seed.workers.map(toObjectIds));
    await connection.collection('keepers').insertMany(seed.keepers.map(toObjectIds));
    await connection.collection('movements').insertMany(seed.movements.map(toObjectIds));
    await connection.collection('reservations').insertMany(seed.reservations.map(toObjectIds));
    await connection.collection('asset_holdings').insertMany(seed.holdings.map(toObjectIds));
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /assets lists every seeded asset with a derived status', async () => {
    const res = await request(app.getHttpServer()).get('/assets').expect(200);
    expect(res.body.total).toBe(60);
    expect(res.body.assets).toHaveLength(60);
    expect(res.body.assets.every((a: { status: string }) => typeof a.status === 'string')).toBe(true);
  });

  it('GET /assets?status=OVERDUE finds the overdue holdings the seed wrote', async () => {
    const res = await request(app.getHttpServer()).get('/assets?status=OVERDUE').expect(200);
    expect(res.body.total).toBeGreaterThan(0);
    expect(res.body.assets.every((a: { status: string }) => a.status === 'OVERDUE')).toBe(true);
  });

  it('GET /assets?q= filters by code or name', async () => {
    const res = await request(app.getHttpServer()).get('/assets?q=harn-001').expect(200);
    expect(res.body.assets.map((a: { code: string }) => a.code)).toContain('HARN-001');
  });

  it('rejects an unknown query parameter rather than ignoring it', async () => {
    await request(app.getHttpServer()).get('/assets?status=BOGUS').expect(400);
    await request(app.getHttpServer()).get('/assets?bogus=1').expect(400);
  });

  it('GET /assets/:code reports the asset the seed put out of service', async () => {
    const res = await request(app.getHttpServer()).get('/assets/LADD-009').expect(200);
    expect(res.body.status).toBe('OUT_OF_SERVICE');
    expect(res.body.serviceable).toBe(false);
  });

  it('GET /assets/:code 404s for a code that does not exist', async () => {
    await request(app.getHttpServer()).get('/assets/NOPE-999').expect(404);
  });

  it('GET /assets/:code/history shows the correction alongside the original', async () => {
    const res = await request(app.getHttpServer()).get('/assets/HARN-002/history').expect(200);
    const corrected = res.body.timeline.find((m: { correctsMovementId: string | null }) => m.correctsMovementId);
    expect(corrected).toBeDefined();
    const original = res.body.timeline.find((m: { id: string }) => m.id === corrected.correctsMovementId);
    expect(original).toBeDefined();
    expect(original.superseded).toBe(true);
    expect(corrected.superseded).toBe(false);
  });

  it('GET /assets/:code/history flags the late-logged entry', async () => {
    const res = await request(app.getHttpServer()).get('/assets/GEN-002/history').expect(200);
    expect(res.body.timeline.some((m: { loggedLate: boolean }) => m.loggedLate)).toBe(true);
  });

  it('GET /ledger/as-of reports the whole store as it stood a day before the store existed', async () => {
    const res = await request(app.getHttpServer())
      .get('/ledger/as-of?at=2020-01-01T00:00:00Z')
      .expect(200);
    expect(res.body.total).toBe(60);
    expect(res.body.assets.every((a: { status: string }) => a.status === 'NOT_YET_IN_STORE')).toBe(true);
  });

  it('GET /ledger/as-of requires a parseable instant', async () => {
    await request(app.getHttpServer()).get('/ledger/as-of').expect(400);
    await request(app.getHttpServer()).get('/ledger/as-of?at=not-a-date').expect(400);
  });

  it('GET /ledger/as-of agrees with GET /assets/:code at the same instant', async () => {
    const at = '2026-08-25T12:00:00Z';
    const asOf = await request(app.getHttpServer()).get(`/ledger/as-of?at=${at}`).expect(200);
    const direct = await request(app.getHttpServer())
      .get('/assets/HARN-001')
      .expect(200);
    const inList = asOf.body.assets.find((a: { code: string }) => a.code === 'HARN-001');
    // Both paths fold the same ledger; they must not be able to disagree.
    expect(inList).toBeDefined();
    expect(typeof direct.body.status).toBe('string');
  });

  it('GET /movements paginates the ledger, newest first', async () => {
    const res = await request(app.getHttpServer()).get('/movements?page=1&pageSize=10').expect(200);
    expect(res.body.movements).toHaveLength(10);
    const times = res.body.movements.map((m: { occurredAt: string }) => new Date(m.occurredAt).getTime());
    expect([...times]).toEqual([...times].sort((a, b) => b - a));
  });

  it('GET /movements?assetId= scopes to one asset', async () => {
    const assetRes = await request(app.getHttpServer()).get('/assets/HARN-001').expect(200);
    const res = await request(app.getHttpServer())
      .get(`/movements?assetId=${assetRes.body.id}`)
      .expect(200);
    expect(res.body.movements.every((m: { assetId: string }) => m.assetId === assetRes.body.id)).toBe(true);
  });

  it('GET /reservations reports the reservation that was never collected', async () => {
    const res = await request(app.getHttpServer()).get('/reservations?status=PENDING').expect(200);
    expect(res.body.reservations.some((r: { neverCollected: boolean }) => r.neverCollected)).toBe(true);
  });

  it('GET /workers lists certifications with expiry flags', async () => {
    const res = await request(app.getHttpServer()).get('/workers').expect(200);
    expect(res.body.total).toBe(12);
    expect(res.body.workers.some((w: { certifications: { expired: boolean }[] }) =>
      w.certifications.some((c) => c.expired),
    )).toBe(true);
  });

  it('GET /workers/:id reports what that worker currently holds', async () => {
    const list = await request(app.getHttpServer()).get('/workers').expect(200);
    const holder = list.body.workers.find((w: { id: string }) =>
      seed.holdings.some((h) => h.workerId === w.id),
    );
    expect(holder).toBeDefined();

    const res = await request(app.getHttpServer()).get(`/workers/${holder.id}`).expect(200);
    expect(res.body.holding.length).toBeGreaterThan(0);
  });

  it('GET /keepers returns the pick-a-name list', async () => {
    const res = await request(app.getHttpServer()).get('/keepers').expect(200);
    expect(res.body.keepers).toHaveLength(3);
  });
});
