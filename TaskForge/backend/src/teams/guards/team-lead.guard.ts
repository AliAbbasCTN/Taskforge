import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

/**
 * WHAT: Requires the current user to hold the LEAD role on the team already
 * attached to the request by `TeamGuard`.
 *
 * WHY 403, not 404, here: by the time this guard runs, the requester
 * already knows the team exists (any org member can see it - see
 * `TeamGuard`). What's being denied is a specific mutation, not knowledge
 * that the resource exists, so 403 Forbidden is accurate here - same
 * reasoning as `OrganizationAdminGuard`.
 *
 * WHY this can ALSO fail for someone who isn't on the team at all, not just
 * a MEMBER of it: team membership isn't guaranteed just by organization
 * membership - unlike `OrganizationAdminGuard` (which only ever runs after
 * `OrganizationMembershipGuard` already confirmed a Membership row exists),
 * a user can be a full member of the organization while not being on this
 * particular Team at all. Both cases - "not on the team" and "on the team
 * but only MEMBER" - are denied identically.
 *
 * WHERE: Applied via `@UseGuards(..., TeamGuard, TeamLeadGuard)` on
 * mutation routes (rename, delete, add/remove/update members). Must run
 * after `TeamGuard`, since it reads `request.team`.
 */
@Injectable()
export class TeamLeadGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const team = request.team;
    const userId: string | undefined = request.user?.id;

    if (!team || !userId) {
      throw new ForbiddenException(
        'This action requires team lead permissions',
      );
    }

    const membership = await this.prisma.teamMembership.findUnique({
      where: { userId_teamId: { userId, teamId: team.id } },
    });

    if (!membership || membership.role !== 'LEAD') {
      throw new ForbiddenException(
        'This action requires team lead permissions',
      );
    }

    request.teamMembership = membership;
    return true;
  }
}
