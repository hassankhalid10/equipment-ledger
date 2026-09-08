import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import { DomainError } from './domain-error.js';

/**
 * The one error shape the API speaks, whatever went wrong (PLAN.md §10):
 *
 *   { error: { code, message, details? }, requestId }
 *
 * The frontend renders `error.message` verbatim and never invents its own
 * wording for a business refusal - that only works if every path through
 * this filter produces the same shape.
 */
@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const requestId = randomUUID();

    if (exception instanceof DomainError) {
      res.status(exception.status).json({
        error: { code: exception.code, message: exception.message, details: exception.details },
        requestId,
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const message =
        typeof body === 'string'
          ? body
          : Array.isArray((body as { message?: unknown }).message)
            ? ((body as { message: string[] }).message.join('; '))
            : ((body as { message?: string }).message ?? exception.message);

      res.status(status).json({
        error: { code: 'HTTP_ERROR', message },
        requestId,
      });
      return;
    }

    // Unexpected. Nothing was committed - the write path only marks an
    // idempotency key COMPLETED after a successful commit - so the honest
    // answer is a generic 500, not a guess at what went wrong.
    // eslint-disable-next-line no-console
    console.error(`[${requestId}] unhandled error:`, exception);
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Nothing was written.' },
      requestId,
    });
  }
}
