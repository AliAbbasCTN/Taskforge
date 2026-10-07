/**
 * WHAT: Every distinct, gate-able action in TaskForge, as a flat enum of
 * string constants.
 *
 * WHY a flat list of named permissions, rather than checking roles directly
 * in guards (`if (role !== 'ADMIN')`, as Phases 04/05 did): a permission
 * name describes WHAT is being protected ("organization:manage"), not WHO
 * currently happens to be allowed to do it. That separation is the whole
 * point of RBAC. It means:
 *   - A route only ever needs to say "this requires organization:manage" -
 *     it never needs to know or care which roles currently grant that.
 *   - Changing who can do something (e.g. deciding MANAGER should be able
 *     to rename organizations after all) becomes a one-line change to the
 *     role -> permission mapping (see `organization-permissions.ts`), not a
 *     hunt through every controller for a hardcoded role comparison.
 *   - It scales to new roles cleanly. Phase 04 shipped `MANAGER` in the
 *     schema with no distinct behaviour, explicitly deferred to this phase.
 *     This is where it finally does something.
 *
 * WHERE: Read by `RequirePermission()` (the decorator applied to routes)
 * and by the two permission guards that check a membership's role against
 * these names.
 */
export enum Permission {
  // Organization-level
  OrganizationManage = 'organization:manage',
  OrganizationMembersManage = 'organization:members:manage',
  /** Grants org-wide override power over EVERY team in the organization,
   * regardless of personal team membership - see `TeamPermissionGuard`. */
  OrganizationTeamsManageAny = 'organization:teams:manage-any',
  /** Grants org-wide oversight of EVERY project in the organization -
   * seeing it AND managing it - regardless of personal project membership.
   * See `ProjectGuard` and `ProjectPermissionGuard`. */
  OrganizationProjectsManageAny = 'organization:projects:manage-any',

  // Team-level
  TeamManage = 'team:manage',
  TeamMembersManage = 'team:members:manage',

  // Project-level
  ProjectManage = 'project:manage',
  ProjectMembersManage = 'project:members:manage',
  /** Change a project's STRUCTURE: boards, columns and the project's label set. */
  ProjectBoardsManage = 'project:boards:manage',
  /** Change a project's CONTENT: create, edit, move, assign, delete tasks. */
  ProjectTasksWrite = 'project:tasks:write',
}
