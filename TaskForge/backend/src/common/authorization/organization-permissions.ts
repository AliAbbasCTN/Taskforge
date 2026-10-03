import { MembershipRole } from '@prisma/client';
import { Permission } from './permission.enum';

/**
 * WHAT: The single source of truth for what each organization role can do.
 *
 * WHY ADMIN and MANAGER now diverge, when Phase 04 treated them
 * identically: this is the concrete change this phase makes. ADMIN keeps
 * full control - organization settings AND membership AND every team.
 * MANAGER gets organization-wide team oversight (can manage any team, even
 * ones they don't personally lead) but CANNOT change organization settings
 * or add/remove/promote organization members. This is a deliberate,
 * defensible split: a MANAGER runs the day-to-day team structure, but
 * membership and billing-adjacent settings stay admin-only.
 *
 * PHASE 07: `OrganizationProjectsManageAny` is granted to ADMIN and MANAGER,
 * mirroring `OrganizationTeamsManageAny` exactly. It does double duty for
 * projects: it lets them SEE every project in the organization (projects
 * are otherwise visible only to their own members) and MANAGE any of them.
 * Without it, a project whose only member left would be invisible to
 * everyone and impossible to clean up.
 *
 * WHY MEMBER has an empty list here: a plain organization member has no
 * organization-wide permissions at all. Their only authority comes from
 * roles they hold on individual Teams (see `team-permissions.ts`) - being
 * an org MEMBER only grants visibility (enforced by
 * `OrganizationMembershipGuard`), not any management capability.
 */
export const ORGANIZATION_ROLE_PERMISSIONS: Record<
  MembershipRole,
  Permission[]
> = {
  [MembershipRole.ADMIN]: [
    Permission.OrganizationManage,
    Permission.OrganizationMembersManage,
    Permission.OrganizationTeamsManageAny,
    Permission.OrganizationProjectsManageAny,
  ],
  [MembershipRole.MANAGER]: [
    Permission.OrganizationTeamsManageAny,
    Permission.OrganizationProjectsManageAny,
  ],
  [MembershipRole.MEMBER]: [],
};

export function organizationRoleHasPermission(
  role: MembershipRole,
  permission: Permission,
): boolean {
  return ORGANIZATION_ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}
