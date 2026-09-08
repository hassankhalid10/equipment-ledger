import { Transform, Type } from 'class-transformer';
import { IsIn, IsISO8601, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/**
 * Query shapes for the read endpoints. The global ValidationPipe rejects
 * unknown properties, so a mistyped filter is a 400 rather than a silently
 * ignored parameter that makes the answer look wrong.
 */

const trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));

export class AsOfQuery {
  /** The instant to reconstruct. Required: "as of" with no instant is meaningless. */
  @IsISO8601({ strict: true }, { message: 'at must be an ISO-8601 timestamp, e.g. 2026-09-08T14:20:00Z' })
  at: string;
}

export class AssetListQuery {
  @IsOptional()
  @IsIn(['IN_STORE', 'ISSUED', 'OVERDUE', 'RESERVED', 'OUT_OF_SERVICE', 'NOT_YET_IN_STORE'])
  status?: string;

  @IsOptional()
  @IsString()
  @trim()
  kind?: string;

  /** Free text over code and name. */
  @IsOptional()
  @IsString()
  @trim()
  q?: string;
}

export class MovementListQuery {
  @IsOptional()
  @IsString()
  assetId?: string;

  @IsOptional()
  @IsString()
  workerId?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  pageSize?: number;
}

export class ReservationListQuery {
  @IsOptional()
  @IsString()
  assetId?: string;

  @IsOptional()
  @IsIn(['PENDING', 'COLLECTED', 'CANCELLED'])
  status?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;
}

export class WorkerListQuery {
  @IsOptional()
  @IsString()
  @trim()
  q?: string;
}
