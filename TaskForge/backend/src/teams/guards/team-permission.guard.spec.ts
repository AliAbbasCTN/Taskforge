import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MembershipRole, TeamRole } from '@prisma/client';
import { Permission } from '../../common/authorization/permission.enum';
import { PrismaService } from '../../database/prisma.service';
import { TeamPermissionGuard } from './team-permission.guard';

describe('TeamPermissionGuard', () => {
  let guard: TeamPermissionGuard;
  let reflector: { get: jest.Mock };
  let prisma: { teamMembership: { findUnique: jest.Mock } };

  const team = { id: 'team-1', organizationId: 'org-1' };
  const userId = 'user-1';

  const mockContext = (membership?: {
    role: MembershipRole;
  }): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ team, membership, user: { id: userId } }),
      }),
      getHandler: () => ({}),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    reflector = { get: jest.fn().mockReturnValue(Permission.TeamManage) };
    prisma = { teamMembership: { findUnique: jest.fn() } };
    guard = new TeamPermissionGuard(
      prisma as unknown as PrismaService,
      reflector as unknown as Reflector,
    );
  });

  it('grants access via the ADMIN organization-wide override, without even being on the team', async () => {
    const context = mockContext({ role: MembershipRole.ADMIN });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    // The override short-circuits before any team-membership lookup.
    expect(prisma.teamMembership.findUnique).not.toHaveBeenCalled();
  });

  it('grants access via the MANAGER organization-wide override', async () => {
    const context = mockContext({ role: MembershipRole.MANAGER });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(prisma.teamMembership.findUnique).not.toHaveBeenCalled();
  });

  it("grants access to a plain org MEMBER who is this team's LEAD", async () => {
    prisma.teamMembership.findUnique.mockResolvedValue({ role: TeamRole.LEAD });
    const context = mockContext({ role: MembershipRole.MEMBER });

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('denies an org MEMBER who is only a team MEMBER (not LEAD)', async () => {
    prisma.teamMembership.findUnique.mockResolvedValue({
      role: TeamRole.MEMBER,
    });
    const context = mockContext({ role: MembershipRole.MEMBER });

    await expect(guard.canActivate(context)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('denies an org MEMBER who is not on the team at all', async () => {
    prisma.teamMembership.findUnique.mockResolvedValue(null);
    const context = mockContext({ role: MembershipRole.MEMBER });

    await expect(guard.canActivate(context)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('fails closed if the route forgot @RequirePermission(...)', async () => {
    reflector.get.mockReturnValue(undefined);
    const context = mockContext({ role: MembershipRole.ADMIN });

    await expect(guard.canActivate(context)).rejects.toThrow(
      ForbiddenException,
    );
  });
});
