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
 * WHAT: The validated shape for `POST /organizations/:id/projects`.
 *
 * Surrounding whitespace is trimmed before validation (see `trimString`),
 * so a name of three spaces is rejected rather than stored as a blank.
 */
export class CreateProjectDto {
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(150)
  name!: string;

  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(2000)
  description?: string;
}
