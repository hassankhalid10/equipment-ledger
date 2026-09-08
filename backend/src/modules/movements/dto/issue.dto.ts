import { IsISO8601, IsMongoId, IsOptional, IsString, MaxLength } from 'class-validator';

export class IssueDto {
  @IsMongoId()
  assetId: string;

  @IsMongoId()
  workerId: string;

  @IsMongoId()
  keeperId: string;

  /** When it actually happened. Defaults to now. Late entries are expected. */
  @IsOptional()
  @IsISO8601({ strict: true })
  occurredAt?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  dueAt?: string;

  /** Present when this issue is collecting an existing reservation. */
  @IsOptional()
  @IsMongoId()
  reservationId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
