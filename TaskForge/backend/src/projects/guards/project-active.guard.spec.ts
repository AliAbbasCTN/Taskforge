import {
  ConflictException,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { ProjectStatus } from '@prisma/client';
import { ProjectActiveGuard } from './project-active.guard';

describe('ProjectActiveGuard', () => {
  const guard = new ProjectActiveGuard();

  const contextWith = (project?: { status: ProjectStatus }): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ project }) }),
    }) as unknown as ExecutionContext;

  it('allows writes to an ACTIVE project', () => {
    expect(
      guard.canActivate(contextWith({ status: ProjectStatus.ACTIVE })),
    ).toBe(true);
  });

  it('rejects writes to an ARCHIVED project with 409', () => {
    expect(() =>
      guard.canActivate(contextWith({ status: ProjectStatus.ARCHIVED })),
    ).toThrow(ConflictException);
  });

  it('fails closed when ProjectGuard did not run first', () => {
    expect(() => guard.canActivate(contextWith(undefined))).toThrow(
      ForbiddenException,
    );
  });
});
