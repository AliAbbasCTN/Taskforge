import { TeamRole } from '@prisma/client';
import { Permission } from './permission.enum';

/**
 * WHAT: The single source of truth for what each team role can do.
 *
 * WHY LEAD is granted both TeamManage and TeamMembersManage identically
 * (they weren't split, unlike the organization roles above): Phase 05 had
 * one undifferentiated "team lead" capability, and there's no current
 * scenario requiring a role that can manage members but not rename/delete
 * the team (or vice versa). Structuring it as a table of permissions,
 * rather than a single boolean "isLead" check, costs nothing today and
 * means a future role (e.g. a "co-lead" who can manage membership but not
 * delete the team) would only need a new entry here - not a rewrite of
 * every guard and route that currently checks team permissions.
 */
export const TEAM_ROLE_PERMISSIONS: Record<TeamRole, Permission[]> = {
  [TeamRole.LEAD]: [Permission.TeamManage, Permission.TeamMembersManage],
  [TeamRole.MEMBER]: [],
};

export function teamRoleHasPermission(
  role: TeamRole,
  permission: Permission,
): boolean {
  return TEAM_ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}
