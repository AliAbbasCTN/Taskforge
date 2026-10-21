import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';
import { trimString } from '../../common/utils/trim-string';

/**
 * WHAT: The validated shape for creating a label.
 *
 * WHY the colour is a strict `#RRGGBB` pattern: the value is later placed in
 * a `style` attribute by the frontend. Accepting arbitrary text there would be
 * a way to inject CSS. Validating to exactly seven hex-ish characters means
 * the stored value can only ever be a colour.
 */
export class CreateLabelDto {
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  @ApiProperty({ example: 'Bug', maxLength: 50 })
  name!: string;

  @IsString()
  @Matches(/^#[0-9a-fA-F]{6}$/, {
    message: 'color must be a hex colour like #2f4bdb',
  })
  @ApiProperty({ example: '#e03131', pattern: '^#[0-9a-fA-F]{6}$', description: 'Hex colour, #RRGGBB.' })
  color!: string;
}
