import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from '../../common/pagination/pagination';
import { toOptionalBoolean } from '../../tasks/dto/task-filter.dto';

/**
 * WHAT: Query string for `GET /notifications` - `?unread=true&page=2&pageSize=10`.
 * `unread` goes through `toOptionalBoolean` for the same reason as the task
 * filters: `Boolean("false")` is `true`.
 */
export class ListNotificationsQueryDto {
  @IsOptional()
  @Transform(toOptionalBoolean)
  @IsBoolean()
  @ApiPropertyOptional({ type: Boolean, description: 'true: only unread notifications.' })
  unread?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @ApiPropertyOptional({ minimum: 1, default: 1, description: 'Page number, starting at 1.' })
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  @ApiPropertyOptional({
    minimum: 1,
    maximum: MAX_PAGE_SIZE,
    default: DEFAULT_PAGE_SIZE,
    description: 'Items per page.',
  })
  pageSize: number = DEFAULT_PAGE_SIZE;
}
