import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

/** WHAT: The validated shape for `PATCH /organizations/:id/teams/:teamId`. */
export class UpdateTeamDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(150)
  name!: string;
}
