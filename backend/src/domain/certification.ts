export interface Certification {
  code: string;
  issuedAt: Date;
  expiresAt: Date;
}

export interface WorkerCertifications {
  name: string;
  certifications: readonly Certification[];
}

export type CertificationCheck =
  | { ok: true }
  | { ok: false; code: 'CERTIFICATION_MISSING' | 'CERTIFICATION_EXPIRED'; message: string };

/**
 * Certification is checked against the *issue date*, not against today, so a
 * late-logged issue is judged by whether the worker was certified when they
 * actually took the tool (FR-15, and PLAN.md §12 #16 on backdating).
 *
 * A certificate expiring on the day of issue still counts: expiry is treated
 * as the end of that day, which is how a paper certificate reads.
 */
export function checkCertification(
  worker: WorkerCertifications,
  requiredCertification: string | null | undefined,
  issuedOn: Date,
): CertificationCheck {
  if (!requiredCertification) return { ok: true };

  const held = worker.certifications.filter((c) => c.code === requiredCertification);
  if (held.length === 0) {
    return {
      ok: false,
      code: 'CERTIFICATION_MISSING',
      message: `${worker.name} does not hold the ${requiredCertification} certificate, which this asset requires.`,
    };
  }

  const valid = held.filter(
    (c) => c.issuedAt.getTime() <= issuedOn.getTime() && issuedOn.getTime() <= endOfDay(c.expiresAt),
  );
  if (valid.length > 0) return { ok: true };

  const latest = held.reduce((a, b) => (a.expiresAt > b.expiresAt ? a : b));
  return {
    ok: false,
    code: 'CERTIFICATION_EXPIRED',
    message: `${worker.name}'s ${requiredCertification} certificate expired on ${isoDate(latest.expiresAt)}, so this asset cannot be issued to them.`,
  };
}

function endOfDay(date: Date): number {
  const end = new Date(date);
  end.setUTCHours(23, 59, 59, 999);
  return end.getTime();
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
