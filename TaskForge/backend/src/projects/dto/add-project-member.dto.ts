import { IsEmail, IsEnum, IsOptional } from 'class-validator';
import { ProjectRole } from '@prisma/client';

/**
 * WHAT: The validated shape for `POST /organizations/:id/projects/:projectId/members`.
 *
 * WHY email, not a user ID: same reasoning as `AddMemberDto` and
 * `AddTeamMemberDto` - people are identified by email, not internal UUID.
 *
 * WHY this can still fail with 422: the target account must already be a
 * member of the project's organization. See `ProjectsService.addMember()`.
 */
export class AddProjectMemberDto {
  @IsEmail()
  email!: string;

  @IsOptional()
  @IsEnum(ProjectRole)
  role?: ProjectRole;
}
