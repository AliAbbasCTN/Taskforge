import { MembershipRole } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { RealtimeAccessService } from './realtime-access.service';

/** The socket version of the HTTP visibility rule: org member, then project
 * member OR org-wide oversight. */
describe('RealtimeAccessService.canAccessProject', () => {
  let service: RealtimeAccessService;
  let prisma: {
    project: { findUnique: jest.Mock };
    membership: { findUnique: jest.Mock };
  };

  const userId = 'user-1';
  const projectId = 'project-1';

  const project = (onProject: boolean) => ({
    organizationId: 'org-1',
    memberships: onProject ? [{ id: 'pm1' }] : [],
  });

  beforeEach(() => {
    prisma = {
      project: { findUnique: jest.fn() },
      membership: { findUnique: jest.fn() },
    };
    service = new RealtimeAccessService(prisma as unknown as PrismaService);
  });

  it('denies a project that does not exist, without querying memberships', async () => {
    prisma.project.findUnique.mockResolvedValue(null);

    await expect(service.canAccessProject(userId, projectId)).resolves.toBe(
      false,
    );
    expect(prisma.membership.findUnique).not.toHaveBeenCalled();
  });

  it('denies someone who is not in the project organization, even with a stale project membership', async () => {
    prisma.project.findUnique.mockResolvedValue(project(true));
    prisma.membership.findUnique.mockResolvedValue(null);

    await expect(service.canAccessProject(userId, projectId)).resolves.toBe(
      false,
    );
  });

  it('allows a project member who is in the organization', async () => {
    prisma.project.findUnique.mockResolvedValue(project(true));
    prisma.membership.findUnique.mockResolvedValue({
      role: MembershipRole.MEMBER,
    });

    await expect(service.canAccessProject(userId, projectId)).resolves.toBe(
      true,
    );
  });

  it('denies a plain org MEMBER who is not on the (private) project', async () => {
    prisma.project.findUnique.mockResolvedValue(project(false));
    prisma.membership.findUnique.mockResolvedValue({
      role: MembershipRole.MEMBER,
    });

    await expect(service.canAccessProject(userId, projectId)).resolves.toBe(
      false,
    );
  });

  it.each([MembershipRole.ADMIN, MembershipRole.MANAGER])(
    'allows an org %s through oversight without being on the project',
    async (role) => {
      prisma.project.findUnique.mockResolvedValue(project(false));
      prisma.membership.findUnique.mockResolvedValue({ role });

      await expect(service.canAccessProject(userId, projectId)).resolves.toBe(
        true,
      );
    },
  );
});
