import { IsISO8601, IsMongoId, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class OutOfServiceDto {
  @IsMongoId()
  keeperId: string;

  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  occurredAt?: string;
}

export class BackInServiceDto {
  @IsMongoId()
  keeperId: string;

  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  note: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  occurredAt?: string;
}
