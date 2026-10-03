import { ProjectRole } from '@prisma/client';
import { Permission } from './permission.enum';

/**
 * WHAT: The single source of truth for what each project role can do.
 *
 * WHY MEMBER has an empty list: exactly like `TEAM_ROLE_PERMISSIONS` and
 * `ORGANIZATION_ROLE_PERMISSIONS`, being a plain member grants no
 * MANAGEMENT permission - it only grants visibility, which comes from the
 * membership row existing at all (see `ProjectGuard`), not from this table.
 * Everything a member does INSIDE a project (boards, tasks) arrives in
 * Phase 08 and will get its own permissions then; this table deliberately
 * covers only what exists today.
 *
 * WHY LEAD holds both permissions: same reasoning as `TEAM_ROLE_PERMISSIONS`
 * - no current scenario needs "can manage members but not rename the
 * project". The table shape means a future role only needs a new entry
 * here, not a rewrite of every guard.
 */
export const PROJECT_ROLE_PERMISSIONS: Record<ProjectRole, Permission[]> = {
  [ProjectRole.LEAD]: [
    Permission.ProjectManage,
    Permission.ProjectMembersManage,
  ],
  [ProjectRole.MEMBER]: [],
};

export function projectRoleHasPermission(
  role: ProjectRole,
  permission: Permission,
): boolean {
  return PROJECT_ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}
