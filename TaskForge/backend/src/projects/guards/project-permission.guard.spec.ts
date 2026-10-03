import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MembershipRole, ProjectRole } from '@prisma/client';
import { Permission } from '../../common/authorization/permission.enum';
import { ProjectPermissionGuard } from './project-permission.guard';

describe('ProjectPermissionGuard', () => {
  let guard: ProjectPermissionGuard;
  let reflector: { get: jest.Mock };

  const project = { id: 'project-1', organizationId: 'org-1' };

  const mockContext = (
    orgRole: MembershipRole,
    projectMembership: { role: ProjectRole } | null,
  ): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({
          project,
          membership: { role: orgRole },
          projectMembership,
        }),
      }),
      getHandler: () => ({}),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    reflector = { get: jest.fn().mockReturnValue(Permission.ProjectManage) };
    guard = new ProjectPermissionGuard(reflector as unknown as Reflector);
  });

  it.each([MembershipRole.ADMIN, MembershipRole.MANAGER])(
    'grants access via the org-wide %s override, without being on the project',
    (role) => {
      expect(guard.canActivate(mockContext(role, null))).toBe(true);
    },
  );

  it("grants access to a plain org MEMBER who is this project's LEAD", () => {
    expect(
      guard.canActivate(
        mockContext(MembershipRole.MEMBER, { role: ProjectRole.LEAD }),
      ),
    ).toBe(true);
  });

  it('denies (403) a project MEMBER who is not a LEAD', () => {
    expect(() =>
      guard.canActivate(
        mockContext(MembershipRole.MEMBER, { role: ProjectRole.MEMBER }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('denies (403) an org MEMBER with no project membership at all', () => {
    expect(() =>
      guard.canActivate(mockContext(MembershipRole.MEMBER, null)),
    ).toThrow(ForbiddenException);
  });

  it('checks the permission the route actually declares', () => {
    reflector.get.mockReturnValue(Permission.ProjectMembersManage);
    expect(
      guard.canActivate(
        mockContext(MembershipRole.MEMBER, { role: ProjectRole.LEAD }),
      ),
    ).toBe(true);
  });

  it('fails closed if the route forgot @RequirePermission(...)', () => {
    reflector.get.mockReturnValue(undefined);
    expect(() =>
      guard.canActivate(mockContext(MembershipRole.ADMIN, null)),
    ).toThrow(ForbiddenException);
  });

  it('fails closed if ProjectGuard did not run first (no project on the request)', () => {
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ membership: { role: MembershipRole.ADMIN } }),
      }),
      getHandler: () => ({}),
    } as unknown as ExecutionContext;

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
