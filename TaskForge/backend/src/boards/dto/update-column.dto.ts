import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { trimString } from '../../common/utils/trim-string';

/**
 * WHAT: The validated shape for `PATCH .../columns/:columnId` - rename,
 * reorder, or both. `ColumnsService.update()` rejects a body with neither.
 */
export class UpdateColumnDto {
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @ApiPropertyOptional({ example: 'Code Review', maxLength: 100 })
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @ApiPropertyOptional({
    minimum: 0,
    example: 0,
    description: 'Zero-based index to move the column to.',
  })
  position?: number;
}
