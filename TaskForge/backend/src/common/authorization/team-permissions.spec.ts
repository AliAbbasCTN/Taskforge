import { TeamRole } from '@prisma/client';
import { Permission } from './permission.enum';
import { teamRoleHasPermission } from './team-permissions';

describe('teamRoleHasPermission', () => {
  it('LEAD can manage the team and its members', () => {
    expect(teamRoleHasPermission(TeamRole.LEAD, Permission.TeamManage)).toBe(
      true,
    );
    expect(
      teamRoleHasPermission(TeamRole.LEAD, Permission.TeamMembersManage),
    ).toBe(true);
  });

  it('MEMBER has no team-level permissions', () => {
    expect(teamRoleHasPermission(TeamRole.MEMBER, Permission.TeamManage)).toBe(
      false,
    );
    expect(
      teamRoleHasPermission(TeamRole.MEMBER, Permission.TeamMembersManage),
    ).toBe(false);
  });
});
