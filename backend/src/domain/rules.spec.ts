import { checkCertification } from './certification.js';
import { clashingReservations, overlaps } from './reservation-overlap.js';
import { correctionChain, effectiveMovements } from './corrections.js';
import type { Movement, Reservation } from './types.js';

const at = (iso: string) => new Date(iso);

describe('reservation overlap', () => {
  const window = { startsAt: at('2026-03-02T10:00:00Z'), endsAt: at('2026-03-02T12:00:00Z') };

  it('treats adjacent windows as fine', () => {
    const before = { startsAt: at('2026-03-02T08:00:00Z'), endsAt: at('2026-03-02T10:00:00Z') };
    const after = { startsAt: at('2026-03-02T12:00:00Z'), endsAt: at('2026-03-02T14:00:00Z') };
    expect(overlaps(window, before)).toBe(false);
    expect(overlaps(window, after)).toBe(false);
  });

  it('refuses windows that share even a minute', () => {
    const shares = { startsAt: at('2026-03-02T11:59:00Z'), endsAt: at('2026-03-02T14:00:00Z') };
    expect(overlaps(window, shares)).toBe(true);
  });

  it('catches a window wholly inside another, and one that swallows it', () => {
    expect(overlaps(window, { startsAt: at('2026-03-02T10:30:00Z'), endsAt: at('2026-03-02T11:00:00Z') })).toBe(true);
    expect(overlaps(window, { startsAt: at('2026-03-01T00:00:00Z'), endsAt: at('2026-03-03T00:00:00Z') })).toBe(true);
  });

  it('ignores cancelled reservations but not collected ones', () => {
    const base: Reservation = {
      id: 'r1',
      assetId: 'a1',
      workerId: 'w1',
      startsAt: at('2026-03-02T09:00:00Z'),
      endsAt: at('2026-03-02T11:00:00Z'),
      status: 'CANCELLED',
    };

    expect(clashingReservations([base], window)).toHaveLength(0);
    expect(clashingReservations([{ ...base, status: 'PENDING' }], window)).toHaveLength(1);
    expect(clashingReservations([{ ...base, status: 'COLLECTED' }], window)).toHaveLength(1);
  });

  it('does not clash with itself when a reservation is being re-checked', () => {
    const self: Reservation = {
      id: 'r1',
      assetId: 'a1',
      workerId: 'w1',
      startsAt: window.startsAt,
      endsAt: window.endsAt,
      status: 'PENDING',
    };
    expect(clashingReservations([self], window, 'r1')).toHaveLength(0);
  });
});

describe('certification', () => {
  const worker = {
    name: 'Amir Shah',
    certifications: [
      { code: 'WORKING_AT_HEIGHT', issuedAt: at('2025-01-01T00:00:00Z'), expiresAt: at('2026-03-01T00:00:00Z') },
    ],
  };

  it('passes an asset that requires nothing', () => {
    expect(checkCertification(worker, null, at('2030-01-01T00:00:00Z'))).toEqual({ ok: true });
  });

  it('passes the day before expiry and on the day of expiry', () => {
    expect(checkCertification(worker, 'WORKING_AT_HEIGHT', at('2026-02-28T09:00:00Z')).ok).toBe(true);
    expect(checkCertification(worker, 'WORKING_AT_HEIGHT', at('2026-03-01T09:00:00Z')).ok).toBe(true);
  });

  it('refuses the day after expiry, naming the certificate and the date', () => {
    const result = checkCertification(worker, 'WORKING_AT_HEIGHT', at('2026-03-02T09:00:00Z'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('CERTIFICATION_EXPIRED');
    expect(result.message).toContain('Amir Shah');
    expect(result.message).toContain('WORKING_AT_HEIGHT');
    expect(result.message).toContain('2026-03-01');
  });

  it('refuses a certificate the worker has never held', () => {
    const result = checkCertification(worker, 'GAS_SAFE', at('2026-01-01T00:00:00Z'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('CERTIFICATION_MISSING');
  });

  it('judges a late-logged issue by the date it happened, not today', () => {
    // Logged today, but the tool actually went out while the cert was valid.
    expect(checkCertification(worker, 'WORKING_AT_HEIGHT', at('2026-02-01T09:00:00Z')).ok).toBe(true);
  });
});

describe('corrections', () => {
  const original: Movement = {
    id: 'm1',
    assetId: 'a1',
    type: 'ISSUE',
    keeperId: 'k1',
    occurredAt: at('2026-02-01T09:00:00Z'),
    recordedAt: at('2026-02-01T09:00:00Z'),
    workerId: 'w1',
  };
  const correction: Movement = {
    ...original,
    id: 'm2',
    workerId: 'w2',
    recordedAt: at('2026-02-05T09:00:00Z'),
    correctsMovementId: 'm1',
  };

  it('leaves only the tip of a chain effective', () => {
    expect(effectiveMovements([original, correction]).map((m) => m.id)).toEqual(['m2']);
  });

  it('returns the whole chain from any member, oldest first', () => {
    const third: Movement = { ...correction, id: 'm3', workerId: 'w3', correctsMovementId: 'm2' };
    const all = [original, correction, third];
    expect(correctionChain(all, 'm1').map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
    expect(correctionChain(all, 'm3').map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
  });

  it('returns nothing for a movement that does not exist', () => {
    expect(correctionChain([original], 'nope')).toEqual([]);
  });
});
