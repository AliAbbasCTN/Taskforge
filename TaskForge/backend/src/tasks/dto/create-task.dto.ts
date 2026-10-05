import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { TaskPriority } from '@prisma/client';
import { trimString } from '../../common/utils/trim-string';

/**
 * WHAT: The validated shape for `POST .../boards/:boardId/tasks`.
 *
 * WHY `columnId` is in the body, not the URL: a task is created ON a board,
 * and the column is the choice the client is making ("add this to In
 * Progress"). The service verifies that column belongs to this board.
 *
 * `position` is a zero-based index within the column; omit it to add the
 * task at the bottom. `dueDate` is an ISO 8601 date or date-time string.
 */
export class CreateTaskDto {
  @IsUUID()
  columnId!: string;

  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsUUID()
  assigneeId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;
}
