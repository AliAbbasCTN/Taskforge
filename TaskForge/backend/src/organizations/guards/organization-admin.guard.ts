import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { RequestMembership } from '../decorators/current-membership.decorator';

/**
 * WHAT: A guard requiring the current user's role in this organization to
 * be ADMIN.
 *
 * WHY 403, not 404, here (unlike `OrganizationMembershipGuard`): by the time
 * this guard runs, the user has already been confirmed as a member of the
 * organization - the organization's existence and their membership in it
 * are no longer secret from them. What's being denied is a specific action,
 * not knowledge that the resource exists, so 403 Forbidden is the accurate,
 * non-leaking response here.
 *
 * WHERE: Applied via
 * `@UseGuards(JwtAuthGuard, OrganizationMembershipGuard, OrganizationAdminGuard)`
 * on routes only an organization admin should use (updating the
 * organization, adding/removing members, changing roles). It MUST run
 * after `OrganizationMembershipGuard`, since it reads `request.membership`.
 *
 * NOTE: This is deliberately a narrow, single-purpose guard rather than a
 * general-purpose "RolesGuard" with a `@Roles(...)` decorator. A fully
 * generalized role-checking system belongs to Phase 06 (RBAC), once there
 * are more roles with actually-distinct permissions to check. Building that
 * generalization now, for a single ADMIN-vs-everyone-else check, would be
 * exactly the kind of premature abstraction this project's conventions
 * warn against.
 */
@Injectable()
export class OrganizationAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const membership: RequestMembership | undefined = request.membership;

    if (!membership || membership.role !== 'ADMIN') {
      throw new ForbiddenException(
        'This action requires organization admin permissions',
      );
    }

    return true;
  }
}
