import { MembershipRole, ProjectRole } from '@prisma/client';
import { Permission } from './permission.enum';
import { canActOnProject } from './project-access';

describe('canActOnProject', () => {
  it('org ADMIN and MANAGER hold every project permission without being on the project', () => {
    for (const role of [MembershipRole.ADMIN, MembershipRole.MANAGER]) {
      expect(canActOnProject(role, null, Permission.ProjectManage)).toBe(true);
      expect(canActOnProject(role, null, Permission.ProjectTasksWrite)).toBe(
        true,
      );
    }
  });

  it('a project LEAD holds management permissions', () => {
    expect(
      canActOnProject(
        MembershipRole.MEMBER,
        ProjectRole.LEAD,
        Permission.ProjectManage,
      ),
    ).toBe(true);
  });

  it('a project MEMBER can write tasks but not manage', () => {
    expect(
      canActOnProject(
        MembershipRole.MEMBER,
        ProjectRole.MEMBER,
        Permission.ProjectTasksWrite,
      ),
    ).toBe(true);
    expect(
      canActOnProject(
        MembershipRole.MEMBER,
        ProjectRole.MEMBER,
        Permission.ProjectManage,
      ),
    ).toBe(false);
  });

  it('an org MEMBER who is not on the project can do nothing', () => {
    expect(
      canActOnProject(
        MembershipRole.MEMBER,
        null,
        Permission.ProjectTasksWrite,
      ),
    ).toBe(false);
  });
});
