import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ProjectMembership } from '@prisma/client';
import { Permission } from '../../common/authorization/permission.enum';
import { canActOnProject } from '../../common/authorization/project-access';
import { PERMISSION_METADATA_KEY } from '../../common/authorization/require-permission.decorator';
import { RequestMembership } from '../../organizations/decorators/current-membership.decorator';

/**
 * WHAT: Requires the current user to hold whatever `Permission` the route
 * declares via `@RequirePermission(...)`, on the project `ProjectGuard`
 * already attached to the request - granted EITHER by their role on that
 * project OR by organization-wide oversight
 * (`Permission.OrganizationProjectsManageAny`: ADMIN and MANAGER).
 *
 * WHY this is the third link in a deliberate chain:
 *   `OrganizationMembershipGuard` -> "are you in this organization?" (404)
 *   `ProjectGuard`                -> "may you see this project?"     (404)
 *   `ProjectPermissionGuard`      -> "may you do THIS to it?"         (403)
 * Each guard answers exactly one question and relies on the previous one
 * having passed. Because visibility is checked before permission, a
 * stranger probing a project ID gets a 404 on every route, never a 403 that
 * would reveal the project exists.
 *
 * WHY no database query here, unlike `TeamPermissionGuard`: `ProjectGuard`
 * already loaded the user's project membership in the same query that
 * loaded the project, so this guard is a pure in-memory check on
 * `request.projectMembership`.
 *
 * WHY check the org-wide override first: it is the cheaper, more general
 * path, and it is what lets an ADMIN/MANAGER manage a project that has no
 * remaining lead (for example after its lead left the organization).
 */
@Injectable()
export class ProjectPermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.get<Permission>(
      PERMISSION_METADATA_KEY,
      context.getHandler(),
    );

    // A route behind this guard with no @RequirePermission is a
    // configuration mistake - fail closed, never silently allow.
    if (!required) {
      throw new ForbiddenException(
        'This route is missing a required permission declaration',
      );
    }

    const request = context.switchToHttp().getRequest();
    const project = request.project;
    const orgMembership: RequestMembership | undefined = request.membership;
    const projectMembership: ProjectMembership | null | undefined =
      request.projectMembership;

    if (!project || !orgMembership) {
      throw new ForbiddenException(
        'This action requires project management permissions',
      );
    }

    // Organization-wide oversight (ADMIN/MANAGER) or the user's own role on
    // THIS project - one shared rule, see `canActOnProject`.
    if (
      canActOnProject(orgMembership.role, projectMembership?.role, required)
    ) {
      return true;
    }

    throw new ForbiddenException(
      `This action requires the '${required}' permission on this project, or organization admin/manager permissions`,
    );
  }
}
