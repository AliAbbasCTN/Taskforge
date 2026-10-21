import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../../common/pagination/pagination';
import { TaskFilterDto } from './task-filter.dto';

export const TASK_SORT_FIELDS = [
  'createdAt',
  'dueDate',
  'priority',
  'title',
] as const;
export type TaskSortField = (typeof TASK_SORT_FIELDS)[number];

/**
 * WHAT: The query string for `GET .../boards/:boardId/tasks` - filters (from
 * `TaskFilterDto`) plus paging and sorting.
 *
 * WHY `pageSize` has a hard maximum: without one, `?pageSize=1000000` turns
 * pagination off and lets any client ask the database for everything. The cap
 * is what makes the endpoint's cost predictable.
 *
 * WHY sorting uses an allow-list (`@IsIn`) rather than "any field name": a
 * client-chosen field name passed into a query is both a crash waiting to
 * happen and a way to sort by columns you never meant to expose.
 */
export class ListTasksQueryDto extends TaskFilterDto {
  // `@Type(() => Number)` converts "3" -> 3 explicitly, so these fields work
  // whatever the global pipe's conversion settings are.
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

  @IsOptional()
  @IsIn(TASK_SORT_FIELDS)
  @ApiPropertyOptional({ enum: [...TASK_SORT_FIELDS], default: 'createdAt' })
  sortBy: TaskSortField = 'createdAt';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  sortOrder: 'asc' | 'desc' = 'desc';

  /** Restrict to one column of the board. */
  @IsOptional()
  @IsUUID()
  @ApiPropertyOptional({ format: 'uuid', description: 'Only tasks in this column.' })
  columnId?: string;
}
