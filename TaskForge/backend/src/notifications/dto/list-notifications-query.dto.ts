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
  unread?: boolean;

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
