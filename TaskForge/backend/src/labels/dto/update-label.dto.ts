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
  name?: string;

  @IsOptional()
  @IsString()
  @Matches(/^#[0-9a-fA-F]{6}$/, {
    message: 'color must be a hex colour like #2f4bdb',
  })
  color?: string;
}
