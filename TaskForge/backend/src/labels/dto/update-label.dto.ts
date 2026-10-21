import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { trimString } from '../../common/utils/trim-string';

/** WHAT: The validated shape for `PATCH .../labels/:labelId` - rename, recolour, or both. */
export class UpdateLabelDto {
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  @ApiPropertyOptional({ example: 'Defect', maxLength: 50 })
  name?: string;

  @IsOptional()
  @IsString()
  @Matches(/^#[0-9a-fA-F]{6}$/, {
    message: 'color must be a hex colour like #2f4bdb',
  })
  @ApiPropertyOptional({ example: '#2f4bdb', pattern: '^#[0-9a-fA-F]{6}$', description: 'Hex colour, #RRGGBB.' })
  color?: string;
}
