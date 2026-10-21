import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

/** WHAT: The validated shape for `POST /organizations/:id/teams`. */
export class CreateTeamDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(150)
  @ApiProperty({ example: 'Engineering', minLength: 2, maxLength: 150 })
  name!: string;
}
