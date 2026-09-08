import { IsIn, IsISO8601, IsMongoId, IsOptional, IsString, MaxLength } from 'class-validator';

export class ReturnDto {
  @IsMongoId()
  assetId: string;

  @IsMongoId()
  keeperId: string;

  /** Who physically handed it back. Defaults to the current holder. May differ (FR-4). */
  @IsOptional()
  @IsMongoId()
  returnedByWorkerId?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  occurredAt?: string;

  @IsIn(['OK', 'DAMAGED'])
  condition: 'OK' | 'DAMAGED';

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
