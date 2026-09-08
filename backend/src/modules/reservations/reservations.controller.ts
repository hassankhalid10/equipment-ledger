import { Body, Controller, Headers, HttpCode, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { requireIdempotencyKey } from '../../common/idempotency/require-idempotency-key.js';
import { ReservationsService } from './reservations.service.js';
import { CreateReservationDto } from './dto/create-reservation.dto.js';
import { CancelReservationDto } from './dto/cancel-reservation.dto.js';

@Controller('reservations')
export class ReservationsController {
  constructor(private readonly reservations: ReservationsService) {}

  @Post()
  @HttpCode(201)
  async create(
    @Body() dto: CreateReservationDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    requireIdempotencyKey(idempotencyKey);
    const result = await this.reservations.create(dto, idempotencyKey!);
    if (result.replay) res.set('Idempotent-Replay', 'true');
    return result.body;
  }

  @Post(':id/cancel')
  async cancel(
    @Param('id') id: string,
    @Body() dto: CancelReservationDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    requireIdempotencyKey(idempotencyKey);
    const result = await this.reservations.cancel(id, dto, idempotencyKey!);
    if (result.replay) res.set('Idempotent-Replay', 'true');
    return result.body;
  }
}
