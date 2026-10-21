import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
  @ApiProperty({
    format: 'uuid',
    description: 'The column to create the task in. Must belong to this board.',
  })
  columnId!: string;

  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  @ApiProperty({ example: 'Fix login redirect', maxLength: 200 })
  title!: string;

  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(5000)
  @ApiPropertyOptional({ example: 'Users land on a blank page.', maxLength: 5000 })
  description?: string;

  @IsOptional()
  @IsEnum(TaskPriority)
  @ApiPropertyOptional({
    enum: TaskPriority,
    enumName: 'TaskPriority',
    default: TaskPriority.MEDIUM,
  })
  priority?: TaskPriority;

  @IsOptional()
  @IsDateString()
  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    example: '2026-11-01T00:00:00.000Z',
    description: 'ISO 8601 date or date-time.',
  })
  dueDate?: string;

  @IsOptional()
  @IsUUID()
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Must be a member of the project.',
  })
  assigneeId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @ApiPropertyOptional({
    minimum: 0,
    description: 'Zero-based index in the column. Omit to add at the bottom.',
  })
  position?: number;
}
