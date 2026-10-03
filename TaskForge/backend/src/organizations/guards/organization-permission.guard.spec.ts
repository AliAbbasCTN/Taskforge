import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MembershipRole } from '@prisma/client';
import { Permission } from '../../common/authorization/permission.enum';
import { OrganizationPermissionGuard } from './organization-permission.guard';

/**
 * UNIT tests for the guard's decision logic - Reflector and the request
 * object are both mocked, so no HTTP request or database is involved.
 * The end-to-end wiring (does this guard actually run in the right order
 * behind real routes) is covered by e2e tests instead.
 */
describe('OrganizationPermissionGuard', () => {
  let guard: OrganizationPermissionGuard;
  let reflector: { get: jest.Mock };

  const mockContext = (membership?: {
    role: MembershipRole;
  }): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ membership }) }),
      getHandler: () => ({}),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    reflector = { get: jest.fn() };
    guard = new OrganizationPermissionGuard(reflector as unknown as Reflector);
  });

  it('allows the request when the membership role grants the required permission', () => {
    reflector.get.mockReturnValue(Permission.OrganizationManage);
    const context = mockContext({ role: MembershipRole.ADMIN });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('denies the request when the membership role lacks the required permission', () => {
    reflector.get.mockReturnValue(Permission.OrganizationManage);
    const context = mockContext({ role: MembershipRole.MANAGER });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('denies MEMBER for every organization-level permission', () => {
    const context = mockContext({ role: MembershipRole.MEMBER });

    for (const permission of [
      Permission.OrganizationManage,
      Permission.OrganizationMembersManage,
      Permission.OrganizationTeamsManageAny,
    ]) {
      reflector.get.mockReturnValue(permission);
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    }
  });

  it('fails closed if the route forgot @RequirePermission(...)', () => {
    reflector.get.mockReturnValue(undefined);
    const context = mockContext({ role: MembershipRole.ADMIN });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('fails closed if request.membership is somehow missing', () => {
    reflector.get.mockReturnValue(Permission.OrganizationManage);
    const context = mockContext(undefined);

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
