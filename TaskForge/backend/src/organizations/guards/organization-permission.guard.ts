import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Permission } from '../../common/authorization/permission.enum';
import { organizationRoleHasPermission } from '../../common/authorization/organization-permissions';
import { PERMISSION_METADATA_KEY } from '../../common/authorization/require-permission.decorator';
import { RequestMembership } from '../decorators/current-membership.decorator';

/**
 * WHAT: Requires the current user's ORGANIZATION role to grant whatever
 * `Permission` the route declares via `@RequirePermission(...)`.
 *
 * WHY this replaces Phase 04's `OrganizationAdminGuard`: that guard only
 * ever checked one hardcoded thing - "is this person ADMIN?" - which meant
 * every admin-only route required the exact same permission, with no way
 * to express "this route needs X, that route needs Y" without writing a
 * brand new guard class for each variant. This guard reads what's actually
 * required off the route's metadata instead, so `organization-permissions.ts`
 * is the only place role -> capability decisions live.
 *
 * WHY 403, not 404, here: unchanged reasoning from Phase 04 -
 * `OrganizationMembershipGuard` already ran first and confirmed the
 * requester is a member, so the organization's existence and their
 * membership in it are no longer secret from them. Denying a specific
 * action they lack permission for is accurately a 403.
 *
 * WHERE: Applied via `@UseGuards(OrganizationMembershipGuard,
 * OrganizationPermissionGuard)` alongside `@RequirePermission(...)` on any
 * organization route that isn't open to every member. Must run after
 * `OrganizationMembershipGuard`, since it reads `request.membership`.
 */
@Injectable()
export class OrganizationPermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.get<Permission>(
      PERMISSION_METADATA_KEY,
      context.getHandler(),
    );

    // A route protected by this guard but missing @RequirePermission(...) is
    // a configuration mistake, not a legitimate "no restriction" case - fail
    // closed rather than silently allowing everyone through.
    if (!required) {
      throw new ForbiddenException(
        'This route is missing a required permission declaration',
      );
    }

    const request = context.switchToHttp().getRequest();
    const membership: RequestMembership | undefined = request.membership;

    if (
      !membership ||
      !organizationRoleHasPermission(membership.role, required)
    ) {
      throw new ForbiddenException(
        `This action requires the '${required}' permission`,
      );
    }

    return true;
  }
}
