import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

/** WHAT: The validated shape for `PATCH /organizations/:id/teams/:teamId`. */
export class UpdateTeamDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(150)
  @ApiProperty({ example: 'Platform Engineering', minLength: 2, maxLength: 150 })
  name!: string;
}
