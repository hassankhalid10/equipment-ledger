import {
  IsIn,
  IsISO8601,
  IsMongoId,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Every field except correctionReason and keeperId is optional: a correction
 * only overrides what was wrong. Whatever is omitted carries forward from
 * the movement being corrected (PLAN.md §10, Correction).
 */
export class CorrectMovementDto {
  @IsMongoId()
  keeperId: string;

  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  correctionReason: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  occurredAt?: string;

  /** The holder, on a correction to an ISSUE. */
  @IsOptional()
  @IsMongoId()
  workerId?: string;

  /** Who returned it, on a correction to a RETURN. */
  @IsOptional()
  @IsMongoId()
  returnedByWorkerId?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  dueAt?: string;

  @IsOptional()
  @IsIn(['OK', 'DAMAGED'])
  condition?: 'OK' | 'DAMAGED';

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
