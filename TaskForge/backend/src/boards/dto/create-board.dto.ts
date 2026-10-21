import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';
import { trimString } from '../../common/utils/trim-string';

/** WHAT: The validated shape for creating or renaming a board. */
export class CreateBoardDto {
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(150)
  @ApiProperty({ example: 'Sprint 12', minLength: 2, maxLength: 150 })
  name!: string;
}
