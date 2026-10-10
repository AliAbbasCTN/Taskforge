import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  MembershipRole,
  NotificationType,
  Prisma,
  ProjectRole,
  ProjectStatus,
} from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UsersService } from '../users/users.service';
import { ProjectsService } from './projects.service';

/**
 * UNIT tests: ProjectsService's rules in isolation, with Prisma and
 * UsersService mocked. Focus on the logic that lives in this service - the
 * visibility filter, the archived/active lifecycle, the "must already be an
 * org member" precondition and the "last lead" rail. (Who is ALLOWED to
 * call these methods is the guards' job and is tested separately.)
 */
describe('ProjectsService', () => {
  let service: ProjectsService;
  let prisma: {
    project: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    projectMembership: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
      count: jest.Mock;
    };
    membership: { findUnique: jest.Mock };
    task: { updateMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let usersService: { findByEmailSafe: jest.Mock };
  let notifications: { notify: jest.Mock };

  const orgId = 'aaaaaaaa-0000-4000-8000-000000000001';
  const projectId = 'bbbbbbbb-0000-4000-8000-000000000001';
  const userId = 'cccccccc-0000-4000-8000-000000000001';
  const targetUserId = 'dddddddd-0000-4000-8000-000000000001';

  const activeProject = {
    id: projectId,
    organizationId: orgId,
    name: 'Apollo',
    description: null,
    status: ProjectStatus.ACTIVE,
    archivedAt: null,
  };
  const archivedProject = {
    ...activeProject,
    status: ProjectStatus.ARCHIVED,
    archivedAt: new Date(),
  };

  beforeEach(async () => {
    prisma = {
      project: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      projectMembership: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        count: jest.fn(),
      },
      membership: { findUnique: jest.fn() },
      task: { updateMany: jest.fn() },
      $transaction: jest.fn(),
    };
    usersService = { findByEmailSafe: jest.fn() };
    notifications = { notify: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectsService,
        { provide: PrismaService, useValue: prisma },
        { provide: UsersService, useValue: usersService },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();

    service = module.get<ProjectsService>(ProjectsService);
  });

  describe('create', () => {
    it('creates the project and a LEAD membership for the creator, in one transaction', async () => {
      const txProjectCreate = jest.fn().mockResolvedValue(activeProject);
      const txMembershipCreate = jest.fn().mockResolvedValue({ id: 'pm1' });
      prisma.$transaction.mockImplementation(async (cb) =>
        cb({
          project: { create: txProjectCreate },
          projectMembership: { create: txMembershipCreate },
        }),
      );

      const result = await service.create(
        orgId,
        { name: 'Apollo', description: 'Moon landing' },
        userId,
      );

      expect(result.name).toBe('Apollo');
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(txProjectCreate).toHaveBeenCalledWith({
        data: {
          organizationId: orgId,
          name: 'Apollo',
          description: 'Moon landing',
        },
      });
      expect(txMembershipCreate).toHaveBeenCalledWith({
        data: { projectId, userId, role: ProjectRole.LEAD },
      });
    });
  });

  describe('findAllVisible', () => {
    beforeEach(() => prisma.project.findMany.mockResolvedValue([]));

    it('an org MEMBER only sees projects they belong to', async () => {
      await service.findAllVisible(orgId, MembershipRole.MEMBER, userId);

      const where = prisma.project.findMany.mock.calls[0][0].where;
      expect(where.organizationId).toBe(orgId);
      expect(where.memberships).toEqual({ some: { userId } });
    });

    it.each([MembershipRole.ADMIN, MembershipRole.MANAGER])(
      'an org %s sees every project in the organization (no membership filter)',
      async (role) => {
        await service.findAllVisible(orgId, role, userId);

        const where = prisma.project.findMany.mock.calls[0][0].where;
        expect(where.organizationId).toBe(orgId);
        expect(where.memberships).toBeUndefined();
      },
    );

    it('defaults to ACTIVE projects and honours an explicit status', async () => {
      await service.findAllVisible(orgId, MembershipRole.ADMIN, userId);
      expect(prisma.project.findMany.mock.calls[0][0].where.status).toBe(
        ProjectStatus.ACTIVE,
      );

      await service.findAllVisible(
        orgId,
        MembershipRole.ADMIN,
        userId,
        ProjectStatus.ARCHIVED,
      );
      expect(prisma.project.findMany.mock.calls[1][0].where.status).toBe(
        ProjectStatus.ARCHIVED,
      );
    });

    it('flattens the member count and the requester role into the summary', async () => {
      prisma.project.findMany.mockResolvedValue([
        {
          ...activeProject,
          _count: { memberships: 3 },
          memberships: [{ role: ProjectRole.LEAD }],
        },
        {
          ...activeProject,
          id: 'other',
          _count: { memberships: 1 },
          memberships: [],
        },
      ]);

      const result = await service.findAllVisible(
        orgId,
        MembershipRole.ADMIN,
        userId,
      );

      expect(result[0].memberCount).toBe(3);
      expect(result[0].currentUserRole).toBe(ProjectRole.LEAD);
      // An ADMIN overseeing a project they are not on has no project role.
      expect(result[1].currentUserRole).toBeNull();
      expect(result[0]).not.toHaveProperty('_count');
      expect(result[0]).not.toHaveProperty('memberships');
    });
  });

  describe('update', () => {
    it('rejects a body with no fields', async () => {
      await expect(service.update(projectId, {})).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.project.update).not.toHaveBeenCalled();
    });

    it('rejects edits to an ARCHIVED project', async () => {
      prisma.project.findUnique.mockResolvedValue(archivedProject);

      await expect(
        service.update(projectId, { name: 'New name' }),
      ).rejects.toThrow(ConflictException);
      expect(prisma.project.update).not.toHaveBeenCalled();
    });

    it('stores NULL when the description is cleared with an empty string', async () => {
      prisma.project.findUnique.mockResolvedValue(activeProject);
      prisma.project.update.mockResolvedValue(activeProject);

      await service.update(projectId, { description: '' });

      expect(prisma.project.update).toHaveBeenCalledWith({
        where: { id: projectId },
        data: { description: null },
      });
    });

    it('throws NotFoundException if the project vanished', async () => {
      prisma.project.findUnique.mockResolvedValue(null);

      await expect(service.update(projectId, { name: 'X1' })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('archive / unarchive / remove lifecycle', () => {
    it('archives an active project and stamps archivedAt', async () => {
      prisma.project.findUnique.mockResolvedValue(activeProject);
      prisma.project.update.mockResolvedValue(archivedProject);

      await service.archive(projectId);

      const call = prisma.project.update.mock.calls[0][0];
      expect(call.data.status).toBe(ProjectStatus.ARCHIVED);
      expect(call.data.archivedAt).toBeInstanceOf(Date);
    });

    it('refuses to archive an already-archived project', async () => {
      prisma.project.findUnique.mockResolvedValue(archivedProject);

      await expect(service.archive(projectId)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.project.update).not.toHaveBeenCalled();
    });

    it('unarchives an archived project and clears archivedAt', async () => {
      prisma.project.findUnique.mockResolvedValue(archivedProject);
      prisma.project.update.mockResolvedValue(activeProject);

      await service.unarchive(projectId);

      expect(prisma.project.update).toHaveBeenCalledWith({
        where: { id: projectId },
        data: { status: ProjectStatus.ACTIVE, archivedAt: null },
      });
    });

    it('refuses to unarchive a project that is not archived', async () => {
      prisma.project.findUnique.mockResolvedValue(activeProject);

      await expect(service.unarchive(projectId)).rejects.toThrow(
        ConflictException,
      );
    });

    it('permanently deletes only an ARCHIVED project', async () => {
      prisma.project.findUnique.mockResolvedValue(archivedProject);
      prisma.project.delete.mockResolvedValue(archivedProject);

      await service.remove(projectId);

      expect(prisma.project.delete).toHaveBeenCalledWith({
        where: { id: projectId },
      });
    });

    it('refuses to delete an ACTIVE project - it must be archived first', async () => {
      prisma.project.findUnique.mockResolvedValue(activeProject);

      await expect(service.remove(projectId)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.project.delete).not.toHaveBeenCalled();
    });
  });

  describe('addMember', () => {
    beforeEach(() => {
      prisma.project.findUnique.mockResolvedValue(activeProject);
    });

    it('throws NotFoundException when no account exists for that email', async () => {
      usersService.findByEmailSafe.mockResolvedValue(null);

      await expect(
        service.addMember(orgId, projectId, { email: 'nobody@x.com' }, userId),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws UnprocessableEntityException when the user is not an org member', async () => {
      usersService.findByEmailSafe.mockResolvedValue({ id: targetUserId });
      prisma.membership.findUnique.mockResolvedValue(null);

      await expect(
        service.addMember(orgId, projectId, { email: 'x@example.com' }, userId),
      ).rejects.toThrow(UnprocessableEntityException);
      expect(prisma.projectMembership.create).not.toHaveBeenCalled();
    });

    it('refuses to add anyone to an ARCHIVED project', async () => {
      prisma.project.findUnique.mockResolvedValue(archivedProject);

      await expect(
        service.addMember(orgId, projectId, { email: 'x@example.com' }, userId),
      ).rejects.toThrow(ConflictException);
      expect(usersService.findByEmailSafe).not.toHaveBeenCalled();
    });

    it('defaults the new member to the MEMBER role', async () => {
      usersService.findByEmailSafe.mockResolvedValue({ id: targetUserId });
      prisma.membership.findUnique.mockResolvedValue({ id: 'm1' });
      prisma.projectMembership.create.mockResolvedValue({
        id: 'pm1',
        role: ProjectRole.MEMBER,
        createdAt: new Date(),
      });

      const result = await service.addMember(
        orgId,
        projectId,
        { email: 'x@example.com' },
        userId,
      );

      expect(prisma.projectMembership.create).toHaveBeenCalledWith({
        data: { projectId, userId: targetUserId, role: ProjectRole.MEMBER },
      });
      expect(result.role).toBe(ProjectRole.MEMBER);
    });

    it('notifies the person who was added', async () => {
      usersService.findByEmailSafe.mockResolvedValue({ id: targetUserId });
      prisma.membership.findUnique.mockResolvedValue({ id: 'm1' });
      prisma.projectMembership.create.mockResolvedValue({
        id: 'pm1',
        role: ProjectRole.MEMBER,
        createdAt: new Date(),
      });

      await service.addMember(
        orgId,
        projectId,
        { email: 'x@example.com' },
        userId,
      );

      expect(notifications.notify).toHaveBeenCalledWith({
        recipientId: targetUserId,
        actorId: userId,
        type: NotificationType.ADDED_TO_PROJECT,
        projectId,
        subject: 'Apollo',
      });
    });

    it('translates a unique-constraint violation into ConflictException', async () => {
      usersService.findByEmailSafe.mockResolvedValue({ id: targetUserId });
      prisma.membership.findUnique.mockResolvedValue({ id: 'm1' });
      prisma.projectMembership.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(
        service.addMember(orgId, projectId, { email: 'x@example.com' }, userId),
      ).rejects.toThrow(ConflictException);
      // A failed add must not announce anything.
      expect(notifications.notify).not.toHaveBeenCalled();
    });
  });

  describe('the last-lead safety rail', () => {
    beforeEach(() => {
      prisma.project.findUnique.mockResolvedValue(activeProject);
    });

    it('removeMember refuses to remove the only remaining lead', async () => {
      prisma.projectMembership.findUnique.mockResolvedValue({
        id: 'pm1',
        role: ProjectRole.LEAD,
      });
      prisma.projectMembership.count.mockResolvedValue(1);

      await expect(service.removeMember(projectId, userId)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.projectMembership.delete).not.toHaveBeenCalled();
    });

    it('removeMember allows removing a lead when another lead remains', async () => {
      prisma.projectMembership.findUnique.mockResolvedValue({
        id: 'pm1',
        role: ProjectRole.LEAD,
      });
      prisma.projectMembership.count.mockResolvedValue(2);

      await service.removeMember(projectId, userId);

      expect(prisma.projectMembership.delete).toHaveBeenCalledWith({
        where: { id: 'pm1' },
      });
    });

    it("removeMember unassigns the departing member's tasks in that project, in the same transaction", async () => {
      prisma.projectMembership.findUnique.mockResolvedValue({
        id: 'pm2',
        role: ProjectRole.MEMBER,
      });

      await service.removeMember(projectId, targetUserId);

      expect(prisma.task.updateMany).toHaveBeenCalledWith({
        where: {
          assigneeId: targetUserId,
          column: { board: { projectId } },
        },
        data: { assigneeId: null },
      });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.$transaction.mock.calls[0][0]).toHaveLength(2);
    });

    it('removeMember removes a plain member without counting leads', async () => {
      prisma.projectMembership.findUnique.mockResolvedValue({
        id: 'pm2',
        role: ProjectRole.MEMBER,
      });

      await service.removeMember(projectId, targetUserId);

      expect(prisma.projectMembership.count).not.toHaveBeenCalled();
      expect(prisma.projectMembership.delete).toHaveBeenCalled();
    });

    it('removeMember throws NotFoundException for a non-member', async () => {
      prisma.projectMembership.findUnique.mockResolvedValue(null);

      await expect(
        service.removeMember(projectId, targetUserId),
      ).rejects.toThrow(NotFoundException);
    });

    it('updateMemberRole refuses to demote the only remaining lead', async () => {
      prisma.projectMembership.findUnique.mockResolvedValue({
        id: 'pm1',
        role: ProjectRole.LEAD,
        user: { id: userId },
      });
      prisma.projectMembership.count.mockResolvedValue(1);

      await expect(
        service.updateMemberRole(projectId, userId, ProjectRole.MEMBER),
      ).rejects.toThrow(ConflictException);
      expect(prisma.projectMembership.update).not.toHaveBeenCalled();
    });

    it('updateMemberRole allows promoting a member to lead without counting leads', async () => {
      prisma.projectMembership.findUnique.mockResolvedValue({
        id: 'pm2',
        role: ProjectRole.MEMBER,
        user: { id: targetUserId },
      });
      prisma.projectMembership.update.mockResolvedValue({
        id: 'pm2',
        role: ProjectRole.LEAD,
        createdAt: new Date(),
      });

      const result = await service.updateMemberRole(
        projectId,
        targetUserId,
        ProjectRole.LEAD,
      );

      expect(prisma.projectMembership.count).not.toHaveBeenCalled();
      expect(result.role).toBe(ProjectRole.LEAD);
    });

    it('membership changes are refused on an ARCHIVED project', async () => {
      prisma.project.findUnique.mockResolvedValue(archivedProject);

      await expect(service.removeMember(projectId, userId)).rejects.toThrow(
        ConflictException,
      );
      await expect(
        service.updateMemberRole(projectId, userId, ProjectRole.LEAD),
      ).rejects.toThrow(ConflictException);
    });
  });
});
