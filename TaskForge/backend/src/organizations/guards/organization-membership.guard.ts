import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { isUuid } from '../../common/utils/is-uuid';

/**
 * WHAT: The guard that enforces TaskForge's core tenant-isolation rule -
 * a user may only access an organization's data if a Membership row exists
 * connecting them to it.
 *
 * WHY this is a guard, not something checked inside each service method:
 * putting it here means it's impossible to add a new `/organizations/:id/...`
 * route and forget the check - it runs before the route handler even
 * executes, for every route it's applied to. A check duplicated inside
 * every service method is a check that's one missed copy-paste away from a
 * real data leak.
 *
 * WHY 404, not 403, for a non-member: returning 403 Forbidden confirms the
 * organization ID exists but you're not allowed to see it - which itself
 * leaks information (organization IDs could be guessed/enumerated, and a
 * 403 vs 404 difference tells an attacker which guesses are "real"). A 404
 * is indistinguishable from the organization simply not existing at all.
 *
 * WHERE: Applied via `@UseGuards(JwtAuthGuard, OrganizationMembershipGuard)`
 * on every route under `/organizations/:id`. It MUST run after
 * `JwtAuthGuard`, since it reads `request.user` (populated by the JWT
 * strategy) to know who's asking.
 *
 * HOW: Reads the `:id` route parameter, looks up a Membership row for
 * (organizationId, userId), and - if found - attaches it to
 * `request.membership` so downstream guards (`OrganizationAdminGuard`) and
 * route handlers (via the `@CurrentMembership()` decorator) can read the
 * user's role without a second database query.
 */
@Injectable()
export class OrganizationMembershipGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const organizationId: string | undefined = request.params?.id;
    const userId: string | undefined = request.user?.id;

    // Missing params/user means something upstream is misconfigured (e.g.
    // this guard applied to a route with no `:id`, or applied before
    // JwtAuthGuard) - fail closed rather than silently passing. A malformed
    // ID is rejected here too (as "not found") because guards run BEFORE
    // `ParseUUIDPipe`, so without this check the raw string would reach the
    // database - see `isUuid`.
    if (!isUuid(organizationId) || !userId) {
      throw new NotFoundException('Organization not found');
    }

    const membership = await this.prisma.membership.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
    });

    if (!membership) {
      throw new NotFoundException('Organization not found');
    }

    request.membership = membership;
    return true;
  }
}
