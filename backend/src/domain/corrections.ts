import type { Movement } from './types.js';

/**
 * A correction is a complete replacement record that points at the movement
 * it supersedes. The effective ledger is therefore every movement nothing
 * points at: originals never corrected, and the tip of each correction chain.
 * Superseded entries stay in the collection so the history can show them.
 */
export function effectiveMovements(all: readonly Movement[]): Movement[] {
  const superseded = new Set<string>();
  for (const m of all) if (m.correctsMovementId) superseded.add(m.correctsMovementId);
  return all.filter((m) => !superseded.has(m.id));
}

/** The whole chain a movement belongs to, oldest first, reachable from any member. */
export function correctionChain(all: readonly Movement[], id: string): Movement[] {
  const byId = new Map(all.map((m) => [m.id, m]));
  const successorOf = new Map<string, Movement>();
  for (const m of all) if (m.correctsMovementId) successorOf.set(m.correctsMovementId, m);

  let root = byId.get(id);
  if (!root) return [];

  // Walk back to the original. The `seen` guard means a cycle in corrupt data
  // stops the walk instead of hanging the request.
  const seen = new Set<string>([root.id]);
  while (root.correctsMovementId) {
    const previous = byId.get(root.correctsMovementId);
    if (!previous || seen.has(previous.id)) break;
    seen.add(previous.id);
    root = previous;
  }

  const chain = [root];
  const walked = new Set<string>([root.id]);
  let next = successorOf.get(root.id);
  while (next && !walked.has(next.id)) {
    chain.push(next);
    walked.add(next.id);
    next = successorOf.get(next.id);
  }
  return chain;
}
