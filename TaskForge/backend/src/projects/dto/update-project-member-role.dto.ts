import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { ProjectRole } from '@prisma/client';

/** WHAT: The validated shape for `PATCH /organizations/:id/projects/:projectId/members/:userId`. */
export class UpdateProjectMemberRoleDto {
  @IsEnum(ProjectRole)
  @ApiProperty({ enum: ProjectRole, enumName: 'ProjectRole' })
  role!: ProjectRole;
}
