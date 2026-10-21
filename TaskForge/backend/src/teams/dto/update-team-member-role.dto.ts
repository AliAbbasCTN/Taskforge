import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { TeamRole } from '@prisma/client';

/** WHAT: The validated shape for `PATCH /organizations/:id/teams/:teamId/members/:userId`. */
export class UpdateTeamMemberRoleDto {
  @IsEnum(TeamRole)
  @ApiProperty({ enum: TeamRole, enumName: 'TeamRole' })
  role!: TeamRole;
}
