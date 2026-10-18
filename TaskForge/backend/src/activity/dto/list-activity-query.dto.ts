import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from '../../common/pagination/pagination';
import { ACTIVITY_ACTIONS, ActivityAction } from '../activity.types';

/**
 * WHAT: Query string for the activity feed and the audit trail:
 *
 *   ?action=task.moved&actorId=<uuid>&taskId=<uuid>&from=2026-10-01&to=2026-10-31&page=2
 *
 * Every filter is optional and they combine with AND. Everything is validated:
 * `action` must be a real action, ids must be UUIDs, `from`/`to` must be
 * ISO-8601 dates, and `pageSize` is capped. The project feed ignores
 * `projectId` (its project comes from the URL); the audit trail uses it as an
 * optional filter.
 */
export class ListActivityQueryDto {
  @IsOptional()
  @IsIn(ACTIVITY_ACTIONS)
  action?: ActivityAction;

  @IsOptional()
  @IsUUID()
  actorId?: string;

  @IsOptional()
  @IsUUID()
  taskId?: string;

  @IsOptional()
  @IsUUID()
  projectId?: string;

  /** Inclusive lower bound, e.g. `2026-10-01` or `2026-10-01T09:00:00Z`. */
  @IsOptional()
  @IsISO8601()
  from?: string;

  /** Inclusive upper bound. A bare date means the START of that day. */
  @IsOptional()
  @IsISO8601()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  pageSize: number = DEFAULT_PAGE_SIZE;
}
