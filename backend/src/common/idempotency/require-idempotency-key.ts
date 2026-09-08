import { DomainError } from '../errors/domain-error.js';

/** Missing Idempotency-Key is a 428, checked before the body is even parsed -
 * a client that forgot the header should not be told its payload was wrong. */
export function requireIdempotencyKey(key: string | undefined): asserts key is string {
  if (!key || !key.trim()) {
    throw new DomainError(
      'IDEMPOTENCY_KEY_REQUIRED',
      'An Idempotency-Key header is required for this request.',
      428,
    );
  }
}
