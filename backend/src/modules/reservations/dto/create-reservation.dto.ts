import { IsISO8601, IsMongoId } from 'class-validator';

export class CreateReservationDto {
  @IsMongoId()
  assetId: string;

  @IsMongoId()
  workerId: string;

  @IsMongoId()
  keeperId: string;

  @IsISO8601({ strict: true })
  startsAt: string;

  /** The window is half-open, [startsAt, endsAt) - PLAN.md §12 #12. */
  @IsISO8601({ strict: true })
  endsAt: string;
}
