import { IsMongoId, IsString, MaxLength, MinLength } from 'class-validator';

export class CancelReservationDto {
  @IsMongoId()
  keeperId: string;

  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason: string;
}
