import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../database/prisma.service';
import { Permission } from '../../common/authorization/permission.enum';
import { organizationRoleHasPermission } from '../../common/authorization/organization-permissions';
import { teamRoleHasPermission } from '../../common/authorization/team-permissions';
import { PERMISSION_METADATA_KEY } from '../../common/authorization/require-permission.decorator';
import { RequestMembership } from '../../organizations/decorators/current-membership.decorator';

/**
 * WHAT: Requires the current user to have whatever `Permission` the route
 * declares, on the team already attached to the request by `TeamGuard` -
 * granted EITHER by their role on that specific team, OR by holding
 * organization-wide team oversight (`Permission.OrganizationTeamsManageAny`
 * - currently ADMIN and MANAGER).
 *
 * WHY this replaces Phase 05's `TeamLeadGuard`: that guard only ever
 * checked "is this person the LEAD of this specific team?" - which meant an
 * organization ADMIN had no way to manage a team they didn't personally
 * lead, a limitation Phase 05's own docs flagged as a deliberate, temporary
 * gap. This guard closes it: an ADMIN or MANAGER can now manage ANY team in
 * their organization, without needing to be added to it.
 *
 * WHY check the organization-level override FIRST, before querying team
 * membership: it's a cheaper check (the org role is already sitting on
 * `request.membership`, attached by `OrganizationMembershipGuard` - no
 * extra query needed) and it's the common case for an ADMIN/MANAGER acting
 * org-wide, so short-circuiting there avoids an unnecessary
 * `teamMembership.findUnique()` call.
 *
 * WHERE: Applied via `@UseGuards(TeamGuard, TeamPermissionGuard)` alongside
 * `@RequirePermission(...)` on team mutation routes. Must run after both
 * `OrganizationMembershipGuard` (reads `request.membership`) and `TeamGuard`
 * (reads `request.team`).
 */
@Injectable()
export class TeamPermissionGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.get<Permission>(
      PERMISSION_METADATA_KEY,
      context.getHandler(),
    );

    if (!required) {
      throw new ForbiddenException(
        'This route is missing a required permission declaration',
      );
    }

    const request = context.switchToHttp().getRequest();
    const team = request.team;
    const orgMembership: RequestMembership | undefined = request.membership;
    const userId: string | undefined = request.user?.id;

    if (!team || !orgMembership || !userId) {
      throw new ForbiddenException(
        'This action requires team management permissions',
      );
    }

    // Path 1: organization-wide override (ADMIN or MANAGER) - no need to
    // even be a member of this specific team.
    if (
      organizationRoleHasPermission(
        orgMembership.role,
        Permission.OrganizationTeamsManageAny,
      )
    ) {
      return true;
    }

    // Path 2: the user's own role on THIS team.
    const teamMembership = await this.prisma.teamMembership.findUnique({
      where: { userId_teamId: { userId, teamId: team.id } },
    });

    if (
      teamMembership &&
      teamRoleHasPermission(teamMembership.role, required)
    ) {
      request.teamMembership = teamMembership;
      return true;
    }

    throw new ForbiddenException(
      `This action requires the '${required}' permission on this team, or organization admin/manager permissions`,
    );
  }
}
