import { Body, Controller, Headers, HttpCode, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { DomainError } from '../../common/errors/domain-error.js';
import { MovementsService } from './movements.service.js';
import { IssueDto } from './dto/issue.dto.js';
import { ReturnDto } from './dto/return.dto.js';

/**
 * Both endpoints require Idempotency-Key. Missing it is a 428, checked
 * before the body is even looked at (PLAN.md §7 step 1) - a client that
 * forgot the header should not be told its payload was wrong.
 */
@Controller('movements')
export class MovementsController {
  constructor(private readonly movements: MovementsService) {}

  @Post('issue')
  @HttpCode(201)
  async issue(
    @Body() dto: IssueDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    requireIdempotencyKey(idempotencyKey);
    const result = await this.movements.issue(dto, idempotencyKey!);
    if (result.replay) res.set('Idempotent-Replay', 'true');
    return result.body;
  }

  @Post('return')
  @HttpCode(201)
  async returnAsset(
    @Body() dto: ReturnDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    requireIdempotencyKey(idempotencyKey);
    const result = await this.movements.returnAsset(dto, idempotencyKey!);
    if (result.replay) res.set('Idempotent-Replay', 'true');
    return result.body;
  }
}

function requireIdempotencyKey(key: string | undefined): asserts key is string {
  if (!key || !key.trim()) {
    throw new DomainError(
      'IDEMPOTENCY_KEY_REQUIRED',
      'An Idempotency-Key header is required for this request.',
      428,
    );
  }
}
