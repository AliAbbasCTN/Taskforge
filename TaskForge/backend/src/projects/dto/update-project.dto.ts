import { Transform } from 'class-transformer';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { trimString } from '../../common/utils/trim-string';

/**
 * WHAT: The validated shape for `PATCH /organizations/:id/projects/:projectId`.
 *
 * Both fields are optional because PATCH means "change only what I send".
 * `ProjectsService.update()` rejects a body with neither field (400), since
 * a PATCH that changes nothing is almost certainly a client bug.
 *
 * To CLEAR a description, send `"description": ""` - it is stored as NULL.
 */
export class UpdateProjectDto {
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(150)
  name?: string;

  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(2000)
  description?: string;
}
