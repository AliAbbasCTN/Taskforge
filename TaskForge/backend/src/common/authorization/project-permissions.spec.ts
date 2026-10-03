import { ProjectRole } from '@prisma/client';
import { Permission } from './permission.enum';
import { projectRoleHasPermission } from './project-permissions';

describe('projectRoleHasPermission', () => {
  it('LEAD can manage the project and its members', () => {
    expect(
      projectRoleHasPermission(ProjectRole.LEAD, Permission.ProjectManage),
    ).toBe(true);
    expect(
      projectRoleHasPermission(
        ProjectRole.LEAD,
        Permission.ProjectMembersManage,
      ),
    ).toBe(true);
  });

  it('MEMBER has no project management permissions', () => {
    expect(
      projectRoleHasPermission(ProjectRole.MEMBER, Permission.ProjectManage),
    ).toBe(false);
    expect(
      projectRoleHasPermission(
        ProjectRole.MEMBER,
        Permission.ProjectMembersManage,
      ),
    ).toBe(false);
  });

  it('a project role never grants organization-level permissions', () => {
    expect(
      projectRoleHasPermission(
        ProjectRole.LEAD,
        Permission.OrganizationProjectsManageAny,
      ),
    ).toBe(false);
  });
});
