import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import type { Connection } from 'mongoose';
import { AppModule } from './../src/app.module.js';
import { DomainExceptionFilter } from './../src/common/errors/domain-exception.filter.js';
import { ClaimReplayService } from './../src/common/write-path/claim-replay.service.js';

/**
 * There is no MongoDB transaction wrapping the write path (PLAN.md §7), so
 * the honest thing to test is the crash window itself: a claim written with
 * its movement withheld, exactly what a process killed between those two
 * writes would leave behind. These tests build that state directly - no
 * real process is killed - and prove the very next request settles it to
 * exactly one movement, never zero, never two.
 */
describe('Crash recovery (e2e)', () => {
  let app: INestApplication;
  let connection: Connection;
  let replay: ClaimReplayService;
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
    replay = app.get(ClaimReplayService);
  });

  afterAll(async () => {
    const assets = await connection.collection('assets').find({ code: /^CRASH-/ }).toArray();
    const assetIds = assets.map((a) => a._id);
    await connection.collection('movements').deleteMany({ assetId: { $in: assetIds } });
    await connection.collection('asset_holdings').deleteMany({ _id: { $in: assetIds } });
    await connection.collection('assets').deleteMany({ code: /^CRASH-/ });
    await connection.collection('workers').deleteMany({ employeeNo: /^T/ });
    await connection.collection('keepers').deleteMany({ name: 'Test Keeper' });
    await app.close();
  });

  async function seedFixture() {
    const assetId = new Types.ObjectId();
    const workerId = new Types.ObjectId();
    const keeperId = new Types.ObjectId();

    await connection.collection('assets').insertOne({
      _id: assetId,
      code: `CRASH-${assetId.toString().slice(-6)}`,
      name: 'Test asset',
      kind: 'test',
      requiredCertification: null,
      addedToStoreAt: new Date('2020-01-01T00:00:00Z'),
    });
    await connection.collection('workers').insertOne({
      _id: workerId,
      employeeNo: `T${workerId.toString().slice(-8)}`,
      name: 'Test Worker',
      active: true,
      certifications: [],
    });
    await connection.collection('keepers').insertOne({ _id: keeperId, name: 'Test Keeper' });

    return { assetId, workerId, keeperId };
  }

  /** Simulates exactly what a process killed after the claim, before the
   * movement insert, would leave in the database. */
  async function leaveUnsettledIssueClaim(assetId: Types.ObjectId, workerId: Types.ObjectId, keeperId: Types.ObjectId) {
    const movementId = new Types.ObjectId();
    const since = new Date('2026-01-01T09:00:00Z');
    const movement = {
      _id: movementId,
      assetId,
      type: 'ISSUE',
      occurredAt: since,
      recordedAt: since,
      keeperId,
      workerId,
      returnedByWorkerId: null,
      dueAt: null,
      condition: null,
      reservationId: null,
      correctsMovementId: null,
      correctionReason: null,
      reason: null,
      note: null,
      idempotencyKey: 'crash-sim',
    };
    await connection.collection('asset_holdings').insertOne({
      _id: assetId,
      state: 'PENDING',
      workerId,
      issueMovementId: movementId,
      since,
      dueAt: null,
      intent: { movementIds: [movementId], movements: [movement], collectReservationId: null },
      claimedAt: since,
      idempotencyKey: 'crash-sim',
    });
    return movementId;
  }

  it('replays an unsettled PENDING claim to exactly one movement, never zero, never two', async () => {
    const { assetId, workerId, keeperId } = await seedFixture();
    const movementId = await leaveUnsettledIssueClaim(assetId, workerId, keeperId);

    // Before replay: the guard is stuck mid-flight and the movement does not exist yet.
    expect((await connection.collection('asset_holdings').findOne({ _id: assetId }))?.state).toBe('PENDING');
    expect(await connection.collection('movements').countDocuments({ _id: movementId })).toBe(0);

    await replay.replayIfUnsettled(assetId);

    const holding = await connection.collection('asset_holdings').findOne({ _id: assetId });
    expect(holding?.state).toBe('ACTIVE');
    expect(holding?.intent).toBeNull();
    expect(await connection.collection('movements').countDocuments({ assetId, type: 'ISSUE' })).toBe(1);
  });

  it('replaying the same unsettled claim twice still leaves exactly one movement', async () => {
    const { assetId, workerId, keeperId } = await seedFixture();
    await leaveUnsettledIssueClaim(assetId, workerId, keeperId);

    // A second caller arriving before the first replay finished would run
    // this same call again. Pre-generated movement ids are what make that
    // safe: the second insert collides on _id instead of duplicating.
    await replay.replayIfUnsettled(assetId);
    await replay.replayIfUnsettled(assetId);

    expect(await connection.collection('movements').countDocuments({ assetId, type: 'ISSUE' })).toBe(1);
  });

  it('the next request against the asset settles the claim before doing its own work', async () => {
    const { assetId, workerId, keeperId } = await seedFixture();
    await leaveUnsettledIssueClaim(assetId, workerId, keeperId);

    // No call to replay() here - an ordinary API request is the trigger.
    const res = await request(server())
      .post('/movements/return')
      .set('Idempotency-Key', randomUUID())
      .send({ assetId: assetId.toString(), keeperId: keeperId.toString(), condition: 'OK' });

    expect(res.status).toBe(201);
    expect(await connection.collection('movements').countDocuments({ assetId })).toBe(2); // ISSUE + RETURN
    expect(await connection.collection('asset_holdings').findOne({ _id: assetId })).toBeNull();
  });

  it('a RELEASING claim (crashed mid-return) settles to the asset being free', async () => {
    const { assetId, workerId, keeperId } = await seedFixture();
    const issueMovementId = await leaveUnsettledIssueClaim(assetId, workerId, keeperId);
    await replay.replayIfUnsettled(assetId); // settle the issue first, as a prior request would have

    const returnMovementId = new Types.ObjectId();
    const returnedAt = new Date('2026-01-02T09:00:00Z');
    await connection.collection('asset_holdings').updateOne(
      { _id: assetId },
      {
        $set: {
          state: 'RELEASING',
          intent: {
            movementIds: [returnMovementId],
            movements: [
              {
                _id: returnMovementId,
                assetId,
                type: 'RETURN',
                occurredAt: returnedAt,
                recordedAt: returnedAt,
                keeperId,
                workerId: null,
                returnedByWorkerId: workerId,
                dueAt: null,
                condition: 'OK',
                reservationId: null,
                correctsMovementId: null,
                correctionReason: null,
                reason: null,
                note: null,
                idempotencyKey: 'crash-sim-2',
              },
            ],
            collectReservationId: null,
          },
          claimedAt: returnedAt,
        },
      },
    );

    await replay.replayIfUnsettled(assetId);

    expect(await connection.collection('asset_holdings').findOne({ _id: assetId })).toBeNull();
    expect(await connection.collection('movements').countDocuments({ _id: returnMovementId })).toBe(1);
    expect(await connection.collection('movements').countDocuments({ _id: issueMovementId })).toBe(1);
  });

  it('the invariant checker style query finds every unsettled claim across the store', async () => {
    const a = await seedFixture();
    const b = await seedFixture();
    await leaveUnsettledIssueClaim(a.assetId, a.workerId, a.keeperId);
    await leaveUnsettledIssueClaim(b.assetId, b.workerId, b.keeperId);

    const unsettled = await replay.allUnsettled();
    const ids = unsettled.map((h) => h._id.toString());
    expect(ids).toEqual(expect.arrayContaining([a.assetId.toString(), b.assetId.toString()]));
  });
});
