import { IsEnum } from 'class-validator';
import { MembershipRole } from '@prisma/client';

/** WHAT: The validated shape for `PATCH /organizations/:id/members/:userId`. */
export class UpdateMemberRoleDto {
  @IsEnum(MembershipRole)
  role!: MembershipRole;
}
