import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';
import { trimString } from '../../common/utils/trim-string';

/** WHAT: The validated shape for `PATCH .../boards/:boardId`. */
export class UpdateBoardDto {
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(150)
  name!: string;
}
