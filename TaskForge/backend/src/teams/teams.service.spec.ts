import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma, TeamRole } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { UsersService } from '../users/users.service';
import { TeamsService } from './teams.service';

/**
 * UNIT tests: TeamsService's logic in isolation, with Prisma and
 * UsersService mocked out. Focus: the "must already be an org member"
 * precondition and the "can't remove/demote the last lead" safety rail -
 * the two pieces of real business logic living in this service.
 */
describe('TeamsService', () => {
  let service: TeamsService;
  let prisma: {
    team: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    teamMembership: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
      count: jest.Mock;
    };
    membership: { findUnique: jest.Mock };
    $transaction: jest.Mock;
  };
  let usersService: { findByEmailSafe: jest.Mock };

  const orgId = 'aaaaaaaa-0000-4000-8000-000000000001';
  const teamId = 'bbbbbbbb-0000-4000-8000-000000000001';
  const userId = 'cccccccc-0000-4000-8000-000000000001';
  const targetUserId = 'dddddddd-0000-4000-8000-000000000001';

  beforeEach(async () => {
    prisma = {
      team: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      teamMembership: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        count: jest.fn(),
      },
      membership: { findUnique: jest.fn() },
      $transaction: jest.fn(),
    };
    usersService = { findByEmailSafe: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TeamsService,
        { provide: PrismaService, useValue: prisma },
        { provide: UsersService, useValue: usersService },
      ],
    }).compile();

    service = module.get<TeamsService>(TeamsService);
  });

  describe('create', () => {
    it('creates the team and a LEAD membership for the creator, atomically', async () => {
      prisma.$transaction.mockImplementation(async (cb) =>
        cb({
          team: {
            create: jest.fn().mockResolvedValue({
              id: teamId,
              organizationId: orgId,
              name: 'Engineering',
            }),
          },
          teamMembership: {
            create: jest
              .fn()
              .mockResolvedValue({ id: 'tm1', role: TeamRole.LEAD }),
          },
        }),
      );

      const result = await service.create(orgId, 'Engineering', userId);

      expect(result.name).toBe('Engineering');
      expect(prisma.$transaction).toHaveBeenCalled();
    });
  });

  describe('addMember', () => {
    it('throws NotFoundException when no account exists for that email', async () => {
      usersService.findByEmailSafe.mockResolvedValue(null);
      await expect(
        service.addMember(orgId, teamId, { email: 'nobody@x.com' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws UnprocessableEntityException when the user is not an org member', async () => {
      usersService.findByEmailSafe.mockResolvedValue({
        id: targetUserId,
        email: 'x@example.com',
      });
      prisma.membership.findUnique.mockResolvedValue(null); // not in the org

      await expect(
        service.addMember(orgId, teamId, { email: 'x@example.com' }),
      ).rejects.toThrow(UnprocessableEntityException);
      expect(prisma.teamMembership.create).not.toHaveBeenCalled();
    });

    it('adds the member once org membership is confirmed', async () => {
      usersService.findByEmailSafe.mockResolvedValue({
        id: targetUserId,
        email: 'x@example.com',
      });
      prisma.membership.findUnique.mockResolvedValue({
        id: 'm1',
        role: 'MEMBER',
      }); // is an org member
      prisma.teamMembership.create.mockResolvedValue({
        id: 'tm2',
        role: TeamRole.MEMBER,
        createdAt: new Date(),
      });

      const result = await service.addMember(orgId, teamId, {
        email: 'x@example.com',
      });
      expect(result.role).toBe(TeamRole.MEMBER);
    });

    it('translates a P2002 (already on the team) into ConflictException', async () => {
      usersService.findByEmailSafe.mockResolvedValue({
        id: targetUserId,
        email: 'x@example.com',
      });
      prisma.membership.findUnique.mockResolvedValue({
        id: 'm1',
        role: 'MEMBER',
      });
      prisma.teamMembership.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(
        service.addMember(orgId, teamId, { email: 'x@example.com' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('the last-lead safety rail', () => {
    it('removeMember refuses to remove the only remaining lead', async () => {
      prisma.teamMembership.findUnique.mockResolvedValue({
        id: 'tm1',
        userId,
        teamId,
        role: TeamRole.LEAD,
      });
      prisma.teamMembership.count.mockResolvedValue(1);

      await expect(service.removeMember(teamId, userId)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.teamMembership.delete).not.toHaveBeenCalled();
    });

    it('removeMember allows removing a lead when another lead remains', async () => {
      prisma.teamMembership.findUnique.mockResolvedValue({
        id: 'tm1',
        userId,
        teamId,
        role: TeamRole.LEAD,
      });
      prisma.teamMembership.count.mockResolvedValue(2);
      prisma.teamMembership.delete.mockResolvedValue({ id: 'tm1' });

      await service.removeMember(teamId, userId);
      expect(prisma.teamMembership.delete).toHaveBeenCalledWith({
        where: { id: 'tm1' },
      });
    });

    it('removeMember allows removing a non-lead freely', async () => {
      prisma.teamMembership.findUnique.mockResolvedValue({
        id: 'tm2',
        userId: targetUserId,
        teamId,
        role: TeamRole.MEMBER,
      });
      prisma.teamMembership.delete.mockResolvedValue({ id: 'tm2' });

      await service.removeMember(teamId, targetUserId);
      expect(prisma.teamMembership.count).not.toHaveBeenCalled();
    });

    it('updateMemberRole refuses to demote the only remaining lead', async () => {
      prisma.teamMembership.findUnique.mockResolvedValue({
        id: 'tm1',
        userId,
        teamId,
        role: TeamRole.LEAD,
        user: { id: userId },
      });
      prisma.teamMembership.count.mockResolvedValue(1);

      await expect(
        service.updateMemberRole(teamId, userId, TeamRole.MEMBER),
      ).rejects.toThrow(ConflictException);
    });

    it('throws NotFoundException when the target user is not on the team', async () => {
      prisma.teamMembership.findUnique.mockResolvedValue(null);
      await expect(service.removeMember(teamId, targetUserId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
