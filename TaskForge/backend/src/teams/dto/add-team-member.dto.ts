import { IsEmail, IsEnum, IsOptional } from 'class-validator';
import { TeamRole } from '@prisma/client';

/**
 * WHAT: The validated shape for `POST /organizations/:id/teams/:teamId/members`.
 *
 * WHY email, not a user ID: same reasoning as `AddMemberDto` for
 * organizations - a team lead identifies people by email, not internal UUID.
 *
 * WHY this can still fail with 422: the target account must already be a
 * MEMBER of the team's organization before it can be added to one of that
 * organization's teams. See `TeamsService.addMember()`.
 */
export class AddTeamMemberDto {
  @IsEmail()
  email!: string;

  @IsOptional()
  @IsEnum(TeamRole)
  role?: TeamRole;
}
