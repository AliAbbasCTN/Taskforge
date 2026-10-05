import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { TaskPriority } from '@prisma/client';
import { trimString } from '../../common/utils/trim-string';

/**
 * WHAT: The validated shape for `PATCH .../tasks/:taskId`.
 *
 * Every field is optional ("change only what I send"), and three of them can
 * be CLEARED by sending `null`: `description`, `dueDate` and `assigneeId`.
 * That is why they are typed `string | null`.
 *   - omitted  -> leave unchanged
 *   - null     -> clear it
 * `@IsOptional()` treats both `undefined` and `null` as "skip the other
 * validators", which is exactly the behaviour we want here.
 *
 * Moving a task between columns is deliberately NOT done here - see
 * `MoveTaskDto` and `POST .../tasks/:taskId/move`.
 */
export class UpdateTaskDto {
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(5000)
  description?: string | null;

  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;

  @IsOptional()
  @IsDateString()
  dueDate?: string | null;

  @IsOptional()
  @IsUUID()
  assigneeId?: string | null;
}
