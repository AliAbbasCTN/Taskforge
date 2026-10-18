import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from '../../common/pagination/pagination';
import { TaskFilterDto } from '../../tasks/dto/task-filter.dto';

export const TASK_SEARCH_SORT_FIELDS = [
  'relevance',
  'createdAt',
  'dueDate',
  'priority',
  'title',
] as const;
export type TaskSearchSortField = (typeof TASK_SEARCH_SORT_FIELDS)[number];

/** Longest search text accepted: plenty for a query, and bounds the work done. */
export const MAX_SEARCH_TERM_LENGTH = 100;

/**
 * WHAT: The query string for `GET .../projects/:projectId/search/tasks`.
 *
 * It reuses the SAME filters as the board and list views (`TaskFilterDto`:
 * priority, assignee, label, overdue) and the same paging rules, adding the
 * search text and two scoping options. Search and filters combine with AND:
 * "tasks about *login* that are HIGH priority and overdue".
 *
 * `sortBy=relevance` (the default) ranks the best text matches first and
 * ignores `sortOrder`; every other sort is a plain column sort.
 */
export class SearchTasksQueryDto extends TaskFilterDto {
  /** What to search for. Trimmed; an all-whitespace value is rejected. */
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_SEARCH_TERM_LENGTH)
  q!: string;

  /** Restrict to one board of the project. */
  @IsOptional()
  @IsUUID()
  boardId?: string;

  /** Restrict to one column. */
  @IsOptional()
  @IsUUID()
  columnId?: string;

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

  @IsOptional()
  @IsIn(TASK_SEARCH_SORT_FIELDS)
  sortBy: TaskSearchSortField = 'relevance';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder: 'asc' | 'desc' = 'desc';
}
