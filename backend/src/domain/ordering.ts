import type { Movement } from './types.js';

/**
 * Deterministic order for the fold: business time, then the server clock,
 * then the id. Two movements at the identical instant therefore always fold
 * the same way (PLAN.md §12 #8).
 */
export function compareMovements(a: Movement, b: Movement): number {
  return (
    a.occurredAt.getTime() - b.occurredAt.getTime() ||
    a.recordedAt.getTime() - b.recordedAt.getTime() ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

export function sortMovements(movements: readonly Movement[]): Movement[] {
  return [...movements].sort(compareMovements);
}
