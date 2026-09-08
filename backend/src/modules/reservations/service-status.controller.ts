import { Body, Controller, Headers, HttpCode, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { requireIdempotencyKey } from '../../common/idempotency/require-idempotency-key.js';
import { ServiceStatusService } from './service-status.service.js';
import { BackInServiceDto, OutOfServiceDto } from './dto/service-status.dto.js';

@Controller('assets')
export class ServiceStatusController {
  constructor(private readonly service: ServiceStatusService) {}

  @Post(':id/out-of-service')
  @HttpCode(201)
  async outOfService(
    @Param('id') id: string,
    @Body() dto: OutOfServiceDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    requireIdempotencyKey(idempotencyKey);
    const result = await this.service.outOfService(id, dto, idempotencyKey!);
    if (result.replay) res.set('Idempotent-Replay', 'true');
    return result.body;
  }

  @Post(':id/back-in-service')
  @HttpCode(201)
  async backInService(
    @Param('id') id: string,
    @Body() dto: BackInServiceDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    requireIdempotencyKey(idempotencyKey);
    const result = await this.service.backInService(id, dto, idempotencyKey!);
    if (result.replay) res.set('Idempotent-Replay', 'true');
    return result.body;
  }
}
