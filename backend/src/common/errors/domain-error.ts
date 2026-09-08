export type DomainErrorCode =
  | 'ASSET_NOT_FOUND'
  | 'WORKER_NOT_FOUND'
  | 'KEEPER_NOT_FOUND'
  | 'MOVEMENT_NOT_FOUND'
  | 'RESERVATION_NOT_FOUND'
  | 'ASSET_BUSY'
  | 'ASSET_ALREADY_HELD'
  | 'ASSET_NOT_HELD'
  | 'ASSET_OUT_OF_SERVICE'
  | 'ASSET_ALREADY_OUT_OF_SERVICE'
  | 'ASSET_ALREADY_IN_SERVICE'
  | 'ASSET_RESERVED_BY_ANOTHER_WORKER'
  | 'CERTIFICATION_MISSING'
  | 'CERTIFICATION_EXPIRED'
  | 'RETURN_BEFORE_ISSUE'
  | 'RESERVATION_OVERLAP'
  | 'RESERVATION_IN_PAST'
  | 'RESERVATION_INVERTED'
  | 'RESERVATION_TOO_LONG'
  | 'MOVEMENT_ALREADY_CORRECTED'
  | 'CORRECTION_BREAKS_TIMELINE'
  | 'OCCURRED_AT_IN_FUTURE'
  | 'IDEMPOTENCY_KEY_REQUIRED'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'ASSET_NOT_YET_IN_STORE';

/**
 * The one error shape every business refusal takes (PLAN.md §10). Thrown by
 * the domain/service layer; DomainExceptionFilter is the only place that
 * turns it into an HTTP response, so there is exactly one mapping to learn.
 */
export class DomainError extends Error {
  constructor(
    public readonly code: DomainErrorCode,
    message: string,
    public readonly status: 404 | 409 | 428 = 409,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

const NOT_FOUND_CODES = new Set<DomainErrorCode>([
  'ASSET_NOT_FOUND',
  'WORKER_NOT_FOUND',
  'KEEPER_NOT_FOUND',
  'MOVEMENT_NOT_FOUND',
  'RESERVATION_NOT_FOUND',
]);

export function notFound(code: DomainErrorCode, message: string): DomainError {
  return new DomainError(code, message, 404);
}

export function conflict(
  code: DomainErrorCode,
  message: string,
  details?: Record<string, unknown>,
): DomainError {
  return new DomainError(code, message, 409, details);
}

export function isNotFoundCode(code: DomainErrorCode): boolean {
  return NOT_FOUND_CODES.has(code);
}
