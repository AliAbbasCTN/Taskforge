import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

/**
 * WHAT: Verifies that the `:teamId` in the route actually belongs to the
 * `:id` (organization) in the route, and attaches the team to the request.
 *
 * WHY this check matters even though `OrganizationMembershipGuard` already
 * confirmed the requester belongs to organization `:id`: without this,
 * nothing would stop someone from taking a real `teamId` that belongs to a
 * DIFFERENT organization (one they may not even be a member of) and
 * substituting it into a URL under an organization they legitimately
 * belong to - e.g. `/organizations/<my-org>/teams/<someone-elses-team-id>`.
 * This is a classic IDOR (Insecure Direct Object Reference) pattern: an
 * authorization check on one resource (the organization) being
 * insufficient for a *nested* resource (the team) whose ownership must be
 * independently verified.
 *
 * WHY 404, not 403: by design, any member of an organization can see every
 * team within THEIR OWN organization (teams aren't private sub-tenants).
 * A `teamId` that doesn't exist, or that belongs to a different
 * organization, is treated identically - 404 - so a request can't be used
 * to probe whether a given UUID is a valid team ID somewhere else on the
 * platform.
 *
 * WHERE: Applied via `@UseGuards(..., TeamGuard)` on every
 * `/organizations/:id/teams/:teamId...` route. Must run after
 * `OrganizationMembershipGuard`.
 */
@Injectable()
export class TeamGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const organizationId: string | undefined = request.params?.id;
    const teamId: string | undefined = request.params?.teamId;

    if (!organizationId || !teamId) {
      throw new NotFoundException('Team not found');
    }

    const team = await this.prisma.team.findUnique({ where: { id: teamId } });

    if (!team || team.organizationId !== organizationId) {
      throw new NotFoundException('Team not found');
    }

    request.team = team;
    return true;
  }
}
