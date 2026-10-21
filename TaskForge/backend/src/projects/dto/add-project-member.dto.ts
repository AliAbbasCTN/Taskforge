import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
  @ApiProperty({
    example: 'grace@example.com',
    description: 'Must already be a member of the organization.',
  })
  email!: string;

  @IsOptional()
  @IsEnum(ProjectRole)
  @ApiPropertyOptional({
    enum: ProjectRole,
    enumName: 'ProjectRole',
    default: ProjectRole.MEMBER,
  })
  role?: ProjectRole;
}
