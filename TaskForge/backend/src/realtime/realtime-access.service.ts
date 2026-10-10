import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { Permission } from '../common/authorization/permission.enum';
import { organizationRoleHasPermission } from '../common/authorization/organization-permissions';

/**
 * WHAT: "May this user watch this project live?" - the socket equivalent of
 * the HTTP `OrganizationMembershipGuard` + `ProjectGuard` pair.
 *
 * The answer is exactly the visibility rule from Phase 07: the user must be a
 * member of the project's ORGANIZATION, and then either be a member of the
 * PROJECT or hold organization-wide oversight (ADMIN/MANAGER). Anything else
 * - unknown project, other organization, private project they're not on - is
 * simply "no".
 *
 * WHY it is re-checked from the database every time rather than remembered:
 * permissions change while a socket is open (someone is removed from a
 * project, demoted, or leaves the organization). `RealtimeService.revalidate`
 * calls this again to find out who must be removed from which room.
 */
@Injectable()
export class RealtimeAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async canAccessProject(userId: string, projectId: string): Promise<boolean> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: {
        organizationId: true,
        memberships: { where: { userId }, select: { id: true }, take: 1 },
      },
    });
    if (!project) {
      return false;
    }

    const orgMembership = await this.prisma.membership.findUnique({
      where: {
        userId_organizationId: {
          userId,
          organizationId: project.organizationId,
        },
      },
      select: { role: true },
    });
    if (!orgMembership) {
      return false;
    }

    if (project.memberships.length > 0) {
      return true;
    }
    return organizationRoleHasPermission(
      orgMembership.role,
      Permission.OrganizationProjectsManageAny,
    );
  }
}
