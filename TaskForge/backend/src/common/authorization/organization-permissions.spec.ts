import { MembershipRole } from '@prisma/client';
import { Permission } from './permission.enum';
import { organizationRoleHasPermission } from './organization-permissions';

/**
 * UNIT tests for the pure permission-lookup logic - no HTTP, no database,
 * no guards involved. These exist because this table IS the single source
 * of truth for who-can-do-what at the organization level; every guard and
 * e2e test ultimately depends on it being correct.
 */
describe('organizationRoleHasPermission', () => {
  it('ADMIN can manage the organization, its members, and any team', () => {
    expect(
      organizationRoleHasPermission(
        MembershipRole.ADMIN,
        Permission.OrganizationManage,
      ),
    ).toBe(true);
    expect(
      organizationRoleHasPermission(
        MembershipRole.ADMIN,
        Permission.OrganizationMembersManage,
      ),
    ).toBe(true);
    expect(
      organizationRoleHasPermission(
        MembershipRole.ADMIN,
        Permission.OrganizationTeamsManageAny,
      ),
    ).toBe(true);
  });

  it('MANAGER can manage any team, but NOT the organization or its members', () => {
    expect(
      organizationRoleHasPermission(
        MembershipRole.MANAGER,
        Permission.OrganizationTeamsManageAny,
      ),
    ).toBe(true);
    expect(
      organizationRoleHasPermission(
        MembershipRole.MANAGER,
        Permission.OrganizationManage,
      ),
    ).toBe(false);
    expect(
      organizationRoleHasPermission(
        MembershipRole.MANAGER,
        Permission.OrganizationMembersManage,
      ),
    ).toBe(false);
  });

  it('ADMIN and MANAGER can oversee every project; MEMBER cannot', () => {
    expect(
      organizationRoleHasPermission(
        MembershipRole.ADMIN,
        Permission.OrganizationProjectsManageAny,
      ),
    ).toBe(true);
    expect(
      organizationRoleHasPermission(
        MembershipRole.MANAGER,
        Permission.OrganizationProjectsManageAny,
      ),
    ).toBe(true);
    expect(
      organizationRoleHasPermission(
        MembershipRole.MEMBER,
        Permission.OrganizationProjectsManageAny,
      ),
    ).toBe(false);
  });

  it('MEMBER has no organization-level permissions at all', () => {
    expect(
      organizationRoleHasPermission(
        MembershipRole.MEMBER,
        Permission.OrganizationManage,
      ),
    ).toBe(false);
    expect(
      organizationRoleHasPermission(
        MembershipRole.MEMBER,
        Permission.OrganizationMembersManage,
      ),
    ).toBe(false);
    expect(
      organizationRoleHasPermission(
        MembershipRole.MEMBER,
        Permission.OrganizationTeamsManageAny,
      ),
    ).toBe(false);
  });
});
