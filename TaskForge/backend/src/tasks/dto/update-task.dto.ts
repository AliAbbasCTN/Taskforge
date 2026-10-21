import { ApiPropertyOptional } from '@nestjs/swagger';
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
  @ApiPropertyOptional({ example: 'Fix login redirect (Safari)', maxLength: 200 })
  title?: string;

  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(5000)
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: 5000,
    description: 'Send null to clear it.',
  })
  description?: string | null;

  @IsOptional()
  @IsEnum(TaskPriority)
  @ApiPropertyOptional({ enum: TaskPriority, enumName: 'TaskPriority' })
  priority?: TaskPriority;

  @IsOptional()
  @IsDateString()
  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    nullable: true,
    example: '2026-11-01T00:00:00.000Z',
    description: 'ISO 8601. Send null to clear it.',
  })
  dueDate?: string | null;

  @IsOptional()
  @IsUUID()
  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'A project member. Send null to unassign.',
  })
  assigneeId?: string | null;
}
