import { ProjectRole } from '@prisma/client';
import { Permission } from './permission.enum';

/**
 * WHAT: The single source of truth for what each project role can do.
 *
 * PHASE 08 splits "working in a project" into two permissions on purpose:
 *   - `ProjectTasksWrite` (CONTENT): create, edit, move, assign and delete
 *     tasks. Held by LEAD and MEMBER - the people doing the work.
 *   - `ProjectBoardsManage` (STRUCTURE): create/rename/delete boards and
 *     columns. LEAD only - restructuring the workflow affects everyone on
 *     the project, so it isn't left to every contributor.
 * Reading a project's boards and tasks needs no permission here: visibility
 * comes from the membership row existing at all (see `ProjectGuard`), not
 * from this table - exactly as in Phases 05-07.
 *
 * WHY LEAD holds every permission, MEMBER only task writes: same table shape
 * as `TEAM_ROLE_PERMISSIONS`; a future role (say a read-only VIEWER) is just
 * a new entry, not a rewrite of every guard.
 */
export const PROJECT_ROLE_PERMISSIONS: Record<ProjectRole, Permission[]> = {
  [ProjectRole.LEAD]: [
    Permission.ProjectManage,
    Permission.ProjectMembersManage,
    Permission.ProjectBoardsManage,
    Permission.ProjectTasksWrite,
  ],
  [ProjectRole.MEMBER]: [Permission.ProjectTasksWrite],
};

export function projectRoleHasPermission(
  role: ProjectRole,
  permission: Permission,
): boolean {
  return PROJECT_ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}
