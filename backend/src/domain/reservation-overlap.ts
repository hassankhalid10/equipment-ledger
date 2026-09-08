import type { Reservation } from './types.js';

export interface Window {
  startsAt: Date;
  endsAt: Date;
}

/**
 * Windows are half-open: [startsAt, endsAt). A window ending at 10:00 and one
 * starting at 10:00 therefore both stand, which is the reading of "may not
 * share a minute. Adjacent is fine" (PLAN.md §12 #12).
 *
 * The alternative — one document per bookable minute — was rejected because a
 * year-long reservation would be 525,600 documents.
 */
export function overlaps(a: Window, b: Window): boolean {
  return a.startsAt.getTime() < b.endsAt.getTime() && b.startsAt.getTime() < a.endsAt.getTime();
}

/** A reservation only blocks the window while it is live. Cancelled ones do not. */
export function blocksWindow(reservation: Reservation): boolean {
  return reservation.status === 'PENDING' || reservation.status === 'COLLECTED';
}

/** Every live reservation on the asset that would clash with `window`. */
export function clashingReservations(
  existing: readonly Reservation[],
  window: Window,
  ignoreReservationId?: string,
): Reservation[] {
  return existing.filter(
    (r) => r.id !== ignoreReservationId && blocksWindow(r) && overlaps(r, window),
  );
}
