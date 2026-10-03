import { ExecutionContext, NotFoundException } from '@nestjs/common';
import { MembershipRole, ProjectRole } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { ProjectGuard } from './project.guard';

/**
 * UNIT tests for the project VISIBILITY rule - the logic that makes
 * projects private to their members. (The real HTTP behaviour is covered by
 * the e2e tests; these pin down the decision table in isolation.)
 */
describe('ProjectGuard', () => {
  let guard: ProjectGuard;
  let prisma: { project: { findUnique: jest.Mock } };

  const orgId = 'aaaaaaaa-0000-4000-8000-000000000001';
  const projectId = 'bbbbbbbb-0000-4000-8000-000000000001';
  const userId = 'cccccccc-0000-4000-8000-000000000001';

  /** The parts of the Express request this guard reads and writes. */
  interface GuardRequest {
    params: { id: string; projectId: string };
    user: { id: string };
    membership?: {
      id: string;
      organizationId: string;
      userId: string;
      role: MembershipRole;
    };
    project?: { id: string; memberships?: unknown };
    projectMembership?: { role: ProjectRole } | null;
  }

  const makeRequest = (role: MembershipRole | null): GuardRequest => ({
    params: { id: orgId, projectId },
    user: { id: userId },
    membership: role
      ? { id: 'm1', organizationId: orgId, userId, role }
      : undefined,
  });

  const contextFor = (request: GuardRequest): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => request }),
    }) as unknown as ExecutionContext;

  const projectRow = (overrides: object = {}) => ({
    id: projectId,
    organizationId: orgId,
    name: 'Apollo',
    memberships: [] as { id: string; role: ProjectRole }[],
    ...overrides,
  });

  beforeEach(() => {
    prisma = { project: { findUnique: jest.fn() } };
    guard = new ProjectGuard(prisma as unknown as PrismaService);
  });

  it('lets a project MEMBER through and attaches the project and their membership', async () => {
    prisma.project.findUnique.mockResolvedValue(
      projectRow({ memberships: [{ id: 'pm1', role: ProjectRole.MEMBER }] }),
    );
    const request = makeRequest(MembershipRole.MEMBER);

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);

    expect(request.project?.id).toBe(projectId);
    // The membership list is stripped off the project and attached separately.
    expect(request.project?.memberships).toBeUndefined();
    expect(request.projectMembership?.role).toBe(ProjectRole.MEMBER);
  });

  it('hides a project from an org MEMBER who is not on it (404, not 403)', async () => {
    prisma.project.findUnique.mockResolvedValue(projectRow());

    await expect(
      guard.canActivate(contextFor(makeRequest(MembershipRole.MEMBER))),
    ).rejects.toThrow(NotFoundException);
  });

  it.each([MembershipRole.ADMIN, MembershipRole.MANAGER])(
    'lets an org %s through even though they are not on the project',
    async (role) => {
      prisma.project.findUnique.mockResolvedValue(projectRow());
      const request = makeRequest(role);

      await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
      expect(request.projectMembership).toBeNull();
    },
  );

  it('returns 404 for a project that belongs to a DIFFERENT organization, even for an ADMIN', async () => {
    prisma.project.findUnique.mockResolvedValue(
      projectRow({ organizationId: 'some-other-org' }),
    );

    await expect(
      guard.canActivate(contextFor(makeRequest(MembershipRole.ADMIN))),
    ).rejects.toThrow(NotFoundException);
  });

  it('returns 404 for a project that does not exist', async () => {
    prisma.project.findUnique.mockResolvedValue(null);

    await expect(
      guard.canActivate(contextFor(makeRequest(MembershipRole.ADMIN))),
    ).rejects.toThrow(NotFoundException);
  });

  it('treats a malformed project ID as not found WITHOUT querying the database', async () => {
    const request = makeRequest(MembershipRole.ADMIN);
    request.params.projectId = 'not-a-uuid';

    await expect(guard.canActivate(contextFor(request))).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.project.findUnique).not.toHaveBeenCalled();
  });

  it('fails closed when the organization membership is missing from the request', async () => {
    await expect(
      guard.canActivate(contextFor(makeRequest(null))),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.project.findUnique).not.toHaveBeenCalled();
  });
});
