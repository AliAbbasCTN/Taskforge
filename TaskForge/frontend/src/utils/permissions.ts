import type { MembershipRole, ProjectRole } from '../types/api';

/**
 * WHAT: Decides which BUTTONS to show. These are UI hints only.
 *
 * !! The server is the ONLY authority. !! Hiding a button does not stop
 * anyone: a user can open the browser's dev tools and send any request they
 * like. Every rule here is enforced again, independently, by the backend's
 * guards (Phases 04-08) - and the backend would answer 403/404 even if this
 * file said "yes". We mirror the rules here purely so people aren't offered
 * actions that will fail.
 *
 * The rules mirror `PROJECT_ROLE_PERMISSIONS` and the org-wide oversight rule
 * (`OrganizationProjectsManageAny`) in the backend.
 */

/** Org ADMIN and MANAGER oversee every project in their organization. */
export function hasOrgOversight(orgRole: MembershipRole | undefined): boolean {
  return orgRole === 'ADMIN' || orgRole === 'MANAGER';
}

/** May manage the project itself and its boards/columns (project LEAD, or org oversight). */
export function canManageProject(
  orgRole: MembershipRole | undefined,
  projectRole: ProjectRole | null | undefined,
): boolean {
  return hasOrgOversight(orgRole) || projectRole === 'LEAD';
}

/** May create/move tasks (any project member, or org oversight). */
export function canWriteTasks(
  orgRole: MembershipRole | undefined,
  projectRole: ProjectRole | null | undefined,
): boolean {
  return hasOrgOversight(orgRole) || projectRole === 'LEAD' || projectRole === 'MEMBER';
}
