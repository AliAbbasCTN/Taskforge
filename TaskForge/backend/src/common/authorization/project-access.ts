import { MembershipRole, ProjectRole } from '@prisma/client';
import { Permission } from './permission.enum';
import { organizationRoleHasPermission } from './organization-permissions';
import { projectRoleHasPermission } from './project-permissions';

/**
 * WHAT: "May a person with THIS organization role and THIS project role do
 * THIS to the project?" - as a plain function.
 *
 * WHY it exists: `ProjectPermissionGuard` answers that question for a whole
 * ROUTE, before the handler runs. Some rules can't be a route-level yes/no,
 * because the answer depends on the data: "you may delete a comment if you
 * wrote it, OR if you can moderate the project". The guard lets the request
 * in; the service then needs the same permission logic to decide the second
 * half. Putting it in one function means the guard and the service can never
 * drift apart.
 *
 * Organization-wide oversight (ADMIN/MANAGER) counts as holding every
 * project permission - the same rule the guard has always applied.
 */
export function canActOnProject(
  orgRole: MembershipRole,
  projectRole: ProjectRole | null | undefined,
  permission: Permission,
): boolean {
  if (
    organizationRoleHasPermission(
      orgRole,
      Permission.OrganizationProjectsManageAny,
    )
  ) {
    return true;
  }
  return projectRole
    ? projectRoleHasPermission(projectRole, permission)
    : false;
}
